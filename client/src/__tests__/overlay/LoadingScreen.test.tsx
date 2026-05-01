/**
 * LoadingScreen — boot-gate state machine. Tests the two terminal
 * outcomes (`onReady` after probe success + preload, `onFailed` after
 * probe retry exhaustion) by stubbing the WebGL probe canvas's
 * `getContext` to either pass or fail. `sfx.preload` is mocked to
 * resolve instantly so the audio step doesn't block the test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// `vi.mock` is hoisted to the top of the file, *above* any normal
// `const` declarations — referenced spies must be wrapped in
// `vi.hoisted` to share the same hoisting behaviour.
const mocks = vi.hoisted(() => ({
  preloadSpy: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/components/audio/SfxManager', () => ({
  sfx: {
    preload: mocks.preloadSpy,
  },
}));

import { LoadingScreen } from '@/components/overlay/LoadingScreen';

interface FakeGL {
  isContextLost: () => boolean;
  getShaderPrecisionFormat: () => { precision: number } | null;
  getExtension: (name: string) => unknown;
  VERTEX_SHADER: number;
  HIGH_FLOAT: number;
}

function makePassingGL(): FakeGL {
  return {
    isContextLost: () => false,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getExtension: () => null,
    VERTEX_SHADER: 0x8b31,
    HIGH_FLOAT: 0x8df2,
  };
}

/** Stub HTMLCanvasElement.prototype.getContext via Object.defineProperty
 *  rather than direct assignment — keeps us off the heavily overloaded
 *  signature without `as any` casts, and pairs cleanly with the
 *  descriptor-based restore in afterEach. */
function stubGetContext(impl: (type: string) => unknown): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(impl),
    writable: true,
    configurable: true,
  });
}

describe('LoadingScreen', () => {
  // Save the original getContext via PropertyDescriptor — assigning
  // back through `prototype.getContext = …` triggers eslint's
  // unbound-method rule and is inferior anyway because it doesn't
  // restore the original property's writability/enumerability.
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mocks.preloadSpy.mockClear();
    mocks.preloadSpy.mockImplementation(() => Promise.resolve());
    originalDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalDescriptor);
    }
  });

  it('renders the loading UI with a status role + animated stage text', async () => {
    // The stub probe never actually runs in this test (no
    // stubGetContext call) — useEffect's first synchronous setStage
    // bumps text to "Verifying GPU context…" before we query DOM,
    // so check for *either* the initial or the verifying text.
    //
    // We MUST await the boot sequence to terminal state (onFailed
    // here, because jsdom's mocked getContext lacks
    // getShaderPrecisionFormat). Otherwise the retry loop is still
    // running when the next test stubs getContext to pass, and the
    // leaked boot sequence calls preloadSpy alongside that test's
    // own — making the next assertion's call count flaky.
    const onFailed = vi.fn();
    const { getByRole } = render(<LoadingScreen onReady={() => undefined} onFailed={onFailed} />);
    const status = getByRole('status');
    expect(status.textContent).toMatch(/Initialising renderer|Verifying GPU context/);
    await waitFor(() => expect(onFailed).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('calls onReady after probe success and preload resolution', async () => {
    stubGetContext((type) => (type === 'webgl' || type === 'webgl2' ? makePassingGL() : null));

    const onReady = vi.fn();
    const onFailed = vi.fn();
    render(<LoadingScreen onReady={onReady} onFailed={onFailed} />);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onFailed).not.toHaveBeenCalled();
    expect(mocks.preloadSpy).toHaveBeenCalledTimes(1);
  });

  it('calls onFailed when getContext returns null on every attempt', async () => {
    stubGetContext(() => null);

    const onReady = vi.fn();
    const onFailed = vi.fn();
    render(<LoadingScreen onReady={onReady} onFailed={onFailed} />);

    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onReady).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith('webgl-unavailable');
  });

  it('calls onFailed when isContextLost reports true (born-lost ctx)', async () => {
    stubGetContext((type) =>
      type === 'webgl' || type === 'webgl2'
        ? { ...makePassingGL(), isContextLost: () => true }
        : null,
    );

    const onReady = vi.fn();
    const onFailed = vi.fn();
    render(<LoadingScreen onReady={onReady} onFailed={onFailed} />);

    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onReady).not.toHaveBeenCalled();
  });

  it('treats audio preload failure as non-fatal (still calls onReady)', async () => {
    stubGetContext((type) => (type === 'webgl' || type === 'webgl2' ? makePassingGL() : null));
    mocks.preloadSpy.mockImplementationOnce(() => Promise.reject(new Error('decode failed')));

    const onReady = vi.fn();
    const onFailed = vi.fn();
    render(<LoadingScreen onReady={onReady} onFailed={onFailed} />);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onFailed).not.toHaveBeenCalled();
  });
});
