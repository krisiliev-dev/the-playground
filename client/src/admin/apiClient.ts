/**
 * Thin fetch wrapper for the admin endpoints (per ADR-007 + 008).
 *
 * Centralises:
 *   - the bearer-token header (one place to forget it = no place
 *     to forget it),
 *   - base URL resolution (env var or window default),
 *   - response shape parsing + error normalisation, so panel
 *     components can `await client.uploadAsset(file)` and get a
 *     plain typed result instead of a stack of fetch boilerplate.
 *
 * Auth model: every method takes the same client, which carries
 * the token. A 401 response throws an `AdminAuthError` so the
 * token-gate hook can clear localStorage and re-prompt the
 * operator.
 */

/** Asset record returned by `GET /api/admin/assets`. Mirrors
 *  `AssetMeta` on the server side. */
export interface AdminAsset {
  id: string;
  url: string;
  size: number;
  extension: string;
}

/** Player view returned by `GET /api/admin/players`. Mirrors
 *  `AdminPlayerView` on the server. Per ADR-009. */
export interface AdminPlayer {
  id: string;
  name: string;
  cursor_color: string;
  route: string;
  frozen: boolean;
  position: [number, number, number];
}

/** Recipe step variants on the wire — mirrors the Rust enum.
 *  Per ADR-008. */
export type AdminRecipeStep =
  | {
      kind: 'audio';
      offset_ms: number;
      sound_id: string;
      position_offset: [number, number, number];
      volume: number;
    }
  | {
      kind: 'camera_shake';
      offset_ms: number;
      position_offset: [number, number, number];
      radius: number;
      intensity: number;
      duration_ms: number;
    }
  | {
      kind: 'particle_burst';
      offset_ms: number;
      position_offset: [number, number, number];
      count: number;
      colors: string[];
      speed: number;
      lifetime_ms: number;
      spread: number;
      gravity: number;
      size: number;
      model_url?: string | null;
      spin: number;
    }
  | {
      kind: 'text_popup';
      offset_ms: number;
      position_offset: [number, number, number];
      text: string;
      color: string;
      size: number;
      lifetime_ms: number;
    }
  | {
      kind: 'color_flash';
      offset_ms: number;
      position_offset: [number, number, number];
      radius: number;
      color: string;
      peak_alpha: number;
      duration_ms: number;
    };

export interface AdminRecipe {
  id: string;
  name: string;
  steps: AdminRecipeStep[];
}

/** Variants of a one-shot SceneEvent the operator can fire via
 *  `/api/admin/event`. Subset of the wire `SceneEventKind` —
 *  `sword_swing` etc. exist but aren't useful for ad-hoc
 *  triggering. */
export type AdminFireableEvent =
  | { kind: 'audio'; sound_id: string; position?: [number, number, number] | null; volume: number }
  | {
      kind: 'camera_shake';
      position: [number, number, number];
      radius: number;
      intensity: number;
      duration_ms: number;
    }
  | {
      kind: 'particle_burst';
      position: [number, number, number];
      count: number;
      colors: string[];
      speed: number;
      lifetime_ms: number;
      spread: number;
      gravity: number;
      size: number;
      model_url?: string | null;
      spin: number;
    }
  | {
      kind: 'text_popup';
      position: [number, number, number];
      text: string;
      color: string;
      size: number;
      lifetime_ms: number;
    }
  | {
      kind: 'color_flash';
      position: [number, number, number];
      radius: number;
      color: string;
      peak_alpha: number;
      duration_ms: number;
    };

export class AdminAuthError extends Error {
  constructor() {
    super('admin token rejected');
    this.name = 'AdminAuthError';
  }
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`admin api error ${status}: ${body}`);
    this.name = 'AdminApiError';
  }
}

/** Strategy for picking the base URL the admin client points
 *  at. Reads `VITE_ADMIN_API_URL` first (production override),
 *  falls back to the multiplayer URL minus the WS scheme + path
 *  (since admin + multiplayer are served by the same Rust
 *  binary). Final fallback is `http://localhost:8080` for local
 *  dev. */
function resolveBaseUrl(): string {
  const explicit = import.meta.env.VITE_ADMIN_API_URL as string | undefined;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const mp = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined;
  if (mp) {
    // Rewrite ws[s]://host/ws → http[s]://host
    const httpScheme = mp.startsWith('wss://') ? 'https://' : 'http://';
    const stripped = mp.replace(/^wss?:\/\//, '').replace(/\/ws.*$/, '');
    return `${httpScheme}${stripped}`;
  }
  return 'http://localhost:8080';
}

export interface AdminClient {
  baseUrl: string;
  token: string;
  listAssets(): Promise<AdminAsset[]>;
  uploadAsset(file: Blob, extension: string): Promise<AdminAsset>;
  listRecipes(): Promise<AdminRecipe[]>;
  upsertRecipe(recipe: AdminRecipe): Promise<AdminRecipe>;
  deleteRecipe(id: string): Promise<void>;
  playRecipe(id: string, position: [number, number, number]): Promise<void>;
  fireEvent(event: AdminFireableEvent): Promise<void>;
  /** Player management (ADR-009). */
  listPlayers(): Promise<AdminPlayer[]>;
  kickPlayer(id: string): Promise<void>;
  freezePlayer(id: string, frozen: boolean): Promise<void>;
  teleportPlayer(id: string, position: [number, number, number]): Promise<void>;
}

/**
 * Construct an admin client bound to a token. The same instance
 * can issue any number of requests; create a new one when the
 * token changes.
 *
 * `fetchImpl` defaults to `globalThis.fetch` — overridable so
 * tests can inject a stub.
 */
export function createAdminClient(
  token: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): AdminClient {
  const baseUrl = (opts.baseUrl ?? resolveBaseUrl()).replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request(
    path: string,
    init: RequestInit & { skipAuth?: boolean } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!init.skipAuth) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    if (res.status === 401) {
      throw new AdminAuthError();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AdminApiError(res.status, body);
    }
    return res;
  }

  return {
    baseUrl,
    token,
    async listAssets() {
      const r = await request('/api/admin/assets');
      return (await r.json()) as AdminAsset[];
    },
    async uploadAsset(file, extension) {
      const r = await request(`/api/admin/assets?ext=${encodeURIComponent(extension)}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      return (await r.json()) as AdminAsset;
    },
    async listRecipes() {
      const r = await request('/api/admin/recipes');
      return (await r.json()) as AdminRecipe[];
    },
    async upsertRecipe(recipe) {
      const r = await request('/api/admin/recipes', {
        method: 'POST',
        body: JSON.stringify(recipe),
        headers: { 'Content-Type': 'application/json' },
      });
      return (await r.json()) as AdminRecipe;
    },
    async deleteRecipe(id) {
      await request(`/api/admin/recipes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    async playRecipe(id, position) {
      await request('/api/admin/play_recipe', {
        method: 'POST',
        body: JSON.stringify({ id, position }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async fireEvent(event) {
      await request('/api/admin/event', {
        method: 'POST',
        body: JSON.stringify({ event }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async listPlayers() {
      const r = await request('/api/admin/players');
      return (await r.json()) as AdminPlayer[];
    },
    async kickPlayer(id) {
      await request('/api/admin/kick', {
        method: 'POST',
        body: JSON.stringify({ id }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async freezePlayer(id, frozen) {
      await request('/api/admin/freeze', {
        method: 'POST',
        body: JSON.stringify({ id, frozen }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    async teleportPlayer(id, position) {
      await request('/api/admin/teleport_player', {
        method: 'POST',
        body: JSON.stringify({ id, position }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}
