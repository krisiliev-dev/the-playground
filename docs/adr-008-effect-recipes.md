# ADR-008: Data-Driven Effect Recipes

## Status

Accepted

## Date

2026-05-07

## Context

[ADR-006](./adr-006-shared-presence-and-events.md) introduced the `SceneEvent` channel — typed, validated, rebroadcast effects. Each *kind* of effect (sword swing, audio cue, camera shake) is currently hardcoded as:

1. A variant on the Rust `SceneEventKind` enum (server)
2. A variant on the TypeScript `SceneEventKind` union (client)
3. A validation policy in `validate_event` (server)
4. A React component or `useSceneEvent` handler that renders/plays the effect (client)

Adding a new kind = ~10 lines across 3 files + a code deploy.

The project's end goal explicitly disallows redeploys for new effects. The admin should be able to define a "confettiBurst" effect at runtime — its parameters AND its visual behavior — and trigger it on connected clients without restarting anything. ADR-006 hinted at this as a follow-up; this ADR commits to the data-driven path.

## Decision

**Effects are described by JSON `Recipe` documents — a generic interpreter on each client renders a recipe given a position + parameters. Recipes are runtime-uploaded (like assets, per [ADR-007](./adr-007-asset-upload-pipeline.md)) and triggered by id over the SceneEvent channel.**

This is the same architecture Source's particle system, Unreal's Niagara, Unity's VFX Graph, and Roblox's ParticleEmitter all converge on: a fixed engine running varying specs.

### Recipe shape

A `Recipe` is a tagged-union document:

```jsonc
{
  "version": 1,
  "id":   "rcp_confetti_burst_v1",
  "name": "Confetti Burst",
  "root": {
    "kind": "particle_burst",
    "emitter": { "shape": "sphere", "radius": 0.2 },
    "count":   { "value": 1000 },
    "lifetime_ms": { "min": 1200, "max": 1800 },
    "initial_velocity": {
      "kind":  "cone",
      "axis":  [0, 1, 0],
      "speed": { "min": 4, "max": 8 },
      "spread_degrees": 30
    },
    "size": {
      "start": { "min": 0.05, "max": 0.2 },
      "end":   { "value": 0 }
    },
    "color": {
      "palette": ["#ff00aa", "#00ffcc", "#ffd700", "#ffffff"],
      "selection": "random"
    },
    "physics": {
      "gravity":       [0, -9.8, 0],
      "drag":          0.05
    },
    "audio": {
      "asset_id": "ast_a1b2c3d4e5",
      "volume":   0.7
    }
  }
}
```

Schema is **versioned** (`"version": 1`) and additive — recipes authored against v1 keep working as v2 introduces optional fields.

### Recipe primitives

The interpreter supports a fixed library of *node kinds* — the building blocks recipes compose:

- **`particle_burst`** — emit N particles from a shape, evolve them by physics, render as quads/sprites. The workhorse for confetti, sparks, smoke puffs.
- **`audio`** — play a sound (asset reference) at a position, optionally panned spatially.
- **`camera_shake`** — local shake on receivers within a radius.
- **`mesh_instance`** — spawn a transient mesh from an uploaded `.glb` asset that animates and disposes (e.g. a sword swing trail, a popping balloon model).
- **`sequence`** — temporal composition: run a list of nodes in order with optional delays.
- **`parallel`** — temporal composition: run nodes simultaneously.

Adding a *new node kind* still requires a code deploy (someone has to write the renderer). But the existing kinds are powerful enough to cover the vast majority of "burst, sound, screen effect" needs admin will want — confetti, fireworks, sparks, flashes, impacts, all expressible as `particle_burst` + `audio` + `camera_shake` parallel-composed.

### Trigger flow

```
Admin types: emitRecipe("rcp_confetti_burst_v1", { position: [12, 0, -3] })
        │
        ▼
ClientMessage::SceneEvent { event: PlayRecipe { recipe_id, position, overrides } }
        │
        ▼
Server validates (rate-limit, recipe exists), broadcasts to others
        │
        ▼
Each client looks up recipe_id in its local recipe store
        │
        ▼
RecipeInterpreter.play(recipe, position, overrides)
        │
        ▼
Particle system + audio + shake all fire from one trigger
```

The wire format does NOT carry the recipe body on every trigger — only the `recipe_id`. Recipe bodies are uploaded once (server stores, broadcasts to clients), then triggers are tiny.

### Recipe upload

Recipes are uploaded the same way assets are (per ADR-007), but with a JSON-shape validation step:

```
POST /api/recipes
  Authorization: Bearer <admin-token>
  Content-Type: application/json
  Body: <Recipe JSON>

  Response: 201 Created (echoes the assigned id)
```

Server validates against the schema (well-formed, references exist for any `asset_id` fields), assigns `id`, persists to disk in `recipes.json`, broadcasts:

```rust
SceneEvent::RecipeAvailable { id, version, name }
```

Connected clients fetch the body via `GET /api/recipes/:id` and store in a local recipe map. New clients on connect receive the full recipe set via existing `FullState` extended to include recipes (or a separate `RecipeFullState` message).

### Authoring

Two paths:

1. **Hand-written JSON** — admin writes a recipe document and POSTs it. Suitable for power users / for me as the first admin.
2. **In-browser recipe editor** — a node-graph or form-based editor that produces the JSON. Lands as part of ADR-005 phase 4 (animation/scripted behavior). Out of scope for this ADR; the schema is designed to be authorable by both hands and tools.

### Validation

Two layers of validation:

- **Schema** (server-side, on POST): the JSON parses against the `Recipe` schema. Bad JSON, unknown node kinds, out-of-range parameters return `400` with a useful error.
- **Trigger** (server-side, on each `PlayRecipe` event): the referenced `recipe_id` exists, the actor's rate limit isn't exceeded, the position is finite. Same per-variant infrastructure as ADR-006's `validate_event`.

Receivers don't re-validate — they trust recipes that came through the server.

### Persistence

- `recipes.json` — full recipe bodies, replayed on server boot like the entity snapshot from ADR-004.
- `assets.json` — asset metadata (per ADR-007).
- `state.json` — entity snapshot (per ADR-004).

Three sibling files in the configured persistence directory. Each is independently versioned, atomically written, gracefully handled if missing/corrupt.

## Rationale

### Why not "ship a small JS sandbox"

The temptation is to let admin write a JavaScript function that runs on every client. That's the most powerful path — and the most dangerous. Sandbox escape, infinite loops, memory leaks, and the security-review burden of executable bytes flowing from server to clients are real costs that don't appear until they catch fire.

The recipe approach captures 95% of the practical authoring power (real game engines all use it) at 5% of the security cost. The 5% it doesn't capture (truly novel rendering — say, a custom shader for "the world melts") is a smaller category than it sounds; almost everything desirable is parameterised composition of existing primitives.

If/when a use case genuinely requires runtime code execution, that's its own ADR with its own security analysis — not a casual feature.

### Why version recipes

Inevitable as the library evolves: today's "confetti" recipe references parameters that v2 might rename or restructure. Versioning lets old recipes keep working under the v1 interpreter while v2 layers in new node kinds. Mirrors how Unity's VFX Graph and Source's PCF format do it.

### Why separate from `Entity`

It's tempting to make `Recipe` an entity kind ("EntityKind::Recipe"). Doesn't fit:
- Recipes have no transform — they're not in the world
- They aren't instantiated; they're triggered
- Their lifecycle is "uploaded once, ref'd many times" — opposite of entities

The asset-and-trigger pattern is the right shape.

## Consequences

### Positive

- **No redeploy per effect** — admin authors a JSON recipe + uploads, fire it from anywhere. End goal achieved.
- **Composable primitives** — particle_burst + audio + camera_shake gives most of the visual effects portfolio you'd want.
- **Audio + model assets attach by id** — a recipe references uploaded assets by their content-address, so audio and `.glb` chunks are themselves versioned and cacheable.
- **Triggers are tiny on the wire** — only the `recipe_id` + position travels per fire, not the whole effect description.

### Negative

- **Adding a brand-new node kind still requires a code deploy.** If admin wants a new primitive (e.g. "trail effect" or "ribbon mesh"), someone writes the renderer and ships. Acceptable: the existing primitives are designed to be expressive enough that this is rare.
- **Recipe authoring without a UI is JSON-by-hand.** Initial productivity cost; ADR-005 phase 4 lands the editor.
- **The interpreter is a real piece of code** — particle systems with the expressiveness described here are 1000+ lines. Bug surface: real. Mitigated by extensive tests at the primitive level and the reference implementations available (Three.js's particle examples, drei's `<Trail>`, etc.).

### Threat model

Recipes upload via authenticated admin endpoint; only admin can author. Triggers come over the existing rate-limited SceneEvent channel — a malicious connected client can't spam recipe triggers past the server's per-actor cap. The recipe content itself isn't executable code (it's JSON), so a malicious recipe can at worst be visually annoying, not security-relevant. The interpreter clamps unbounded numeric parameters (count cap of 5000 particles per burst, lifetime cap of 30s, etc.) so no recipe can crash a receiver.

## Phasing

1. **Recipe types + schema** — Rust + TS, with `version: 1` and the listed node kinds. Validation + persistence. (~2 days.)
2. **Particle interpreter** — the workhorse `particle_burst` node, drawing on Three.js's `Points` or `InstancedMesh`. Tests for the spec→geometry transform. (~3 days.)
3. **Audio + camera_shake nodes** — wraps the existing audio + shake primitives, just driven by recipe params. (~half a day.)
4. **mesh_instance node** — transient `.glb` spawn that loads the asset, plays a small fly-in/out animation, disposes. (~1 day.)
5. **`sequence` + `parallel` composition** — the time-graph nodes. (~1 day.)
6. **Trigger flow + recipe upload endpoint** — the runtime path. Wire `emitRecipe` + `useSceneEvent('play_recipe', ...)` end-to-end. (~half a day.)
7. **In-browser recipe editor** — deferred to ADR-005 phase 4.

Phases 1–6 represent ~1.5 weeks of focused work. Phase 7 is a separate effort. None are coupled to each other; phases 2–5 each add an authoring primitive and can ship independently.

## Open questions deferred

- **Cross-recipe references** — should one recipe be able to invoke another (e.g. "play `confetti_burst` and then play `applause_audio`")? Probably yes via a `play_recipe` node added to the primitive library. Defer until the simple cases are proven.
- **Time-varying parameters** — Niagara/VFX Graph let parameters animate over particle lifetime. The schema above hints at this with `start`/`end` for `size`; full curve support (custom Bezier curves per parameter) would be a v2 schema feature.
- **Per-receiver random seeds** — should two clients see the *exact same* particles, or two random instances of the same recipe? Determinism cost vs. visual diversity. Default to **per-receiver random** — visually identical-looking but actually independent particle simulations — since shared determinism is hard and not visibly missed.
