/**
 * Build-time prerender — emits per-route static HTML so search
 * engines, link-preview bots, and screen readers see real content
 * for /about, /projects, and /writing without executing JavaScript.
 *
 * Why a custom script rather than Vike or vite-react-ssg:
 *   - The 3D Canvas (R3F + Three.js) doesn't run in Node and needs
 *     a `<ClientOnly>` wrapper or framework escape hatch to skip
 *     during SSR. Frameworks make you solve that problem.
 *   - Our route components (About / Projects / Writing) are pure
 *     React with zero R3F dependency. They're already SSR-safe.
 *     The Canvas + overlays are unaffected (they only mount
 *     client-side after hydration).
 *   - The complete prerender step is ~50 lines instead of a
 *     framework migration.
 *
 * What this does:
 *   1. Reads `dist/index.html` (the SPA shell built by Vite).
 *   2. For each route, renders the route's component to static
 *      markup with `react-dom/server`, wrapped in `StaticRouter`
 *      so `<Link>` resolves cleanly.
 *   3. Injects the markup into the `<div id="root">…</div>`
 *      placeholder.
 *   4. Sets a per-route `<title>` and meta description so social
 *      shares + tab titles read correctly.
 *   5. Writes `dist/<route>/index.html` so static hosts serve the
 *      prerendered HTML for direct loads, while SPA navigation
 *      still works after hydration.
 *
 * The home route ('/') is intentionally NOT prerendered — its
 * "content" is the cube formation, which only exists at runtime.
 * The default `dist/index.html` (the SPA shell) handles that route
 * unchanged. Adding a flat home document is a follow-up.
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { About } from '../src/routes/About.js';
import { Projects } from '../src/routes/Projects.js';
import { Writing } from '../src/routes/Writing.js';

interface RouteConfig {
  path: string;
  Component: React.ComponentType;
  title: string;
  description: string;
}

const ROUTES: ReadonlyArray<RouteConfig> = [
  {
    path: '/about',
    Component: About,
    title: 'About — Kristiyan Iliev',
    description:
      'Software engineer building interactive 3D experiences. Story, career history, and education.',
  },
  {
    path: '/projects',
    Component: Projects,
    title: 'Projects — Kristiyan Iliev',
    description:
      'Featured work and case studies, including The Playground itself — a 3D portfolio that documents how it was built.',
  },
  {
    path: '/writing',
    Component: Writing,
    title: 'Writing — Kristiyan Iliev',
    description: 'Articles, build logs, and technical deep dives.',
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');

const template = readFileSync(resolve(distDir, 'index.html'), 'utf-8');

function render(route: RouteConfig): string {
  // MemoryRouter works server-side (no DOM dependency) and is fine
  // for one-shot SSG rendering — we don't need history navigation,
  // just a Router context so `<Link>` resolves cleanly.
  const content = renderToString(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route.path] },
      React.createElement(route.Component),
    ),
  );

  let html = template.replace('<div id="root"></div>', `<div id="root">${content}</div>`);

  // Per-route <title>. The shell's existing tag (whatever Vite
  // emitted — likely from index.html) gets replaced.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`);

  // Inject (or replace) a meta description. Crawlers + social
  // unfurls use this for the link-preview blurb.
  if (/<meta\s+name="description"/i.test(html)) {
    html = html.replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${route.description}">`,
    );
  } else {
    html = html.replace(
      '</head>',
      `  <meta name="description" content="${route.description}">\n  </head>`,
    );
  }

  return html;
}

let written = 0;
for (const route of ROUTES) {
  const html = render(route);
  const outDir = resolve(distDir, route.path.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'index.html');
  writeFileSync(outPath, html, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`✓ prerendered ${route.path} → ${outPath.replace(`${distDir}/`, 'dist/')}`);
  written += 1;
}

// eslint-disable-next-line no-console
console.log(`\n${written} route${written === 1 ? '' : 's'} prerendered.`);
