# Portfolio World

A 3D interactive portfolio website built with React Three Fiber, rendered entirely client-side for zero-cost scalability. Visitors explore a 3D environment as cursor avatars, discovering projects, bio information, and interactive experiences.

## Architecture

```
portfolio-world/
├── client/          # React + TypeScript + React Three Fiber frontend
├── server/          # Rust WebSocket server (multiplayer, live editing)
├── docs/            # Architecture decisions, guides
└── .github/         # CI/CD pipelines
```

### Why Client-Side Rendering?

- **Zero server GPU cost**: Each visitor's browser handles its own rendering
- **No input latency**: Interactions are instant (no round-trip to server)
- **Scales for free**: 1000 visitors = 1000 GPUs, none of them yours
- **Attack-resistant**: Malicious users only hurt their own machines

### Tech Stack

| Layer       | Technology                        | Purpose                            |
|-------------|-----------------------------------|------------------------------------|
| 3D Engine   | Three.js + React Three Fiber      | Declarative 3D scene in React      |
| UI          | React 18 + TypeScript             | Type-safe, component-based UI      |
| Styling     | CSS Modules / Tailwind            | Scoped, utility-first styles       |
| Post-FX     | @react-three/postprocessing       | Bloom, AO, DOF for visual polish   |
| 3D Models   | glTF/GLB format                   | Industry-standard web 3D format    |
| Server      | Rust (Axum + tokio-tungstenite)   | WebSocket relay, env state         |
| CI/CD       | GitHub Actions                    | Lint, test, build, deploy          |
| Hosting     | Vercel (client) + Fly.io (server) | Edge CDN + lightweight server      |

## Getting Started

### Prerequisites

- Node.js >= 20.x
- Rust >= 1.75 (for server development)
- pnpm >= 9.x

### Client Development

```bash
cd client
pnpm install
pnpm dev          # Start dev server at localhost:5173
pnpm test         # Run tests
pnpm lint         # Lint + format check
pnpm build        # Production build
```

### Server Development

```bash
cd server
cargo run          # Start WebSocket server at localhost:8080
cargo test         # Run tests
cargo clippy       # Lint
```

## Development Practices

- **Test-Driven Development**: Write tests first, then implementation
- **Clean Code**: Descriptive names, small functions, single responsibility
- **Documentation**: JSDoc/rustdoc on public APIs, architectural decision records in `/docs`
- **Linting**: ESLint + Prettier (client), Clippy + rustfmt (server)
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`
- **Branch Strategy**: `main` (prod) ← `develop` (demo) ← `feature/*` branches

## Environments

| Environment | URL                     | Deploys From | Purpose              |
|-------------|-------------------------|--------------|----------------------|
| Production  | krisiliev.dev           | `main`       | Live portfolio       |
| Demo        | demo.krisiliev.dev      | `develop`    | Staging / preview    |
| Preview     | PR-specific URL         | PR branches  | Per-PR preview       |
| API (prod)  | api.krisiliev.dev       | `main`       | WebSocket server     |
| API (demo)  | api-demo.krisiliev.dev  | `develop`    | Demo WS server       |

## License

Private - All rights reserved.
