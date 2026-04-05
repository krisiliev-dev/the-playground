/**
 * Generates a short unique identifier.
 *
 * Uses crypto.randomUUID when available (all modern browsers),
 * falls back to a timestamp-based ID for older environments.
 * In multiplayer mode, IDs will be server-assigned instead.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random suffix
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
