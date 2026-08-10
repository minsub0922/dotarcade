// DOTCADE — 자동 QA: 샌드박스에서 봇 스모크 테스트
import { mountGame } from './harness.js'

export function syntaxCheck(code) {
  try { new Function(code); return { ok: true } }
  catch (e) { return { ok: false, error: String(e.message || e) } }
}

// mountEl이 주어지면 그 안에 라이브 프리뷰로 표시 (rAF 스로틀 방지 겸 관전 요소)
export function runSmokeTest(code, { mountEl, durationMs = 9000, seed = 12345, bot } = {}) {
  return new Promise(resolve => {
    const syn = syntaxCheck(code)
    if (!syn.ok) {
      return resolve({ pass: false, diagnostics: { fatal: `구문 오류: ${syn.error}`, errors: [], ready: false } })
    }
    let host = mountEl
    let temp = false
    if (!host) {
      host = document.createElement('div')
      host.style.cssText = 'position:fixed;right:4px;bottom:4px;width:150px;height:110px;opacity:.92;z-index:4;border-radius:6px;overflow:hidden;pointer-events:none;'
      document.body.appendChild(host); temp = true
    }
    const d = { ready: false, fatal: null, errors: [], score: 0, scoreChanged: false, overFired: false, lit: null, presses: 0, ms: 0 }
    const game = mountGame(host, code, { mode: 'bot', seed, bot: bot || { aggression: 0.65, intervalMs: 130, holdMs: 150, durationMs: durationMs - 1200 } })
    const finish = () => {
      clearTimeout(killT)
      game.dispose()
      if (temp) host.remove()
      const pass = d.ready && !d.fatal && d.errors.length === 0 && (d.lit === null || d.lit >= 15) && (d.scoreChanged || d.overFired)
      resolve({ pass, diagnostics: d })
    }
    const killT = setTimeout(finish, durationMs + 2500)
    game.on(m => {
      if (m.type === 'ready') d.ready = true
      if (m.type === 'fatal') { d.fatal = m.message; setTimeout(finish, 50) }
      if (m.type === 'error') d.errors.push(m.message + (m.line ? ` (line ${m.line})` : ''))
      if (m.type === 'score') { if (m.score !== d.score) d.scoreChanged = true; d.score = m.score }
      if (m.type === 'drawcheck') d.lit = m.lit
      if (m.type === 'over' || m.type === 'timeout') {
        d.overFired = m.type === 'over'
        d.score = m.score ?? d.score; d.presses = m.presses || 0; d.ms = m.ms || 0
        setTimeout(finish, 200)
      }
    })
  })
}

export function extractCode(text) {
  const blocks = [...String(text).matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)].map(m => m[1])
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim()
  // 코드블록이 없으면 window.game 시작점부터 전체를 시도
  const i = text.indexOf('window.game')
  return i >= 0 ? text.slice(i).trim() : text.trim()
}
