/**
 * Vitest setup file — runs before every test suite.
 * Configures DOM matchers and mocks browser APIs not available in jsdom.
 */
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount React trees between tests so subsequent `render()` calls don't
// see lingering DOM from the previous test.
afterEach(() => {
  cleanup();
});

/**
 * Mock WebGL context since jsdom doesn't support it.
 * Three.js tries to create a canvas context on import, which would
 * fail without this mock.
 */
const mockWebGLContext = {
  canvas: document.createElement('canvas'),
  getExtension: () => null,
  getParameter: () => 0,
  createShader: () => ({}),
  shaderSource: () => undefined,
  compileShader: () => undefined,
  createProgram: () => ({}),
  attachShader: () => undefined,
  linkProgram: () => undefined,
  getProgramParameter: () => true,
  getShaderParameter: () => true,
  useProgram: () => undefined,
  createBuffer: () => ({}),
  bindBuffer: () => undefined,
  bufferData: () => undefined,
  enable: () => undefined,
  disable: () => undefined,
  viewport: () => undefined,
  clearColor: () => undefined,
  clear: () => undefined,
  drawArrays: () => undefined,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  deleteShader: () => undefined,
};

/**
 * Mock 2D canvas context. jsdom doesn't ship one without the optional
 * `canvas` npm package; Sword.tsx generates a star texture via
 * `canvas.getContext('2d')` + `createImageData` / `putImageData`, so we
 * stub just enough of the API for that path.
 */
const mock2DContext = {
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  }),
  putImageData: () => undefined,
  fillRect: () => undefined,
  clearRect: () => undefined,
  drawImage: () => undefined,
};

// Override getContext to return our WebGL or 2D mocks. Avoid binding the
// original to the prototype — that captures `this` permanently and breaks
// any later real-canvas calls.
HTMLCanvasElement.prototype.getContext = function (contextId: string) {
  if (contextId === 'webgl' || contextId === 'webgl2') {
    return mockWebGLContext;
  }
  if (contextId === '2d') {
    return mock2DContext;
  }
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;
