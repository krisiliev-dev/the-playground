/**
 * Recipe editor panel — list / create / edit / delete /
 * play recipes (per ADR-008).
 *
 * The editor is intentionally a JSON textarea, not a form-driven
 * step builder. Reasoning: the recipe schema is small and likely
 * to evolve (new step kinds, new params); a JSON editor doesn't
 * need to keep up with the schema, while a form would need to be
 * rewritten every time. JSON is also faster for power-users who
 * iterate on values quickly.
 *
 * "Play here" fires `POST /api/admin/play_recipe` at the local
 * cursor's world position so the operator can drop effects into
 * whatever spot they're currently looking at, without typing
 * coordinates.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import {
  AdminAuthError,
  type AdminClient,
  type AdminRecipe,
  type AdminRecipeStep,
} from './apiClient';

interface Props {
  client: AdminClient;
  onAuthError: () => void;
}

/** Default-filled step skeletons for the "Add step" dropdown.
 *  Each entry produces a step object an author can immediately
 *  tweak — values are sensible defaults, not zeros. */
const STEP_TEMPLATES: Record<string, () => AdminRecipeStep> = {
  audio: () => ({
    kind: 'audio',
    offset_ms: 0,
    position_offset: [0, 0, 0],
    sound_id: 'popper',
    volume: 1.0,
  }),
  camera_shake: () => ({
    kind: 'camera_shake',
    offset_ms: 0,
    position_offset: [0, 0, 0],
    radius: 200,
    intensity: 0.5,
    duration_ms: 300,
  }),
  particle_burst: () => ({
    kind: 'particle_burst',
    offset_ms: 0,
    position_offset: [0, 0, 0],
    count: 200,
    colors: ['#ff00aa', '#00ffaa', '#ffff00', '#00aaff', '#ff8800'],
    speed: 80,
    lifetime_ms: 2500,
    spread: 0.7,
    gravity: 30,
    size: 5,
    spin: 0,
  }),
  text_popup: () => ({
    kind: 'text_popup',
    offset_ms: 0,
    position_offset: [0, 0, 0],
    text: 'Hello!',
    color: '#00ffcc',
    size: 8,
    lifetime_ms: 2500,
  }),
  color_flash: () => ({
    kind: 'color_flash',
    offset_ms: 0,
    position_offset: [0, 0, 0],
    radius: 600,
    color: '#ffffff',
    peak_alpha: 0.6,
    duration_ms: 400,
  }),
};

/** Quick-start recipe presets the operator can load into the
 *  editor. New recipes can be authored from scratch or built
 *  on top of one of these. */
const RECIPE_PRESETS: Record<string, () => AdminRecipe> = {
  confetti_burst: () => ({
    id: 'confetti_burst',
    name: 'Confetti Burst',
    steps: [
      STEP_TEMPLATES.particle_burst!(),
      STEP_TEMPLATES.audio!(),
      STEP_TEMPLATES.camera_shake!(),
    ],
  }),
  firework: () => {
    const upBurst = STEP_TEMPLATES.particle_burst!() as Extract<
      AdminRecipeStep,
      { kind: 'particle_burst' }
    >;
    upBurst.colors = ['#ffaa00', '#ff5500', '#ffffff'];
    upBurst.gravity = 40;
    upBurst.spread = 0.4;
    upBurst.speed = 120;
    upBurst.lifetime_ms = 1800;
    const popBurst = STEP_TEMPLATES.particle_burst!() as Extract<
      AdminRecipeStep,
      { kind: 'particle_burst' }
    >;
    popBurst.offset_ms = 700;
    popBurst.position_offset = [0, 60, 0];
    popBurst.count = 300;
    popBurst.spread = 1;
    popBurst.speed = 150;
    popBurst.gravity = 80;
    popBurst.lifetime_ms = 2200;
    return {
      id: 'firework',
      name: 'Firework',
      steps: [
        upBurst,
        popBurst,
        {
          kind: 'camera_shake',
          offset_ms: 700,
          position_offset: [0, 60, 0],
          radius: 400,
          intensity: 0.4,
          duration_ms: 500,
        },
      ],
    };
  },
  glitch_pulse: () => ({
    id: 'glitch_pulse',
    name: 'Glitch Pulse',
    steps: [
      {
        kind: 'color_flash',
        offset_ms: 0,
        position_offset: [0, 0, 0],
        radius: 1000,
        color: '#ff00ff',
        peak_alpha: 0.7,
        duration_ms: 200,
      },
      {
        kind: 'color_flash',
        offset_ms: 250,
        position_offset: [0, 0, 0],
        radius: 1000,
        color: '#00ffff',
        peak_alpha: 0.5,
        duration_ms: 200,
      },
      {
        kind: 'camera_shake',
        offset_ms: 0,
        position_offset: [0, 0, 0],
        radius: 600,
        intensity: 0.7,
        duration_ms: 400,
      },
    ],
  }),
};

const TEMPLATE_RECIPE: AdminRecipe = {
  id: 'new_effect',
  name: 'New Effect',
  steps: [
    {
      kind: 'particle_burst',
      offset_ms: 0,
      position_offset: [0, 0, 0],
      count: 200,
      colors: ['#ff00aa', '#00ffaa', '#ffff00', '#00aaff', '#ff8800'],
      speed: 80,
      lifetime_ms: 2500,
      spread: 0.7,
      gravity: 30,
      size: 5,
      spin: 0,
    },
    {
      kind: 'audio',
      offset_ms: 0,
      position_offset: [0, 0, 0],
      sound_id: 'popper',
      volume: 1.0,
    },
    {
      kind: 'camera_shake',
      offset_ms: 0,
      position_offset: [0, 0, 0],
      radius: 200,
      intensity: 0.5,
      duration_ms: 300,
    },
  ],
};

export function RecipeEditor({ client, onAuthError }: Props): JSX.Element {
  const [recipes, setRecipes] = useState<AdminRecipe[] | null>(null);
  const [draftJson, setDraftJson] = useState<string>(() =>
    JSON.stringify(TEMPLATE_RECIPE, null, 2),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await client.listRecipes();
      setRecipes(list);
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, onAuthError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const parsed = useMemo<{ ok: true; value: AdminRecipe } | { ok: false; error: string }>(
    () => parseRecipeJson(draftJson),
    [draftJson],
  );

  const onSelectRecipe = (r: AdminRecipe): void => {
    setEditingId(r.id);
    setDraftJson(JSON.stringify(r, null, 2));
    setInfo(null);
    setError(null);
  };

  const onNewRecipe = (): void => {
    setEditingId(null);
    setDraftJson(JSON.stringify(TEMPLATE_RECIPE, null, 2));
    setInfo(null);
    setError(null);
  };

  const onSave = async (): Promise<void> => {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const saved = await client.upsertRecipe(parsed.value);
      setEditingId(saved.id);
      setInfo(`Saved "${saved.id}"`);
      await refresh();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete recipe "${id}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await client.deleteRecipe(id);
      if (editingId === id) {
        onNewRecipe();
      }
      await refresh();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPlay = async (id: string): Promise<void> => {
    // Fire at the local cursor's current world position. The
    // singleton `cursorWorldPosition` is updated each frame by
    // CursorAvatar regardless of route, so it's a stable
    // "where the operator is currently looking" anchor.
    const pos: [number, number, number] = [
      cursorWorldPosition.x,
      cursorWorldPosition.y,
      cursorWorldPosition.z,
    ];
    setError(null);
    setInfo(null);
    try {
      await client.playRecipe(id, pos);
      setInfo(`Fired "${id}" at ${pos.map((n) => n.toFixed(0)).join(', ')}`);
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar}>
        <button type="button" style={styles.newBtn} onClick={onNewRecipe}>
          + New recipe
        </button>
        <h3 style={styles.sidebarHeading}>Recipes {recipes ? `(${recipes.length})` : ''}</h3>
        {recipes === null && <div style={styles.muted}>Loading…</div>}
        {recipes && recipes.length === 0 && <div style={styles.muted}>No recipes yet.</div>}
        {recipes &&
          recipes.map((r) => (
            <div
              key={r.id}
              style={{
                ...styles.recipeRow,
                ...(editingId === r.id ? styles.recipeRowActive : null),
              }}
            >
              <button type="button" style={styles.recipeRowName} onClick={() => onSelectRecipe(r)}>
                <div style={styles.recipeName}>{r.name}</div>
                <code style={styles.recipeId}>
                  {r.id} · {r.steps.length} step{r.steps.length === 1 ? '' : 's'}
                </code>
              </button>
              <div style={styles.recipeActions}>
                <button
                  type="button"
                  style={styles.playBtn}
                  onClick={() => void onPlay(r.id)}
                  title="Fire at the cursor's current position"
                >
                  ▶
                </button>
                <button
                  type="button"
                  style={styles.deleteBtn}
                  onClick={() => void onDelete(r.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
      </aside>
      <section style={styles.editor}>
        <div style={styles.editorHeader}>
          <span style={styles.editorTitle}>
            {editingId ? `Editing ${editingId}` : 'New recipe'}
          </span>
          <span
            style={{
              ...styles.parseStatus,
              color: parsed.ok ? '#00ffcc' : '#ff5577',
            }}
          >
            {parsed.ok ? '✓ valid JSON' : '✗ invalid JSON'}
          </span>
        </div>
        <div style={styles.toolbar}>
          <select
            style={styles.select}
            value=""
            disabled={!parsed.ok}
            onChange={(e) => {
              if (!parsed.ok || !e.target.value) {
                return;
              }
              const factory = STEP_TEMPLATES[e.target.value];
              if (!factory) {
                return;
              }
              const updated = {
                ...parsed.value,
                steps: [...parsed.value.steps, factory()],
              };
              setDraftJson(JSON.stringify(updated, null, 2));
              e.target.value = '';
            }}
          >
            <option value="">+ Add step…</option>
            {Object.keys(STEP_TEMPLATES).map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <select
            style={styles.select}
            value=""
            onChange={(e) => {
              if (!e.target.value) {
                return;
              }
              const factory = RECIPE_PRESETS[e.target.value];
              if (!factory) {
                return;
              }
              setEditingId(null);
              setDraftJson(JSON.stringify(factory(), null, 2));
              setInfo(null);
              setError(null);
              e.target.value = '';
            }}
          >
            <option value="">⌘ Load preset…</option>
            {Object.keys(RECIPE_PRESETS).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={draftJson}
          onChange={(e) => setDraftJson(e.target.value)}
          style={styles.textarea}
          spellCheck={false}
        />
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.saveBtn}
            disabled={!parsed.ok || busy}
            onClick={() => void onSave()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {parsed.ok && (
            <button
              type="button"
              style={styles.playBtnLg}
              disabled={busy}
              onClick={() => void onPlay(parsed.value.id)}
              title="Save first, then fire at the cursor's current position"
            >
              ▶ Play here
            </button>
          )}
        </div>
        {error && <div style={styles.error}>{error}</div>}
        {info && <div style={styles.info}>{info}</div>}
      </section>
    </div>
  );
}

function parseRecipeJson(
  raw: string,
): { ok: true; value: AdminRecipe } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'top-level must be an object' };
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !obj.id) {
      return { ok: false, error: 'id must be a non-empty string' };
    }
    if (typeof obj.name !== 'string' || !obj.name) {
      return { ok: false, error: 'name must be a non-empty string' };
    }
    if (!Array.isArray(obj.steps)) {
      return { ok: false, error: 'steps must be an array' };
    }
    return { ok: true, value: parsed as AdminRecipe };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', gap: 16, height: '100%', minHeight: 500 },
  sidebar: {
    width: 280,
    flexShrink: 0,
    background: '#0c1418',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflowY: 'auto',
  },
  newBtn: {
    background: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '8px 12px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
  },
  sidebarHeading: {
    fontSize: 12,
    color: '#8aa',
    textTransform: 'uppercase',
    letterSpacing: 1,
    margin: '8px 0 4px 0',
  },
  recipeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 4,
  },
  recipeRowActive: {
    background: '#1a2030',
  },
  recipeRowName: {
    background: 'transparent',
    border: 'none',
    color: '#e6f7ff',
    textAlign: 'left',
    flex: 1,
    cursor: 'pointer',
    padding: 4,
  },
  recipeName: { fontSize: 13, fontWeight: 500 },
  recipeId: {
    display: 'block',
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#667',
    marginTop: 2,
  },
  recipeActions: { display: 'flex', gap: 4 },
  playBtn: {
    background: '#0c1418',
    color: '#00ffcc',
    border: '1px solid #00ffcc',
    width: 28,
    height: 28,
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  deleteBtn: {
    background: '#0c1418',
    color: '#ff5577',
    border: '1px solid #ff5577',
    width: 28,
    height: 28,
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  editor: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  },
  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editorTitle: { fontSize: 14, color: '#e6f7ff' },
  parseStatus: { fontSize: 12, fontFamily: 'monospace' },
  toolbar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  select: {
    background: '#0c1418',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    cursor: 'pointer',
  },
  textarea: {
    flex: 1,
    background: '#0c1418',
    color: '#e6f7ff',
    border: '1px solid #1a1a2e',
    borderRadius: 4,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.5,
    resize: 'none',
    outline: 'none',
    minHeight: 320,
  },
  actions: { display: 'flex', gap: 8 },
  saveBtn: {
    background: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
  },
  playBtnLg: {
    background: '#0c1418',
    color: '#00ffcc',
    border: '1px solid #00ffcc',
    padding: '8px 16px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 13,
  },
  error: {
    color: '#ff5577',
    background: '#2a0a14',
    border: '1px solid #ff5577',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  info: {
    color: '#00ffcc',
    background: '#0c1820',
    border: '1px solid #00ffcc',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  muted: { color: '#667', fontSize: 13 },
};
