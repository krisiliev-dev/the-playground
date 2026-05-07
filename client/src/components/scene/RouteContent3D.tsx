/**
 * RouteContent3D — places each route's `content` nodes as meshes in
 * 3D world space.
 *
 * Reads the same data the Simple Experience document renderer reads
 * (`Route.content`), so editing a content node in `routes.ts`
 * updates both the 3D scene and the 2D document together. The 3D
 * representation positions each node at `node.position` (in cube-
 * local coords); the 2D representation flattens by `order`.
 *
 * Currently supports headings + paragraphs as drei `<Text>` meshes.
 * Images can be added later as textured planes. For long paragraphs
 * the text wraps via drei's built-in `maxWidth` prop.
 */
import { useEffect, useRef } from 'react';
import { Text } from '@react-three/drei';
import type { Mesh } from 'three';
import { FLAT_ROUTES, type ContentNode } from '@/content/routes';
import { CASCADE_OVERLAY_LAYER } from './sceneLayers';

const HEADING_SIZE = 6;
const PARAGRAPH_SIZE = 3;
const PARAGRAPH_MAX_WIDTH = 80;
const TEXT_COLOR = '#ffffff';

export function RouteContent3D(): JSX.Element {
  return (
    <>
      {FLAT_ROUTES.flatMap((fr) =>
        (fr.route.content ?? []).map((node, i) => (
          <ContentNodeMesh key={`${fr.route.path}-${i}`} node={node} />
        )),
      )}
    </>
  );
}

interface ContentNodeMeshProps {
  node: ContentNode;
}

/**
 * Enable `CASCADE_OVERLAY_LAYER` (in addition to the default layer 0)
 * on the underlying troika text mesh once it mounts. Layer 0 keeps
 * the text rendering in the main view. The overlay layer makes the
 * portal cascade re-render the text in its post-recursion pass so
 * it stays visible at every cascade level — without the overlay
 * pass, text projecting to a level's inner-portal sub-region is
 * overwritten by the next level's content and only ever appears at
 * the deepest recursion.
 */
function useCascadeOverlay(ref: React.MutableRefObject<Mesh | null>): void {
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || !mesh.layers || typeof mesh.layers.enable !== 'function') {
      return;
    }
    mesh.layers.enable(CASCADE_OVERLAY_LAYER);
  });
}

function ContentNodeMesh({ node }: ContentNodeMeshProps): JSX.Element | null {
  // Drei's `<Text>` forwards refs to its underlying troika TextMesh.
  // We need the ref so we can extend its layers on mount.
  const ref = useRef<Mesh | null>(null);
  useCascadeOverlay(ref);

  switch (node.kind) {
    case 'heading':
      return (
        <Text
          ref={ref}
          position={node.position}
          fontSize={HEADING_SIZE}
          color={TEXT_COLOR}
          anchorX="center"
          anchorY="middle"
          // SDF text bounding box is computed asynchronously after
          // troika rasterises the glyphs. Three.js's frustum culling
          // can drop the mesh on early frames (or on the per-cascade
          // vCam re-renders) before the box settles. Disable culling
          // so the text renders reliably across every cascade level.
          frustumCulled={false}
        >
          {node.body}
        </Text>
      );
    case 'paragraph':
      return (
        <Text
          ref={ref}
          position={node.position}
          fontSize={PARAGRAPH_SIZE}
          color={TEXT_COLOR}
          anchorX="center"
          anchorY="middle"
          maxWidth={PARAGRAPH_MAX_WIDTH}
          textAlign="center"
          frustumCulled={false}
        >
          {node.body}
        </Text>
      );
    case 'image':
      // Image rendering deferred — would be a textured plane at
      // node.position. The Simple Experience renderer already
      // handles image nodes via `<img>`.
      return null;
  }
}
