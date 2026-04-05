# Working with 3D Models

## Supported Format

The project uses **glTF 2.0** (`.glb` binary or `.gltf` + separate files). This is the standard format for web 3D — think of it as "JPEG for 3D models."

## Where to Find Models

| Source | Cost | Quality | Notes |
|---|---|---|---|
| [Sketchfab](https://sketchfab.com) | Free + Paid | High | Largest library, check license |
| [Poly Pizza](https://poly.pizza) | Free (CC0) | Medium | Low-poly, great for web perf |
| [Kenney](https://kenney.nl) | Free (CC0) | Medium | Game-ready, stylised |
| [ReadyPlayerMe](https://readyplayer.me) | Free | High | For your 3D avatar/likeness |
| [Mixamo](https://mixamo.com) | Free | High | Animated characters |
| [Quaternius](https://quaternius.com) | Free (CC0) | Medium | Packs with consistent style |

## Performance Budget

To keep the experience smooth across devices:

| Asset | Target | Hard Limit |
|---|---|---|
| Single model | < 2 MB | 5 MB |
| Total scene | < 20 MB | 40 MB |
| Triangles per model | < 50K | 150K |
| Textures per model | 1024×1024 | 2048×2048 |

## Optimising Models

### Using gltf-transform (recommended)

```bash
# Install globally
npm install -g @gltf-transform/cli

# Compress with Draco (geometry compression — ~70% smaller)
gltf-transform draco input.glb output.glb

# Resize textures to 1024px max
gltf-transform resize input.glb output.glb --width 1024 --height 1024

# Full optimisation pipeline
gltf-transform optimize input.glb output.glb \
  --compress draco \
  --texture-compress webp
```

### Using Blender

1. Import the model
2. Apply the **Decimate** modifier (ratio 0.5 halves triangle count)
3. Bake textures to smaller resolution if needed
4. Export as glTF 2.0 Binary (.glb)

## Adding a Model to the Project

1. Place the `.glb` file in `client/src/assets/models/`
2. Create a component that loads it:

```tsx
import { useGLTF } from '@react-three/drei';

interface ModelProps {
  readonly position?: [number, number, number];
  readonly scale?: number;
}

export function MyModel({ position = [0, 0, 0], scale = 1 }: ModelProps) {
  // useGLTF automatically handles loading, caching, and disposal
  const { scene } = useGLTF('/models/my-model.glb');

  return (
    <primitive
      object={scene.clone()} // Clone so multiple instances don't conflict
      position={position}
      scale={scale}
    />
  );
}

// Preload hint — starts downloading before the component mounts
useGLTF.preload('/models/my-model.glb');
```

3. Add it to the `World` component in the appropriate zone.

## Lazy Loading

For models that are only visible in specific zones, use React Suspense:

```tsx
import { Suspense, lazy } from 'react';

const HeavyModel = lazy(() => import('./HeavyModel'));

function PortfolioZone() {
  return (
    <Suspense fallback={<LoadingPlaceholder />}>
      <HeavyModel />
    </Suspense>
  );
}
```

This way, the model only downloads when the player enters that zone.

## Generating Your 3D Likeness

For the "About Me" zone, options for creating a 3D model of yourself:

1. **ReadyPlayerMe** — Upload a selfie, get a stylised avatar. Free, exports as GLB.
2. **Luma AI / Polycam** — Use your phone to 3D-scan yourself. More realistic but heavier meshes.
3. **Commission** — Hire a 3D artist on Fiverr/Upwork for a custom model in your preferred style.
4. **Blender + reference photos** — Model it yourself if you want to learn.

For web performance, a stylised/low-poly likeness (~10K triangles) will look better and load faster than a photorealistic scan (~500K triangles).
