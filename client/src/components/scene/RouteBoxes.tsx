/**
 * RouteBoxes — renders one `<RoomBox>` per route in the registry
 * that declares a `box` config. The route's `bounds` is reused as
 * the box's bounds, guaranteeing that URL routing and visible
 * geometry stay in lockstep — there's no way for them to drift.
 *
 * Today only the `/` route declares a box (the main cube). Adding a
 * visible region for `/about` is one line in `routes.ts` — set
 * `box: { color: '#4169e1' }` on the route and a colored cube
 * appears at exactly its bbox.
 */
import { FLAT_ROUTES } from '@/content/routes';
import { RoomBox } from './RoomBox';

export function RouteBoxes(): JSX.Element {
  return (
    <>
      {FLAT_ROUTES.map((fr) => {
        if (!fr.route.box) {
          return null;
        }
        return <RoomBox key={fr.route.path} bounds={fr.route.bounds} {...fr.route.box} />;
      })}
    </>
  );
}
