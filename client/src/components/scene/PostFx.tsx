/**
 * PostFx — full-screen post-processing stack.
 *
 * Pulls together the cyberpunk look in one composer pass: bloom on emissive
 * surfaces (the cyan grid, portal, anything else with high luminance), a
 * subtle chromatic aberration for analog-screen feel, and a vignette to
 * frame the eye on the centre of the cube.
 *
 * Mounted as a child of the R3F Canvas. Order in `<EffectComposer>` matters:
 * effects compose top-to-bottom over the rendered scene.
 */
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import { Vector2 } from 'three';

export function PostFx(): JSX.Element {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        // luminanceThreshold: only pixels brighter than this contribute.
        // Set just below pure cyan brightness so the grid + portal glow but
        // the dark background doesn't haze.
        luminanceThreshold={0.18}
        luminanceSmoothing={0.4}
        intensity={1.6}
        // mipmapBlur is the modern, fast Gaussian — much cleaner than the
        // legacy multi-pass blur for wide bloom radii.
        mipmapBlur
        kernelSize={KernelSize.LARGE}
      />
      <ChromaticAberration
        // CRT/analog-screen feel. Tiny offset; bigger and it reads as
        // broken rather than stylised.
        blendFunction={BlendFunction.NORMAL}
        offset={new Vector2(0.0008, 0.0008)}
        radialModulation={false}
        modulationOffset={0}
      />
      <Vignette
        // Subtle inward darkening that pulls the eye to the centre of the
        // cube without making the corners feel crushed.
        offset={0.35}
        darkness={0.6}
        eskil={false}
      />
    </EffectComposer>
  );
}
