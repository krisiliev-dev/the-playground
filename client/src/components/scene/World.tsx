/**
 * World — root scene component.
 * Reads environment config from the Zustand store and renders
 * the box environment with appropriate lighting.
 */
import { useWorldStore } from '@/store';
import { BoxEnvironment } from './BoxEnvironment';

export function World(): JSX.Element {
  const environment = useWorldStore((s) => s.environment);

  return (
    <>
      <ambientLight color={environment.ambientColor} intensity={environment.ambientIntensity} />
      <BoxEnvironment dimensions={environment.dimensions} />
    </>
  );
}
