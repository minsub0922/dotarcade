import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { api } from '../api.js'
import { mountGame } from '../game/harness.js'

const DEFAULT_VIEWPORT = Object.freeze({ w: 480, h: 320 })
const PIXEL_SCALES = [2, 1.5, 1.25, 1]

export function normalizeGameViewport(value) {
  const w = Math.round(Number(value?.w))
  const h = Math.round(Number(value?.h))
  return Number.isFinite(w) && Number.isFinite(h) && w >= 160 && h >= 160 && w <= 1920 && h <= 1920
    ? { w, h }
    : DEFAULT_VIEWPORT
}

export function fitGameFrame(viewport, portable, screen = {}) {
  const { w, h } = normalizeGameViewport(viewport)
  const screenW = Math.max(280, Number(screen.width) || 1280)
  const screenH = Math.max(480, Number(screen.height) || 720)
  const mobile = screenW <= 560
  const horizontalChrome = portable ? (mobile ? 76 : 150) : (mobile ? 52 : 104)
  const verticalChrome = portable ? (mobile ? 205 : 250) : (mobile ? 130 : 156)
  const maxW = Math.max(220, screenW - horizontalChrome)
  const maxH = Math.max(220, screenH * .9 - verticalChrome)
  const rawScale = Math.max(.35, Math.min(2, (maxW - 8) / w, (maxH - 8) / h))
  const scale = PIXEL_SCALES.find(candidate => candidate <= rawScale + .015) || rawScale
  return {
    w: Math.max(160, Math.floor(w * scale) + 8),
    h: Math.max(160, Math.floor(h * scale) + 8),
    scale: Number(scale.toFixed(2))
  }
}

const orientationOf = ({ w, h }) => w / h > 1.16 ? 'landscape' : w / h < .86 ? 'portrait' : 'square'
const keyLabel = control => ({
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC'
})[control] || String(control || '').replace(/^Key/, '').toUpperCase()

export default function PlayModal() {
  const { panelData, closePanel } = useStore()
  const portable = !!panelData?.portable
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const [meta, setMeta] = useState(null)
  const [score, setScore] = useState(0)
  const [over, setOver] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT)
  const [frame, setFrame] = useState(() => fitGameFrame(DEFAULT_VIEWPORT, portable, {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight
  }))

  useEffect(() => {
    const resize = () => setFrame(fitGameFrame(viewport, portable, { width: window.innerWidth, height: window.innerHeight }))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [viewport.w, viewport.h, portable])

  useEffect(() => {
    let disposed = false
    setOver(null); setScore(0); setReady(false); setError(''); setViewport(DEFAULT_VIEWPORT)
    ;(async () => {
      const b = await api.bundle(panelData.gameId, panelData.version).catch(() => null)
      if (!b?.code || disposed) {
        if (!disposed) setError('게임팩을 불러오지 못했습니다')
        return
      }
      setMeta(b.meta)
      const g = mountGame(hostRef.current, b.code, {
        mode: 'play', device: portable ? 'handheld' : 'cabinet'
      })
      gameRef.current = g
      g.on(m => {
        if (m.type === 'score') setScore(m.score)
        if (m.type === 'over' || m.type === 'timeout') setOver(m.score)
        if (m.type === 'fatal') setError(m.message || '게임 실행 오류')
        if (m.type === 'ready') {
          const nextViewport = normalizeGameViewport(m.meta?.viewport)
          setViewport(nextViewport)
          setMeta(current => ({ ...current, ...m.meta, viewport: nextViewport }))
          setReady(true)
          setTimeout(() => g.iframe.focus(), 250)
        }
      })
    })()
    return () => { disposed = true; gameRef.current?.dispose(); gameRef.current = null }
  }, [panelData.gameId, panelData.version, portable, nonce])

  const orientation = orientationOf(viewport)
  const controls = meta?.controls || []
  const frameStyle = {
    '--game-frame-width': `${frame.w}px`,
    '--game-frame-height': `${frame.h}px`,
    '--game-color': meta?.color || '#7467e8'
  }

  return (
    <div className="modal-back dark" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div
        className={`modal play play-shell play-${orientation} ${portable ? 'portable-play-shell' : ''}`}
        data-play-device={portable ? 'handheld' : 'cabinet'}
        data-game-orientation={orientation}
        style={frameStyle}
      >
        <div className="modal-head play-toolbar">
          {portable && <span className="pocket-mode-badge">▣ POCKET MODE</span>}
          <div className="play-game-title">
            <span className="play-game-icon">{meta?.emoji || '🎮'}</span>
            <span><b>{meta?.title || '게임팩 로딩...'}</b><small>{meta ? `${meta.version || 'DEV'} · ${orientation.toUpperCase()} BUILD` : 'CARTRIDGE BOOT'}</small></span>
          </div>
          <span className={`device-live-state ${ready ? 'ready' : ''}`}><i />{error ? 'ERROR' : ready ? 'LIVE' : 'BOOTING'}</span>
          <span className="score-live">SCORE {score}</span>
          <button className="x" onClick={closePanel} aria-label="게임 닫기">✕</button>
        </div>

        <div className={portable ? 'handheld-body' : 'play-body'}>
          {portable && <div className="handheld-brand"><b>DOTCADE</b><span>POCKET · COLOR</span></div>}
          <div className={portable ? 'handheld-screen-bezel' : 'play-screen'}>
            {portable && <div className="handheld-screen-status"><span><i />POWER</span><b>DOT MATRIX DISPLAY</b></div>}
            <div className="play-host" ref={hostRef} onClick={() => gameRef.current?.iframe.focus()} />
            {!ready && !error && <div className="play-boot"><i /><b>DOTCADE SYSTEM</b><span>GAME CARTRIDGE BOOTING</span></div>}
            {(over != null || error) && (
              <div className="play-over">
                <div className="big">{error || `GAME OVER — ${over}점`}</div>
                {!error && <button className="primary" onClick={() => setNonce(n => n + 1)}>다시 하기</button>}
              </div>
            )}
          </div>
          {portable && (
            <div className="handheld-controls" aria-hidden="true">
              <span className="handheld-dpad"><i /><i /></span>
              <span className="handheld-menu"><i>SELECT</i><i>START</i></span>
              <span className="handheld-ab"><i>B</i><i>A</i></span>
              <span className="handheld-speaker"><i /><i /><i /><i /></span>
            </div>
          )}
        </div>
        <div className="play-controls-note">
          <span className="play-input-label">INPUT</span>
          <span className="play-key-list">{controls.map((control, index) => <kbd key={`${control}-${index}`}>{keyLabel(control)}</kbd>)}</span>
          <small>게임 화면을 클릭하면 키보드 조작이 활성화됩니다</small>
          <span className="play-resolution">{viewport.w}×{viewport.h} · {frame.scale}X</span>
        </div>
      </div>
    </div>
  )
}
