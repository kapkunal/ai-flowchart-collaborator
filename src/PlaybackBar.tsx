/**
 * The bar shown while a workflow plays: where you are, what the agent wants to
 * say about it, and the controls.
 *
 * Plain HTML over the canvas rather than Excalidraw elements, so it can never
 * end up in the scene, an export, or the graph.
 */
import type { CSSProperties } from 'react'
import type { PlaybackView } from './playback'

interface Props {
  view: PlaybackView
  onPause: () => void
  onResume: () => void
  onNext: () => void
  onReplay: () => void
  onStop: () => void
}

const ACCENT = '#1971c2'

const bar: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(560px, calc(100vw - 32px))',
  padding: '10px 12px 10px 16px',
  background: '#ffffff',
  border: '1px solid #ced4da',
  borderRadius: 10,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.10)',
  fontFamily: 'Nunito, system-ui, sans-serif',
  color: '#1e1e1e',
}

const button: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 32,
  height: 32,
  padding: '0 8px',
  border: '1px solid #ced4da',
  borderRadius: 8,
  background: '#ffffff',
  color: '#1e1e1e',
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
}

export function PlaybackBar({ view, onPause, onResume, onNext, onReplay, onStop }: Props) {
  return (
    <div style={bar} role="region" aria-label="Workflow playback" aria-live="polite">
      <div style={{ display: 'flex', gap: 6 }}>
        {view.finished ? (
          <button type="button" style={button} onClick={onReplay} aria-label="Replay" title="Replay">
            ↺ Replay
          </button>
        ) : (
          <>
            <button
              type="button"
              style={button}
              onClick={view.paused ? onResume : onPause}
              aria-label={view.paused ? 'Play' : 'Pause'}
              title={view.paused ? 'Play' : 'Pause'}
            >
              {view.paused ? '▶' : '❚❚'}
            </button>
            <button type="button" style={button} onClick={onNext} aria-label="Next step" title="Next step">
              ⏭
            </button>
          </>
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: '#868e96' }}>
          {view.finished ? 'Playback' : `Step ${view.position} of ${view.total}`}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: view.transition ? ACCENT : '#1e1e1e',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {view.title}
        </div>
        {view.note && <div style={{ fontSize: 13, color: '#495057', marginTop: 2 }}>{view.note}</div>}
      </div>

      <button
        type="button"
        style={button}
        onClick={onStop}
        aria-label="Stop playback"
        title="Stop playback (Esc)"
      >
        ✕
      </button>
    </div>
  )
}
