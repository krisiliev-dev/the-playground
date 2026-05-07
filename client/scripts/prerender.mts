/**
 * Build-time prerender — emits per-route static HTML so search
 * engines, link-preview bots, and screen readers see real content
 * for every route in the registry without executing JavaScript.
 *
 * Why a custom script rather than Vike or vite-react-ssg:
 *   - The 3D Canvas (R3F + Three.js) doesn't run in Node and needs
 *     a `<ClientOnly>` wrapper or framework escape hatch to skip
 *     during SSR. Frameworks make you solve that problem.
 *   - `SectionPage` is pure React with zero R3F dependency — it
 *     reads `useLocation()` and emits the matching route's content
 *     via `RouteDocument`. It's already SSR-safe.
 *   - The complete prerender step is ~80 lines instead of a
 *     framework migration.
 *
 * What this does:
 *   1. Reads `dist/index.html` (the SPA shell built by Vite).
 *   2. For each route in `FLAT_ROUTES` (the same registry the
 *      runtime app reads), renders `<SectionPage>` to static markup
 *      with `react-dom/server`, wrapped in `MemoryRouter` so
 *      `useLocation` and `<Link>` resolve cleanly.
 *   3. Injects the markup into the `<div id="root">…</div>`
 *      placeholder.
 *   4. Sets a per-route `<title>` and meta description derived from
 *      the route's first heading + paragraph, so social shares + tab
 *      titles read correctly.
 *   5. Writes `dist/<route>/index.html` so static hosts serve the
 *      prerendered HTML for direct loads, while SPA navigation
 *      still works after hydration.
 *
 * Adding a new section is one declaration in `content/routes.ts` —
 * this script picks it up automatically.
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The store reads `typeof window === 'undefined'` and defaults
// `documentMode` to `true` for SSR — so `SectionPage` emits its
// document-mode variant here without any explicit setup from
// this script.
import { FLAT_ROUTES, type ContentNode, type Route } from '../src/content/routes.js';
import { SectionPage } from '../src/routes/SectionPage.js';
import { DocumentShell } from '../src/components/document/DocumentShell.js';

const SITE_NAME = 'Kristiyan Iliev';
const FALLBACK_DESCRIPTION =
  'Software engineer building interactive 3D experiences. Walk through the rooms behind the cube — About, Projects, Writing.';

/** Pick a per-route title: the first heading on the route, falling
 *  back to the site name. Suffix with the site name for non-root
 *  routes so search results read "About — Kristiyan Iliev". */
function deriveTitle(route: Route): string {
  const headingNode = (route.content ?? []).find(
    (n): n is Extract<ContentNode, { kind: 'heading' }> => n.kind === 'heading',
  );
  if (!headingNode) {
    return SITE_NAME;
  }
  if (route.path === '/') {
    return headingNode.body;
  }
  return `${headingNode.body} — ${SITE_NAME}`;
}

/** Pick a per-route description: the first paragraph on the route,
 *  falling back to the site description. */
function deriveDescription(route: Route): string {
  const paragraphNode = (route.content ?? []).find(
    (n): n is Extract<ContentNode, { kind: 'paragraph' }> => n.kind === 'paragraph',
  );
  return paragraphNode?.body ?? FALLBACK_DESCRIPTION;
}

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');

const template = readFileSync(resolve(distDir, 'index.html'), 'utf-8');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(route: Route): string {
  // MemoryRouter works server-side (no DOM dependency) and is fine
  // for one-shot SSG rendering — we don't need history navigation,
  // just a Router context so `useLocation` and `<Link>` resolve.
  //
  // Wrap in DocumentShell so the prerendered HTML matches exactly
  // what App.tsx would render in document mode at runtime. That
  // parity is what makes hydration clean: a user with localStorage
  // `documentMode === 'true'` sees no flicker between SSR and
  // client.
  const content = renderToString(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route.path] },
      React.createElement(DocumentShell, null, React.createElement(SectionPage)),
    ),
  );

  let html = template.replace('<div id="root"></div>', `<div id="root">${content}</div>`);

  const title = deriveTitle(route);
  const description = deriveDescription(route);

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

  if (/<meta\s+name="description"/i.test(html)) {
    html = html.replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${escapeHtml(description)}">`,
    );
  } else {
    html = html.replace(
      '</head>',
      `  <meta name="description" content="${escapeHtml(description)}">\n  </head>`,
    );
  }

  return html;
}

let written = 0;
for (const fr of FLAT_ROUTES) {
  const route = fr.route;
  const html = render(route);
  // The root route '/' overwrites dist/index.html (the SPA shell);
  // every other route writes to dist/<route>/index.html so static
  // hosts serve the matching prerendered HTML directly.
  const outPath =
    route.path === '/'
      ? resolve(distDir, 'index.html')
      : resolve(distDir, route.path.replace(/^\//, ''), 'index.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`✓ prerendered ${route.path} → ${outPath.replace(`${distDir}/`, 'dist/')}`);
  written += 1;
}

// eslint-disable-next-line no-console
console.log(`\n${written} route${written === 1 ? '' : 's'} prerendered.`);
