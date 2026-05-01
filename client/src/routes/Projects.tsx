/**
 * Projects — placeholder content for the /projects route. Will be
 * replaced with 3–5 deeply documented case studies in a future
 * session (per ADR-003). The Playground itself is project #1.
 */
import { RoomPage } from './RoomPage';

export function Projects(): JSX.Element {
  return (
    <RoomPage title="Projects">
      <p>
        Featured work will live here as in-depth case studies — what each project does, who
        it&apos;s for, whether it worked, and what was hard to build. The Playground itself is
        project #1; the meta angle (a portfolio that documents how it was built) is part of the
        story.
      </p>
      <p>
        Individual projects will be reachable at <code>/projects/&lt;slug&gt;</code> once the case
        studies are written.
      </p>
    </RoomPage>
  );
}
