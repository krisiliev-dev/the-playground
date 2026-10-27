/**
 * Asset uploader panel — drag-drop a file or pick one with the
 * file dialog → POSTs to `/api/admin/assets?ext=<ext>`. Shows
 * the existing asset registry below the uploader; each row has
 * a click-to-copy URL so the recipe editor can paste it into a
 * `model_url` field.
 *
 * Extension is derived from the file's filename (last `.`
 * suffix) and lowercased. Files without an extension are
 * rejected client-side; the server would reject them too via
 * `sanitize_extension`, but we save the round-trip.
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminAuthError, type AdminAsset, type AdminClient } from './apiClient';

interface Props {
  client: AdminClient;
  onAuthError: () => void;
}

export function AssetUploader({ client, onAuthError }: Props): JSX.Element {
  const [assets, setAssets] = useState<AdminAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await client.listAssets();
      setAssets(list);
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

  const handleFile = useCallback(
    async (file: File) => {
      const dot = file.name.lastIndexOf('.');
      if (dot < 0 || dot === file.name.length - 1) {
        setError(`File "${file.name}" has no extension`);
        return;
      }
      const ext = file.name.slice(dot + 1).toLowerCase();
      setUploading(true);
      setError(null);
      try {
        await client.uploadAsset(file, ext);
        await refresh();
      } catch (e) {
        if (e instanceof AdminAuthError) {
          onAuthError();
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [client, refresh, onAuthError],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
    // Allow re-selecting the same file (browser otherwise
    // suppresses the change event for an identical pick).
    e.target.value = '';
  };

  const onCopy = (url: string): void => {
    void navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1200);
  };

  return (
    <div style={styles.root}>
      <section
        style={{
          ...styles.dropzone,
          ...(dragOver ? styles.dropzoneActive : null),
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p style={styles.dropzoneText}>{uploading ? 'Uploading…' : 'Drag a file here, or'}</p>
        <label style={styles.pickButton}>
          Choose file
          <input type="file" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </section>
      {error && <div style={styles.error}>{error}</div>}
      <section style={styles.list}>
        <h2 style={styles.listTitle}>Assets {assets ? `(${assets.length})` : ''}</h2>
        {assets === null && <div style={styles.muted}>Loading…</div>}
        {assets && assets.length === 0 && <div style={styles.muted}>No assets uploaded yet.</div>}
        {assets && assets.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Ext</th>
                <th style={styles.th}>Size</th>
                <th style={styles.th}>URL</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} style={styles.tr}>
                  <td style={styles.td}>
                    <code style={styles.code}>{a.id}</code>
                  </td>
                  <td style={styles.td}>{a.extension}</td>
                  <td style={styles.td}>{formatBytes(a.size)}</td>
                  <td style={styles.td}>
                    <button type="button" style={styles.copyBtn} onClick={() => onCopy(a.url)}>
                      {copiedUrl === a.url ? 'Copied!' : a.url}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 920 },
  dropzone: {
    border: '2px dashed #1a3a3a',
    borderRadius: 8,
    padding: 40,
    textAlign: 'center',
    transition: 'all 0.15s',
    background: '#0c1418',
  },
  dropzoneActive: {
    borderColor: '#00ffcc',
    background: '#0c1820',
  },
  dropzoneText: {
    margin: '0 0 12px 0',
    color: '#8aa',
    fontSize: 14,
  },
  pickButton: {
    display: 'inline-block',
    background: '#00ffcc',
    color: '#0a0a12',
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
  },
  list: {},
  listTitle: {
    fontSize: 16,
    fontWeight: 500,
    color: '#e6f7ff',
    marginBottom: 12,
  },
  muted: { color: '#667', fontSize: 13 },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    color: '#8aa',
    fontWeight: 500,
    padding: '8px 12px',
    borderBottom: '1px solid #1a1a2e',
  },
  tr: {},
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #12121a',
    color: '#e6f7ff',
  },
  code: { fontFamily: 'monospace', fontSize: 12 },
  copyBtn: {
    background: 'transparent',
    border: 'none',
    color: '#00ffcc',
    padding: 0,
    fontFamily: 'monospace',
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};
