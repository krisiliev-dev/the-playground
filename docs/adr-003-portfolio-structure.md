# ADR-003: Portfolio Structure — Portals, Rooms, and the Document Fallback

## Status

Accepted

## Date

2026-05-01

## Context

The Playground has matured from a "cool 3D thing" into a personal portfolio
website. It needs to communicate who the author is, showcase work, host
writing, and be discoverable by both human visitors (employers, peers,
casual passers-by) and machines (search crawlers, link-preview bots,
screen readers).

The existing 3D experience — cube room, sword reveal, formation, cursor
avatar — is the differentiator. The risk patterns of pure-immersion
portfolios (Bruno Simon, Henry Heffernan) are well-documented: they
sacrifice SEO, recruiter convenience, and accessibility in exchange for
distinctiveness. Authors who succeed with that trade typically have an
external traffic source (newsletter, dev-Twitter, conference circuit)
that mitigates the discoverability cost. We don't, yet.

We need a structure that:

- Uses the 3D experience as the front door
- Doesn't lock out anyone who can't or won't engage with it
- Is indexable by search engines and link-preview bots
- Has a coherent way to navigate to and between sections
- Doesn't clutter the immersive experience with persistent UI chrome

## Decision

### 1. Four portals inside the sword formation, each leading to a room

The sword reveal animation already produces a circular formation. The
formation will contain four interactable **portals**, each mapped to one
section of the site. Walking into or clicking a portal lerps the user
into a new **room** (a distinct cube with its own visual identity). The
rooms are siblings of each other; the formation is the parent.

The four portals:

| Portal | Section | Contents |
|---|---|---|
| **About** | Who you are | Story, career history, education, what kinds of problems you find interesting. Career and education are merged into About — they don't earn standalone portals. |
| **Projects** | Featured work | 3–5 deeply documented case studies. The Playground itself is project #1 — the meta angle is part of the story. Each project answers: what it does, who it's for, did it work, what was hard. |
| **Writing** | How you think | Articles, build logs, technical deep dives. Sparse content is fine — three strong posts beat thirty weak ones. |
| **Simple Experience** | The escape hatch | Toggles to a flat document version of the entire site. Visually distinct from the other portals — clean rectangular "frame" instead of organic/glowing — so it reads as fourth-wall-breaking. |

A fifth **Now** portal (Sivers-style, "what I'm working on right now")
is deferred. It can be added later as a fifth point on the formation
without disturbing the others.

### 2. Each portal has a URL; URL routing is the source of truth

Routes:

- `/` — formation (default landing)
- `/about` — About room
- `/projects` — Projects room
- `/projects/<slug>` — individual project case study
- `/writing` — Writing room
- `/writing/<slug>` — individual article

Walking into a portal triggers a route push. Direct loads to a deep
route (`/projects/playground`) skip the formation animation and place
the user inside that room. The formation animation plays once per
session on first arrival at `/`; subsequent navigation between sections
does not replay it.

**Simple Experience is a mode, not a route.** Toggling it switches the
entire site between 3D and document rendering while preserving the
current route — `/projects` in 3D mode and `/projects` in document mode
show the same content, different rendering.

### 3. Build-time prerendering for SEO and link previews

The site is a Vite + React SPA. Without prerendering, crawlers see an
empty `<div id="root"></div>`. Build-time prerendering (likely Vike,
fka vite-plugin-ssr; alternatives are react-snap or a static-site
mode) walks the routes at build time and emits one HTML file per route
with the content baked in. The 3D experience hydrates on top.

This unlocks:

- Real SEO across all four sections
- Working link previews on Slack/Twitter/LinkedIn (titles, descriptions,
  Open Graph images)
- Screen-reader compatible content in the document fallback
- "Hidden DOM" no longer needed — content exists in the prerendered HTML

### 4. No persistent screen chrome — a pause menu surfaces auxiliary UI

The 3D experience must not be cluttered with overlay buttons. Instead:

- **Desktop**: pressing `Esc` (or `M`) summons a translucent overlay menu
- **Mobile**: a single small `≡` icon in the corner — the only persistent
  UI element on touch, since there's no keyboard

Menu contents:

- **Back** — `history.back()`. Greyed out at the formation.
- **Four section shortcuts** — direct navigation between sections
  without walking back to the formation
- **Contact** — opens an inline contact card with email + 2–3 socials.
  No navigation away.
- **Simple Experience toggle** — switches modes
- **Audio** — mute/unmute
- **Controls reference** — quick keymap reminder

Click outside or press `Esc` again to dismiss.

This pattern means the screen is genuinely empty when the menu is
closed, and *everything* is one keystroke away when it's open. Future
options (quality settings, reduced-motion, high-contrast, etc.) can be
added to the menu without re-architecting the UI.

### 5. Back navigation is browser history, exposed two ways

- Browser back button works (because it always does, and we lean on it)
- The pause menu's "Back" button calls `history.back()`
- Each non-formation room has a **return portal** placed behind the
  spawn point — visually echoes the Simple Experience portal style
  (clean frame, signals "exit"), positioned consistently across rooms
  so users learn its location

Three independent paths to the same action; all backed by the same URL
state. Browser back, trackpad swipe-back, right-click-back all work for
free.

### 6. Two affordances for the Simple Experience toggle

- **In-world**: the framed Simple Experience portal in the formation,
  discovered through play
- **In-menu**: the toggle in the pause menu, discovered through
  impatience

Both serve different user models; both go to the same toggle.

### 7. Asset loading is progressive

Initial bundle includes only what's needed to render the formation
experience. Each section's room assets (geometry, textures, audio) are
code-split and lazy-loaded. The formation itself is the loading
threshold — once it's interactable, additional assets load in the
background while the user explores.

## Consequences

### What we gain

- Navigation that fits the medium — spatial memory carries across visits
- A real document fallback that's not an afterthought
- Indexable, shareable, screen-reader-compatible content
- A clean, chrome-free 3D experience
- Predictable URL semantics that integrate with the platform (back button,
  share links, deep links)
- A natural growth axis: add a fifth portal (Now), or add new sections,
  without rearchitecting

### What we accept

- Implementation complexity: every section now has both a 3D
  representation and a document version. They share content sources but
  diverge on render.
- Initial-build setup cost (router, prerendering, menu component) before
  any section content goes in. Roughly one focused session of structural
  work.
- Some content gets written twice in different forms — "what to read"
  vs "what to walk through." Mitigation: the same data drives both
  views; only the presentation differs.
- The 3D experience can never assume the user is "in" the experience —
  any deep link could land them mid-room without the formation context.
  Each room must be self-contained.

## Build order (subject to revision)

The order is structured so that after step 4, the site is **fully
functional as a portfolio** — every section is reachable, indexable,
and shareable, even if the 3D layer is incomplete.

1. **URL routing scaffolding** — install a router (likely `react-router`
   or `tanstack-router`); define the four routes; stub their pages with
   placeholder content. Unlocks shareable links and the back button.
2. **Pause menu component** — overlay summoned by `Esc` / `≡`; works in
   both 3D and Simple Experience modes; contains the menu items above.
   Use plain React; no Three.js dependency.
3. **Build-time prerendering** — Vike or equivalent. Verify with
   `view-source:` that content is in the initial HTML. Confirm link
   previews work on Slack/Twitter.
4. **Simple Experience routes** — flat document version of each section,
   cleanly styled, the destination of the toggle and the prerendered
   target.
5. **In-world portal infrastructure** — each portal interactable in the
   sword formation pushes a route on click/walk-into. Camera transitions
   between the formation and the room. The 3D layer becomes a fancy
   router driver.
6. **Content** for each section — written once, rendered twice (3D
   placement + document layout).
7. **Multiplayer** — see ADR-002.

## Key constraints

- **Each room is self-contained.** Direct deep-link loads must work
  without the formation animation having played. The room must read
  even on its first frame.
- **The pause menu is the *only* persistent UI** on desktop; the mobile
  `≡` icon is the only persistent UI on touch. Anything else that wants
  to be "always available" goes into the menu.
- **Routing is the source of truth.** Camera position, room identity,
  and active section all derive from the URL. The URL is what gets
  shared, bookmarked, and sent to crawlers.
- **The Simple Experience must be feature-complete.** It's not a
  fallback shame-version; it's a first-class rendering of the same
  content, selected for users who prefer or require it.
