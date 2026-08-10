import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { api } from '../api.js'
import { mountGame } from '../game/harness.js'

export default function PlayModal() {
  const { panelData, closePanel } = useStore()
  const hostRef = useRef(null)
  const gameRef = useRef(null)
  const [meta, setMeta] = useState(null)
  const [score, setScore] = useState(0)
  const [over, setOver] = useState(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let disposed = false
    setOver(null); setScore(0)
    ;(async () => {
      const b = await api.bundle(panelData.gameId, panelData.version).catch(() => null)
      if (!b?.code || disposed) return
      setMeta(b.meta)
      const g = mountGame(hostRef.current, b.code, { mode: 'play' })
      gameRef.current = g
      g.on(m => {
        if (m.type === 'score') setScore(m.score)
        if (m.type === 'over' || m.type === 'timeout') setOver(m.score)
        if (m.type === 'ready') setTimeout(() => g.iframe.focus(), 250)
      })
    })()
    return () => { disposed = true; gameRef.current?.dispose(); gameRef.current = null }
  }, [panelData.gameId, panelData.version, nonce])

  return (
    <div className="modal-back dark" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className="modal play">
        <div className="modal-head">
          <b>{meta ? `${meta.emoji || '🎮'} ${meta.title} ${meta.version || ''}` : '로딩...'}</b>
          <span className="score-live">SCORE {score}</span>
          <button className="x" onClick={closePanel}>✕</button>
        </div>
        <div className="play-host" ref={hostRef} onClick={() => gameRef.current?.iframe.focus()} />
        {over != null && (
          <div className="play-over">
            <div className="big">GAME OVER — {over}점</div>
            <button className="primary" onClick={() => setNonce(n => n + 1)}>다시 하기</button>
          </div>
        )}
        <div className="tiny muted center">게임 화면을 클릭하면 키보드 조작이 활성화됩니다 · 조작: {(meta?.controls || []).join(' ')}</div>
      </div>
    </div>
  )
}
