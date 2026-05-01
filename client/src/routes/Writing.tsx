/**
 * Writing — placeholder content for the /writing route. Will be
 * replaced with articles, build logs, and technical deep dives in a
 * future session (per ADR-003).
 */
import { RoomPage } from './RoomPage';

export function Writing(): JSX.Element {
  return (
    <RoomPage title="Writing">
      <p>
        Articles, build logs, and technical deep dives. Strong signal of how someone thinks; sparse
        content is fine — three good posts will earn more than thirty thin ones.
      </p>
      <p>
        Individual articles will be reachable at <code>/writing/&lt;slug&gt;</code>. The first few
        will likely be about building this site: the cube-room shader, the sword reveal kinematics,
        the click-pipeline test architecture.
      </p>
    </RoomPage>
  );
}
