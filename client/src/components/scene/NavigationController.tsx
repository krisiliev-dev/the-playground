/**
 * NavigationController — invisible component that activates navigation.
 *
 * R3F hooks (useFrame, useThree) can only be called inside a Canvas.
 * This component exists solely to call useNavigation() inside the
 * scene graph. It renders nothing — it's pure behaviour.
 */

import { useNavigation } from '@/components/hooks/useNavigation';

export function NavigationController(): null {
  useNavigation();
  return null;
}
