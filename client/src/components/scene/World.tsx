/**
 * World — root scene component.
 * Reads environment config from the Zustand store and renders
 * the box environment with appropriate lighting.
 */
import { useWorldStore } from '@/store';
import { BoxEnvironment } from './BoxEnvironment';
import { SkyBackground } from './SkyBackground';
import { CursorAvatar } from './CursorAvatar';
import { OrbitControls } from '@react-three/drei';

export function World(): JSX.Element {
  const environment = useWorldStore((s) => s.environment);

  return (
    <>
      <ambientLight color={environment.ambientColor} intensity={environment.ambientIntensity} />
      <SkyBackground dimensions={environment.dimensions} />
      <BoxEnvironment dimensions={environment.dimensions} />
      <CursorAvatar />
      <OrbitControls enableZoom={false} enablePan={false} target={[0,0,-0.01]} />
    </>
  );
}
