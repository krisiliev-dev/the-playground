/**
 * Vitest setup file — runs before every test suite.
 * Configures DOM matchers and mocks browser APIs not available in jsdom.
 */
import '@testing-library/jest-dom';

/**
 * Mock WebGL context since jsdom doesn't support it.
 * Three.js tries to create a canvas context on import, which would
 * fail without this mock.
 */
HTMLCanvasElement.prototype.getContext = ((originalGetContext) => {
  return function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    if (contextId === 'webgl' || contextId === 'webgl2') {
      return {
        canvas: this,
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
      } as unknown as WebGLRenderingContext;
    }
    return originalGetContext.call(this, contextId, options);
  };
})(HTMLCanvasElement.prototype.getContext);
