# ADR-001: Client-Side Rendering over Pixel Streaming

## Status

Accepted

## Date

2026-04-05

## Context

We need to render a 3D portfolio environment that visitors access through their browsers. The environment contains navigable zones, cursor-based avatars, 3D models, and interactive elements. Two primary approaches were considered:

1. **Server-side rendering with pixel streaming** (Unreal Engine on a GPU server, encoding video frames to each client)
2. **Client-side rendering with WebGL** (Three.js/React Three Fiber running in the browser)

## Decision

We chose **client-side rendering with React Three Fiber** (Three.js).

## Rationale

### Cost Model

Pixel streaming requires a dedicated GPU encoding pipeline per concurrent user. At $0.50–$1.00/hr for a GPU instance, even 10 concurrent visitors costs $5–$10/hr ($3,600–$7,200/month). Client-side rendering costs $0 for rendering — each visitor uses their own GPU. The server only relays small WebSocket messages.

### Latency

Pixel streaming adds 50–150ms of latency on top of render time (input → server → render → encode → transmit → decode). For a portfolio site that should feel like a "normal website," this lag makes scrolling and clicking feel sluggish. Client-side rendering responds to input within a single frame (~16ms at 60fps).

### Attack Surface

With pixel streaming, an attacker can open many browser tabs to force GPU allocation, creating a direct cost amplification attack. With client-side rendering, the same attack only affects the attacker's own machine. The server handles WebSocket connections, which are cheap (thousands on a $5/month VPS).

### Scene Complexity

The portfolio scene (a box room, cursor avatars, text, a few 3D models, particle effects) is well within WebGL's capabilities. Unreal Engine's advanced features (Nanite, Lumen, ray tracing) are unnecessary for this complexity level.

### Developer Experience

React Three Fiber integrates into the existing React/TypeScript ecosystem. The 3D scene and 2D UI are a single React app, sharing state management (Zustand), routing, and tooling. With Unreal, the web layer and 3D layer would be separate codebases with a video stream bridge between them.

## Consequences

### Positive

- Zero rendering cost on the server
- Instant input response
- Single codebase (React + TypeScript)
- Broad device support (WebGL runs on ~97% of browsers)
- Simpler CI/CD (static site deployment for the client)

### Negative

- Performance depends on the visitor's device (low-end phones may struggle with heavy post-processing)
- Asset size matters — large 3D models increase initial load time
- No access to Unreal-level visual fidelity (ray tracing, Nanite meshes)

### Mitigations

- Progressive enhancement: detect device capability and adjust quality
- Asset optimization pipeline: compress models with gltf-transform, use Draco compression
- Lazy loading: only load zone assets when the player approaches

## Alternatives Considered

| Approach | Rejected Because |
|---|---|
| Unreal + Pixel Streaming | Cost, latency, complexity, overkill for scene |
| Unity + WebGL export | Larger runtime bundle, worse React integration |
| Babylon.js | Smaller ecosystem than Three.js, less React tooling |
| A-Frame | Higher-level abstraction limits fine control |

## References

- [Three.js performance guide](https://threejs.org/manual/#en/optimize-lots-of-objects)
- [React Three Fiber docs](https://docs.pmnd.rs/react-three-fiber)
- [Bruno Simon's portfolio](https://bruno-simon.com/) — exemplary client-side 3D portfolio
