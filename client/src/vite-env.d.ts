/// <reference types="vite/client" />

/**
 * Type declarations for non-code imports.
 * Tells TypeScript how to handle .glb, .gltf, and image imports.
 */

declare module '*.glb' {
  const src: string;
  export default src;
}

declare module '*.gltf' {
  const src: string;
  export default src;
}

declare module '*.hdr' {
  const src: string;
  export default src;
}
