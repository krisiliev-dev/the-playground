/**
 * Home — has two render modes that pivot on `documentMode`:
 *
 *   - 3D mode (`documentMode === false`): renders sr-only at `/` for
 *     the benefit of crawlers, link-preview bots, and screen readers.
 *     Sighted JS users see only the cube formation; this DOM stays
 *     off-screen via the standard clip + 1×1 px pattern.
 *   - Document mode (`documentMode === true`): renders as the visible
 *     landing page inside DocumentShell's main slot. This is what
 *     prerendered HTML emits, and what real users see when they flip
 *     the Simple Experience toggle.
 *
 * Why sr-only in 3D mode (not `display: none` or `<noscript>`):
 *   - `display: none` removes content from the accessibility tree —
 *     crawlers and screen readers both lose it.
 *   - `<noscript>` only renders when JS is disabled, which is exactly
 *     the case where assistive tech is most likely active.
 *   - sr-only (clip + 1×1 pixel + absolute positioning) keeps the
 *     content in the DOM + accessibility tree but invisible. Best of
 *     all worlds for the 3D-by-default visitor.
 */
import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { useWorldStore } from '@/store';

export function Home(): JSX.Element {
  const documentMode = useWorldStore((s) => s.documentMode);

  if (documentMode) {
    return <HomeDocument />;
  }

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
 * Visible landing page rendered in document mode and in prerendered
 * HTML. DocumentShell already provides the page chrome (sticky
 * header with brand + section nav, footer with copyright + back-to-
 * 3D toggle), so this component is body-only — hero + bio + section
 * cards inside DocumentShell's max-width 760px main slot.
 *
 * The first ~200 chars of body text are what link-preview unfurls
 * surface, so the tagline + opening sentence are intentionally
 * front-loaded with what the page is about.
 */
const SECTIONS: ReadonlyArray<{ to: string; label: string; desc: string }> = [
  {
    to: '/about',
    label: 'About',
    desc: 'Story, career history, and what I’m focused on now.',
  },
  {
    to: '/projects',
    label: 'Projects',
    desc: 'Featured work and case studies — including this site, which documents how it was built.',
  },
  {
    to: '/writing',
    label: 'Writing',
    desc: 'Articles, build logs, and technical deep dives.',
  },
];

function HomeDocument(): JSX.Element {
  return (
    <main aria-label="Home">
      <header style={documentStyles.hero}>
        <h1 style={documentStyles.name}>Kristiyan Iliev</h1>
        <p style={documentStyles.tagline}>
          Software engineer building interactive 3D experiences on the web.
        </p>
      </header>
      <p style={documentStyles.body}>
        This is the flat, text-first view of my portfolio. The default experience is a 3D cube
        formation you explore directly — Simple Experience strips that down to a document so you can
        read, scan, and link without waiting for the scene to boot. Everything reachable from the 3D
        version is reachable from here.
      </p>
      <ul style={documentStyles.sections} aria-label="Sections">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <Link to={section.to} style={documentStyles.sectionLink}>
              <span style={documentStyles.sectionLabel}>{section.label}</span>
              <span style={documentStyles.sectionDesc}>{section.desc}</span>
            </Link>
          </li>
        ))}
      </ul>
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

/**
 * Suggested style scaffolding for the document-mode landing page.
 * Use whichever pieces fit, ignore the rest, or add your own.
 * Colors mirror DocumentShell so the hero feels stitched in:
 * `#00ffcc` for accents, `#e0fffa` for primary text, muted teal for
 * secondary text.
 */
export const documentStyles: Record<string, CSSProperties> = {
  hero: {
    margin: '24px 0 48px',
  },
  name: {
    margin: 0,
    fontSize: 48,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: '#e0fffa',
  },
  tagline: {
    margin: '12px 0 0',
    fontSize: 18,
    lineHeight: 1.5,
    color: '#00ffcc',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  body: {
    margin: '0 0 40px',
    fontSize: 16,
    lineHeight: 1.7,
    color: 'rgba(224, 255, 250, 0.85)',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  sectionLink: {
    display: 'block',
    padding: '16px 20px',
    border: '1px solid rgba(0, 255, 204, 0.25)',
    borderRadius: 8,
    background: 'rgba(0, 255, 204, 0.04)',
    color: '#e0fffa',
    textDecoration: 'none',
  },
  sectionLabel: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    color: '#00ffcc',
    marginBottom: 4,
  },
  sectionDesc: {
    display: 'block',
    fontSize: 14,
    color: 'rgba(224, 255, 250, 0.7)',
  },
};
