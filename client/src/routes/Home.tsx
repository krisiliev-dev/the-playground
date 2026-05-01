/**
 * Home — visually-hidden intro that sits in the DOM at `/` for the
 * benefit of search-engine crawlers, link-preview bots, and screen
 * readers. Sighted JS users see only the cube formation; this
 * content is positioned off-screen via the standard sr-only pattern.
 *
 * Why this exists:
 *   - The cube formation is the visual home page, but it has no
 *     HTML representation — crawlers indexing `/` would otherwise
 *     see `<div id="root">…empty 3D canvas…</div>`.
 *   - With this component prerendered into dist/index.html, the
 *     initial response includes a real <h1>, intro copy, and
 *     section links. Slack/Twitter/LinkedIn unfurls get a real
 *     title + description; screen readers can navigate to sections
 *     without firing the cube reveal first.
 *
 * Why sr-only instead of `display: none` or `<noscript>`:
 *   - `display: none` removes content from the accessibility tree
 *     entirely — crawlers and screen readers both lose it.
 *   - `<noscript>` only renders when JS is disabled, which is
 *     exactly the case where assistive tech is most likely to be
 *     active.
 *   - sr-only (clip + 1×1 pixel + absolute positioning) keeps the
 *     content in the DOM and the accessibility tree but invisible
 *     to sighted users. Best of all worlds.
 *
 * Future: when the Simple Experience document mode lands (step 4),
 * this content gets promoted to the visible Home document view —
 * the sr-only wrapper becomes a regular page layout.
 */
import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

export function Home(): JSX.Element {
  return (
    <main style={srOnly} aria-label="Site introduction">
      <h1>Kristiyan Iliev</h1>
      <p>
        Software engineer building interactive 3D experiences. Click the cube to begin the reveal,
        or jump to a section directly:
      </p>
      <nav aria-label="Sections">
        <ul>
          <li>
            <Link to="/about">About — story, career history, current focus</Link>
          </li>
          <li>
            <Link to="/projects">Projects — featured work and case studies</Link>
          </li>
          <li>
            <Link to="/writing">Writing — articles, build logs, technical deep dives</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}

/**
 * Standard "screen-reader-only" CSS. Renders the element 1×1 pixel,
 * clipped to nothing, positioned absolutely so it doesn't take up
 * layout space — but it stays in the DOM and the accessibility tree
 * so assistive tech can read it.
 */
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
