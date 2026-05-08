/**
 * Admin token state with localStorage persistence.
 *
 * Keeps the bearer token in a single source of truth — the
 * AdminPanel reads it to gate the UI, the client wrapper reads
 * it to authorise requests. On 401 anywhere in the request
 * chain, callers invoke `clearToken()` and the panel re-prompts.
 *
 * localStorage chosen over sessionStorage so the operator
 * doesn't have to re-enter the token every tab reload during a
 * working session. Treat the persisted token as low-trust —
 * anyone with browser access has the same capabilities as the
 * operator. (In production behind a real ops boundary you'd
 * substitute a short-lived signed token; for the playground's
 * single-operator model, plain text is fine.)
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'playground.admin_token';

function readPersistedToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export interface UseAdminToken {
  token: string;
  /** Update the token (writes through to localStorage). */
  setToken: (next: string) => void;
  /** Clear the token — call on 401, on operator-initiated
   *  log-out, or whenever the token becomes invalid. */
  clearToken: () => void;
}

export function useAdminToken(): UseAdminToken {
  const [token, setTokenState] = useState<string>(() => readPersistedToken());

  // Sync across tabs — if the operator updates the token in one
  // tab, other tabs pick it up. Useful when fixing a typo without
  // having to reload every open admin tab.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY) {
        setTokenState(e.newValue ?? '');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setToken = useCallback((next: string) => {
    setTokenState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage write failure is non-fatal — the in-memory
      // state is still authoritative for this tab. Failure can
      // happen on Safari private mode or quota errors.
    }
  }, []);

  const clearToken = useCallback(() => {
    setToken('');
  }, [setToken]);

  return { token, setToken, clearToken };
}
