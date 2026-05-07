/**
 * RouteSync — bidirectional bridge between the avatar's
 * `currentRoute` (derived each frame from its bbox-driven position)
 * and react-router's URL bar.
 *
 * Which side drives depends on the mode:
 *
 *   - **3D mode** (`documentMode === false`): the avatar is the
 *     source of truth. `currentRoute` flips when the avatar walks
 *     into a new bbox; RouteSync mirrors it into the URL bar.
 *   - **Document mode** (`documentMode === true`): the URL is the
 *     source of truth. The user navigates by clicking links;
 *     RouteSync writes the URL straight into `currentRoute` so the
 *     two views stay consistent across the toggle, and queues a
 *     `pendingAvatarTeleport` so when 3D resumes the avatar lands
 *     in the matching room.
 *
 * The avatar→URL effect is gated on `!documentMode` to prevent the
 * "snap back" bug: when in document mode, the avatar isn't moving,
 * `currentRoute` is stale, and an unguarded avatar→URL push would
 * fight every link click in DocumentShell.
 *
 * Mounted once at the top of the BrowserRouter tree (in App.tsx).
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorldStore } from '@/store';
import { FLAT_ROUTES } from '@/content/routes';

export function RouteSync(): null {
  const currentRoute = useWorldStore((s) => s.currentRoute);
  const documentMode = useWorldStore((s) => s.documentMode);
  const location = useLocation();
  const navigate = useNavigate();

  // avatar → URL. Only when the avatar is the source of truth
  // (i.e. 3D mode). In document mode the user drives the URL via
  // <Link> clicks — pushing currentRoute back over their click
  // would revert it.
  useEffect(() => {
    if (documentMode) {
      return;
    }
    if (location.pathname === currentRoute) {
      return;
    }
    // Preserve `?…` and `#…` so dev flags like `?perf=1` survive the
    // avatar-driven URL rewrite. Without this, RouteSync collapses
    // the URL to a bare path on the first frame and any module that
    // re-reads `window.location.search` (e.g. DevTools) flips off.
    void navigate(
      { pathname: currentRoute, search: location.search, hash: location.hash },
      { replace: false },
    );
  }, [currentRoute, location.pathname, location.search, location.hash, navigate, documentMode]);

  // URL → avatar. Always active. Two side effects:
  //   1. Queue a `pendingAvatarTeleport` so the avatar snaps to
  //      the matching route's entry point on the next frame in 3D
  //      mode (or immediately when 3D mode resumes).
  //   2. In document mode, also write the URL straight into
  //      `currentRoute` so the in-memory state matches the URL
  //      across the document↔3D toggle. (In 3D mode this isn't
  //      needed — the avatar's frame loop will compute it from
  //      position once the teleport lands.)
  useEffect(() => {
    const stateRoute = useWorldStore.getState().currentRoute;
    if (location.pathname === stateRoute) {
      return;
    }
    const match = FLAT_ROUTES.find((fr) => fr.route.path === location.pathname);
    if (!match) {
      return;
    }
    useWorldStore.getState().setPendingAvatarTeleport(match.route.path);
    if (documentMode) {
      useWorldStore.getState().setCurrentRoute(match.route.path);
    }
  }, [location.pathname, documentMode]);

  return null;
}
