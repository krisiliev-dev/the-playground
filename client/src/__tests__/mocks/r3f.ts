/**
 * Centralized `@react-three/fiber` and `@react-three/drei` mock
 * factories for jsdom-based component tests.
 *
 * Each scene/component test that mounts an R3F-using component
 * needs to stub out the R3F runtime — it can't render in jsdom.
 * Before this file existed, every test inlined its own
 * `vi.mock('@react-three/fiber', () => ({ … }))` with subtly
 * different signatures (some with `createPortal`, some without;
 * some with `size`, some without). That made it easy to introduce
 * mock drift and wasted ~45 lines across the suite.
 *
 * Usage at the top of a test file:
 *
 *   vi.mock('@react-three/fiber', () => createR3FMock());
 *   vi.mock('@react-three/drei', () => createDreiMock());
 *
 * The factories return everything we've ever needed across the
 * scene tests. Any extra fields (e.g., a custom `gl` shape for a
 * specific test) can be merged on top of the result, since
 * `vi.mock` accepts a factory function.
 */
import { vi } from 'vitest';

interface R3FState {
  gl: {
    render: () => void;
    autoClear: boolean;
    autoClearColor: boolean;
    autoClearDepth: boolean;
    autoClearStencil: boolean;
    domElement: Record<string, unknown>;
    getContext: () => { isContextLost: () => boolean };
  };
  scene: Record<string, unknown>;
  camera: Record<string, unknown>;
  size: { width: number; height: number };
  pointer: { x: number; y: number };
  clock: { elapsedTime: number };
  invalidate: () => void;
  set: () => void;
}

function makeState(): R3FState {
  return {
    gl: {
      render: () => {},
      autoClear: true,
      autoClearColor: true,
      autoClearDepth: true,
      autoClearStencil: true,
      domElement: {},
      getContext: () => ({ isContextLost: () => false }),
    },
    scene: {},
    camera: {},
    size: { width: 800, height: 600 },
    pointer: { x: 0, y: 0 },
    clock: { elapsedTime: 0 },
    invalidate: () => {},
    set: () => {},
  };
}

interface R3FMock {
  useFrame: ReturnType<typeof vi.fn>;
  useThree: (selector?: (s: R3FState) => unknown) => unknown;
  createPortal: (children: unknown) => unknown;
  Canvas: (props: { children?: unknown }) => unknown;
}

interface DreiMock {
  useGLTF: () => { scene: { clone: () => Record<string, unknown>; traverse: () => void } };
  useFBO: () => { texture: null; setSize: () => void; dispose: () => void };
  OrbitControls: () => null;
  Trail: (props: { children?: unknown }) => unknown;
}

/**
 * Default `@react-three/fiber` mock. Returns a factory result
 * suitable for `vi.mock('@react-three/fiber', () => createR3FMock())`.
 */
export function createR3FMock(): R3FMock {
  return {
    useFrame: vi.fn(),
    useThree: (selector?: (s: R3FState) => unknown) => {
      const state = makeState();
      return selector ? selector(state) : state;
    },
    // Children mount inline in jsdom; the real createPortal targets a
    // separate THREE.Scene instance which doesn't exist in tests.
    createPortal: (children: unknown) => children,
    // Some tests render Canvas — give it a div passthrough.
    Canvas: ({ children }: { children?: unknown }) => children,
  };
}

/**
 * Default `@react-three/drei` mock. Covers the surface our scene
 * components actually call: useGLTF, useFBO, OrbitControls, Trail.
 */
export function createDreiMock(): DreiMock {
  return {
    useGLTF: () => ({ scene: { clone: () => ({}), traverse: () => {} } }),
    useFBO: () => ({ texture: null, setSize: () => {}, dispose: () => {} }),
    OrbitControls: () => null,
    Trail: ({ children }: { children?: unknown }) => children,
  };
}
