/**
 * LoadingScreen — shown while the 3D scene and assets are loading.
 *
 * Uses R3F's Suspense boundary: when glTF models or textures are loading,
 * this component displays instead of the Canvas content.
 */

interface LoadingScreenProps {
  /** Progress from 0 to 100. */
  readonly progress?: number;
}

export function LoadingScreen({ progress }: LoadingScreenProps): JSX.Element {
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <h1 style={styles.title}>PORTFOLIO WORLD</h1>
        <div style={styles.barOuter}>
          <div
            style={{
              ...styles.barInner,
              width: `${progress ?? 0}%`,
            }}
          />
        </div>
        <p style={styles.text}>Loading environment…</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a1a',
    zIndex: 100,
  },
  inner: {
    textAlign: 'center' as const,
    fontFamily: "'JetBrains Mono', monospace",
    color: '#ffffff',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    letterSpacing: '0.3em',
    marginBottom: '32px',
    opacity: 0.8,
  },
  barOuter: {
    width: '200px',
    height: '2px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: '1px',
    overflow: 'hidden',
    margin: '0 auto',
  },
  barInner: {
    height: '100%',
    backgroundColor: '#00ff88',
    transition: 'width 0.3s ease',
    borderRadius: '1px',
  },
  text: {
    marginTop: '16px',
    fontSize: '11px',
    opacity: 0.3,
    letterSpacing: '0.1em',
  },
};
