/**
 * Tests for the admin API client wrapper. Verifies:
 *   - bearer header attached to every request
 *   - 401 → typed `AdminAuthError` (so the panel can clear the token)
 *   - non-2xx → typed `AdminApiError` with status + body
 *   - per-method request shape (URL, method, body)
 *
 * Uses a stub fetch impl (passed via opts) so we never touch
 * the network and can assert on the recorded calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdminApiError, AdminAuthError, createAdminClient } from '@/admin/apiClient';

interface CallRecord {
  url: string;
  init: RequestInit;
}

function makeStubFetch(responses: Array<{ status: number; body?: unknown }>): {
  fetchImpl: typeof fetch;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  let idx = 0;
  const fetchImpl = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const r = responses[idx] ?? { status: 200, body: {} };
    idx += 1;
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return Promise.resolve(new Response(text, { status: r.status }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const BASE = 'http://example.test';

describe('AdminClient', () => {
  it('attaches the bearer header to every request', async () => {
    const { fetchImpl, calls } = makeStubFetch([{ status: 200, body: [] }]);
    const c = createAdminClient('s3cret', { baseUrl: BASE, fetchImpl });
    await c.listAssets();
    const auth = (calls[0]!.init.headers as Headers).get('Authorization');
    expect(auth).toBe('Bearer s3cret');
  });

  it('throws AdminAuthError on 401', async () => {
    const { fetchImpl } = makeStubFetch([{ status: 401 }]);
    const c = createAdminClient('bad', { baseUrl: BASE, fetchImpl });
    await expect(c.listAssets()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it('throws AdminApiError on other non-2xx with status + body', async () => {
    const { fetchImpl } = makeStubFetch([{ status: 400, body: 'bad shape' }]);
    const c = createAdminClient('s', { baseUrl: BASE, fetchImpl });
    try {
      await c.listAssets();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      const err = e as AdminApiError;
      expect(err.status).toBe(400);
      expect(err.body).toContain('bad shape');
    }
  });

  it('uploadAsset POSTs to /api/admin/assets?ext=', async () => {
    const { fetchImpl, calls } = makeStubFetch([
      { status: 201, body: { id: 'ast_x', url: '/assets/ast_x.glb', size: 4, extension: 'glb' } },
    ]);
    const c = createAdminClient('t', { baseUrl: BASE, fetchImpl });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const result = await c.uploadAsset(blob, 'glb');
    expect(result.id).toBe('ast_x');
    expect(calls[0]!.url).toBe(`${BASE}/api/admin/assets?ext=glb`);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('upsertRecipe POSTs JSON body to /api/admin/recipes', async () => {
    const recipe = { id: 'r1', name: 'R1', steps: [] };
    const { fetchImpl, calls } = makeStubFetch([{ status: 201, body: recipe }]);
    const c = createAdminClient('t', { baseUrl: BASE, fetchImpl });
    await c.upsertRecipe(recipe);
    expect(calls[0]!.url).toBe(`${BASE}/api/admin/recipes`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(recipe);
  });

  it('deleteRecipe DELETEs /api/admin/recipes/:id with url-encoded id', async () => {
    // 200 instead of 204 — the spec-correct empty body is fine,
    // but jsdom's Response constructor rejects 204 explicitly
    // ("Invalid response status code 204"). The client treats
    // every 2xx the same way (resolve), so 200 is interchangeable
    // for the purposes of this assertion.
    const { fetchImpl, calls } = makeStubFetch([{ status: 200 }]);
    const c = createAdminClient('t', { baseUrl: BASE, fetchImpl });
    await c.deleteRecipe('weird id/with slashes');
    expect(calls[0]!.url).toBe(
      `${BASE}/api/admin/recipes/${encodeURIComponent('weird id/with slashes')}`,
    );
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('playRecipe POSTs id + position to /api/admin/play_recipe', async () => {
    const { fetchImpl, calls } = makeStubFetch([{ status: 202 }]);
    const c = createAdminClient('t', { baseUrl: BASE, fetchImpl });
    await c.playRecipe('confetti', [10, 0, -50]);
    expect(calls[0]!.url).toBe(`${BASE}/api/admin/play_recipe`);
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body.id).toBe('confetti');
    expect(body.position).toEqual([10, 0, -50]);
  });

  it('fireEvent POSTs the event variant to /api/admin/event', async () => {
    const { fetchImpl, calls } = makeStubFetch([{ status: 202 }]);
    const c = createAdminClient('t', { baseUrl: BASE, fetchImpl });
    await c.fireEvent({
      kind: 'particle_burst',
      position: [0, 0, 0],
      count: 50,
      colors: ['#ff00aa'],
      speed: 60,
      lifetime_ms: 2000,
      spread: 0.5,
      gravity: 30,
      size: 4,
      spin: 0,
    });
    expect(calls[0]!.url).toBe(`${BASE}/api/admin/event`);
    const body = JSON.parse(calls[0]!.init.body as string) as { event: { kind: string } };
    expect(body.event.kind).toBe('particle_burst');
  });

  it('strips trailing slash from the explicit baseUrl', async () => {
    const { fetchImpl, calls } = makeStubFetch([{ status: 200, body: [] }]);
    const c = createAdminClient('t', { baseUrl: `${BASE}/`, fetchImpl });
    await c.listAssets();
    // No double slash before /api.
    expect(calls[0]!.url).toBe(`${BASE}/api/admin/assets`);
  });
});

describe('AdminClient — integration with localStorage-backed token', () => {
  it('reads token from constructor argument, not from any global state', async () => {
    const { fetchImpl, calls } = makeStubFetch([{ status: 200, body: [] }]);
    const c = createAdminClient('one', { baseUrl: BASE, fetchImpl });
    await c.listAssets();
    expect((calls[0]!.init.headers as Headers).get('Authorization')).toBe('Bearer one');
    // A different client with a different token doesn't share state.
    const { fetchImpl: f2, calls: calls2 } = makeStubFetch([{ status: 200, body: [] }]);
    const c2 = createAdminClient('two', { baseUrl: BASE, fetchImpl: f2 });
    await c2.listAssets();
    expect((calls2[0]!.init.headers as Headers).get('Authorization')).toBe('Bearer two');
  });
});

// Quiet a vitest unused-import warning when only types are used.
void vi;
