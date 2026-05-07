/**
 * RouteDocument — renders a route's `content` as semantic HTML,
 * ordered by each node's `order` field.
 *
 * This is the Simple Experience view of a route, and the build-time
 * SSG step (when wired) renders this for each route into a static
 * HTML file. Crawlers and link-preview bots that don't run JS see
 * this output; users with JS get the 3D experience hydrated on top.
 *
 * **Source of truth: the 3D world.** The same `content` array the
 * 3D content renderer reads to place text/images in space is what
 * we order here into a 2D document. Edit one place, both views
 * update.
 *
 * Resolution rule: each page is **self-contained** — only the
 * matching route's own `content` is rendered. To see a child
 * route's content (e.g. `/about/education`), navigate to it. This
 * avoids stacking parent + child content on the same page and
 * keeps each route's document predictable.
 */
import type { ContentNode, Route } from './routes';
import { FLAT_ROUTES } from './routes';

/** Find a route in the flat registry by exact path match. */
function findRoute(path: string): Route | undefined {
  const match = FLAT_ROUTES.find((fr) => fr.route.path === path);
  return match?.route;
}

interface RouteDocumentProps {
  /** The route to render. Defaults to `/`. */
  path?: string;
}

export function RouteDocument({ path = '/' }: RouteDocumentProps): JSX.Element {
  const route = findRoute(path);
  if (!route) {
    return (
      <article>
        <p>Route &quot;{path}&quot; not found.</p>
      </article>
    );
  }

  // Sort once on render. The route's content array is small (~10s of
  // nodes per route at most), so the sort cost is negligible and
  // order-by-`order` keeps the data file orderable in any sequence.
  const items = (route.content ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <article data-route={route.path}>
      {items.map((node, i) => (
        <ContentNodeView key={`${route.path}-${i}`} node={node} />
      ))}
    </article>
  );
}

interface ContentNodeViewProps {
  node: ContentNode;
}

function ContentNodeView({ node }: ContentNodeViewProps): JSX.Element {
  switch (node.kind) {
    case 'heading':
      return <h1>{node.body}</h1>;
    case 'paragraph':
      return <p>{node.body}</p>;
    case 'image':
      return <img src={node.src} alt={node.alt} />;
  }
}
