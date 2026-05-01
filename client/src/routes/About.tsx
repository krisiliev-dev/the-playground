/**
 * About — placeholder content for the /about route. Will be replaced
 * with the real story + career + education content in a future
 * session (per ADR-003).
 */
import { RoomPage } from './RoomPage';

export function About(): JSX.Element {
  return (
    <RoomPage title="About">
      <p>
        This room will introduce who you are, what kinds of problems you find interesting, where
        you&apos;ve worked, and what you&apos;re currently learning. Career history and education
        will live alongside the story rather than in their own sections.
      </p>
      <p>
        In the 3D experience, this room is reached by walking into the About portal in the sword
        formation. In the Simple Experience toggle, the same content renders as a clean document.
      </p>
    </RoomPage>
  );
}
