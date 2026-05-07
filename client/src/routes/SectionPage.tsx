/**
 * SectionPage — the single Simple Experience page component for
 * every route in the registry.
 *
 * Replaces the per-section pages (Home / About / Projects / Writing)
 * that used to hold hardcoded content. The page now reads its body
 * from `routes.ts` via `RouteDocument`, with the path coming from
 * react-router's `useLocation`. Adding a section is one route
 * declaration in the data file; the page rendering is shared.
 *
 * Two render modes:
 *
 *   - **Document mode** (`documentMode === true` — Simple Experience
 *     toggle, or initial SSR/prerender path): rendered visibly in
 *     `DocumentShell`'s main slot.
 *   - **3D mode** (`documentMode === false`): rendered `sr-only` so
 *     crawlers, link-preview bots, and screen readers see the same
 *     content the document mode shows. Sighted JS users see the 3D
 *     scene; the DOM stays present but invisible via the 1×1px
 *     clip-path technique.
 *
 * Why sr-only in 3D mode (not `display: none` or `<noscript>`):
 *   - `display: none` removes content from the accessibility tree.
 *   - `<noscript>` only renders when JS is disabled — the case where
 *     assistive tech is most likely needed.
 *   - sr-only keeps the content in both the DOM and the
 *     accessibility tree, invisible to sighted users only.
 */
import type { CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorldStore } from '@/store';
import { RouteDocument } from '@/content/RouteDocument';

export function SectionPage(): JSX.Element {
  const documentMode = useWorldStore((s) => s.documentMode);
  const location = useLocation();
  const path = location.pathname;

  if (documentMode) {
    return (
      <div style={documentStyles.shell}>
        <RouteDocument path={path} />
      </div>
    );
  }

  return (
    <main style={srOnly} aria-label="Site content">
      <RouteDocument path={path} />
    </main>
  );
}

const documentStyles: Record<string, CSSProperties> = {
  shell: {
    fontSize: 16,
    lineHeight: 1.65,
    color: 'rgba(224, 255, 250, 0.85)',
  },
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
