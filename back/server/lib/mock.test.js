import test from 'node:test'
import assert from 'node:assert/strict'
import { mockGameCode, mockProvider } from './mock.js'
import { visualQualityCheck } from '../../../front/web/src/game/qa.js'

function loadMeta(code) {
  const host = {}
  new Function(code)
  new Function('window', code)(host)
  return host.game.meta
}

function extractCode(text) {
  return String(text).match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/)?.[1]?.trim() || ''
}

const fontSize = font => Number(String(font).match(/([0-9.]+)px/)?.[1] || 0)

function mountFirstFrame(code) {
  const listeners = new Map()
  const textCalls = []
  const events = []
  const stack = []
  const gradient = { addColorStop() {} }
  const ctx = {
    font: '10px monospace', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    save() {
      stack.push({
        font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline,
        fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth, globalAlpha: this.globalAlpha
      })
    },
    restore() { Object.assign(this, stack.pop() || {}) },
    measureText(value) {
      const size = Number.parseFloat(this.font) || 10
      const width = Array.from(String(value)).reduce((sum, glyph) => {
        if (/\s/.test(glyph)) return sum + size * 0.5
        return sum + (/^[\x00-\x7f]$/.test(glyph) ? size * 0.62 : size)
      }, 0)
      return { width }
    },
    fillText(value, x, y, maxWidth) {
      textCalls.push({
        text: String(value), x, y, maxWidth,
        width: this.measureText(value).width,
        font: this.font, fillStyle: this.fillStyle,
        textAlign: this.textAlign, textBaseline: this.textBaseline
      })
    },
    createLinearGradient() { return gradient },
    createRadialGradient() { return gradient },
    fillRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, ellipse() {},
    translate() {}, scale() {}
  }
  const host = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener))
    }
  }
  new Function('window', code)(host)

  const previousRaf = globalThis.requestAnimationFrame
  const previousCancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  host.game.start({ width: 480, height: 320, getContext: () => ctx }, {
    rng: () => 0.5,
    reportScore() {}, gameOver() {}, observe() {},
    emit(type, payload) { events.push({ type, payload }) }
  })

  return {
    textCalls,
    events,
    press(code) {
      for (const listener of listeners.get('keydown') || []) listener({ code })
      for (const listener of listeners.get('keyup') || []) listener({ code })
    },
    cleanup() {
      host.game.stop()
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame
      else globalThis.requestAnimationFrame = previousRaf
      if (previousCancelRaf === undefined) delete globalThis.cancelAnimationFrame
      else globalThis.cancelAnimationFrame = previousCancelRaf
    }
  }
}

test('mock fallback is deterministic, syntax-valid and satisfies the adaptive 2.5D contract', () => {
  const options = { title: '별빛 정원', theme: '#ffd24a', bad: '#ff5a7a', item: '★' }
  const code = mockGameCode(options)
  assert.equal(code, mockGameCode(options))
  assert.doesNotMatch(code, /Math\.random/)

  const meta = loadMeta(code)
  const quality = visualQualityCheck(code, meta, { colors: 12, regions: [80, 90, 100] })
  assert.equal(quality.ok, true, quality.missing.join('\n'))
  assert.deepEqual(meta.visual.screens, ['title', 'gameplay', 'result', 'help'])
  assert.match(code, /api\.observe/)
  assert.match(code, /api\.emit/)
  assert.match(code, /api\.gameOver/)

  const renderer = code.slice(code.indexOf('function drawPanel'), code.indexOf('function updateGameplay'))
  assert.doesNotMatch(renderer, /\brng\s*\(/, '렌더 함수가 매 프레임 게임 RNG를 소비하면 안 됩니다')
})

test('long localized titles fit inside a two-line safe area without touching the subtitle', () => {
  const title = '계절을 넘나드는 작은 별빛 정원 탐험대와 비밀 수호자'
  const view = mountFirstFrame(mockGameCode({ title, theme: '#65d9ff' }))
  try {
    const titleCalls = view.textCalls.filter(call => call.fillStyle === '#65d9ff' && call.y >= 57 && call.y <= 102)
    assert.ok(titleCalls.length >= 1 && titleCalls.length <= 2)
    assert.equal(titleCalls.map(call => call.text).join('').replace(/\s/g, ''), title.replace(/\s/g, ''))
    assert.ok(titleCalls.every(call => call.width <= 238 + 0.001))
    assert.ok(titleCalls.every(call => call.maxWidth === 238 && call.textBaseline === 'middle'))
    const lastLine = titleCalls.at(-1)
    assert.ok(lastLine.y + fontSize(lastLine.font) * 0.55 < 110, 'title must leave breathing room before the subtitle at y=113')
  } finally {
    view.cleanup()
  }
})

test('extreme unbroken Unicode titles are bounded and end with an ellipsis', () => {
  const title = '초장문제목'.repeat(24)
  const view = mountFirstFrame(mockGameCode({ title, theme: '#ffcc55' }))
  try {
    const titleCalls = view.textCalls.filter(call => call.fillStyle === '#ffcc55' && call.y >= 57 && call.y <= 102)
    assert.equal(titleCalls.length, 2)
    assert.match(titleCalls.at(-1).text, /…$/)
    assert.ok(titleCalls.every(call => call.width <= 238 + 0.001))
    assert.ok(titleCalls.every(call => fontSize(call.font) >= 13))
  } finally {
    view.cleanup()
  }
})

test('screen telemetry follows reachable aux screens and Escape resets title focus', () => {
  const code = mockGameCode({ collection: true })
  assert.ok(loadMeta(code).controls.includes('Escape'))
  const view = mountFirstFrame(code)
  try {
    const screenIds = () => view.events.filter(event => event.type === 'screen').map(event => event.payload.id)
    assert.deepEqual(screenIds(), ['title'])
    view.press('ArrowDown')
    assert.deepEqual(screenIds(), ['title'], 'menu focus is not a screen visit')
    view.press('Space')
    assert.deepEqual(screenIds(), ['title', 'party'])
    view.press('Escape')
    assert.deepEqual(screenIds(), ['title', 'party', 'title'])
    view.press('ArrowDown')
    view.press('ArrowDown')
    view.press('Space')
    assert.deepEqual(screenIds(), ['title', 'party', 'title', 'codex'])
  } finally {
    view.cleanup()
  }
})

test('collection planning produces reachable party/codex fallback screens that pass strict QA', async () => {
  const out = await mockProvider.generate({
    hint: 'code',
    messages: [{ role: 'user', text: '[안건] 포켓몬처럼 몬스터를 수집하고 파티와 도감을 구성하는 게임' }]
  })
  const code = extractCode(out.text)
  assert.ok(code)
  const meta = loadMeta(code)
  assert.deepEqual(meta.visual.screens, ['title', 'gameplay', 'result', 'party', 'codex'])
  const quality = visualQualityCheck(code, meta, { colors: 12, regions: [80, 90, 100] }, {
    requiredScreens: ['party', 'codex']
  })
  assert.equal(quality.ok, true, quality.missing.join('\n'))
  assert.match(code, /setScreen\(menuIndex === 1 \? 'party' : 'codex', 'menu-confirm'\)/)
})

test('shared contract examples do not misclassify an ordinary game as collection genre', async () => {
  const out = await mockProvider.generate({
    hint: 'code',
    messages: [{
      role: 'user',
      text: '[안건] 우주선을 좌우로 움직여 운석을 피하는 러너\n[공통 계약] 몬스터 수집형은 party와 codex를 구현한다.'
    }]
  })
  const meta = loadMeta(extractCode(out.text))
  assert.deepEqual(meta.visual.screens, ['title', 'gameplay', 'result', 'help'])
})

test('research and generated titles prioritize the explicit agenda over prompt boilerplate', async () => {
  const prompt = `팀장이 새 회의 안건을 냈습니다: "바람 우체부가 섬을 오가는 배달 게임"
기획 근거를 조사하고 이전 회의 문서와 레퍼런스 계약을 반드시 준수하세요.`
  const research = await mockProvider.generate({ hint: 'research', messages: [{ role: 'user', text: prompt }] })
  assert.match(research.text, /'바람' 관련 최근 트렌드/)
  assert.match(research.text, /제안 키워드: 바람, 우체부가, 섬을/)
  assert.doesNotMatch(research.text, /냈습니다|팀장이|레퍼런스 계약/)

  const generated = await mockProvider.generate({ hint: 'code', messages: [{ role: 'user', text: prompt }] })
  assert.equal(loadMeta(extractCode(generated.text)).title, '바람 우체부가')
})

test('QA repair preserves the current code title instead of deriving one from repair boilerplate', async () => {
  const originalTitle = '별빛 정원 수호대'
  const currentCode = mockGameCode({ title: originalTitle })
  const prompt = `[수리 대상 게임 정체성 — 기능 수리와 무관하게 유지]
[안건] 별빛 정원에서 빛 조각을 모으고 운석을 피하는 수집형 캐처

방금 구현한 게임이 자동 QA에서 실패했습니다.

[QA 진단]
{"visual":{"missing":["drawNearLayer"]}}

[현재 코드]
\`\`\`js
${currentCode}
\`\`\``
  const repaired = await mockProvider.generate({
    hint: 'repair',
    messages: [{ role: 'user', text: prompt }]
  })
  assert.equal(loadMeta(extractCode(repaired.text)).title, originalTitle)
  assert.doesNotMatch(loadMeta(extractCode(repaired.text)).title, /방금|원정대/)
})

test('QA repair falls back to the original agenda when current code has no readable title', async () => {
  const repaired = await mockProvider.generate({
    hint: 'repair',
    messages: [{
      role: 'user',
      text: `[안건] 바람 우체부가 섬을 오가는 배달 게임\n[현재 코드]\n\`\`\`js\nwindow.game={meta:{}}\n\`\`\``
    }]
  })
  assert.equal(loadMeta(extractCode(repaired.text)).title, '바람 우체부가')
})

test('visible titles remove comparison references and contract-forbidden terms without genre hardcoding', async () => {
  const originalityContract = {
    contractId: 'originality-title-contract',
    target: { id: 'reference-saga', title: 'Example Saga' },
    screens: ['title', 'gameplay', 'result', 'help'],
    originality: { forbiddenVisibleTerms: ['Example', 'Saga', '조각'] }
  }
  const prompt = `[안건] Example Saga 같은 별 조각을 모으는 항해 게임
[정규화된 레퍼런스 디자인 계약 — 모든 제작 단계의 단일 기준]
\`\`\`json
${JSON.stringify(originalityContract)}
\`\`\``
  for (const hint of ['code', 'repair']) {
    const out = await mockProvider.generate({ hint, messages: [{ role: 'user', text: prompt }] })
    const meta = loadMeta(extractCode(out.text))
    assert.doesNotMatch(meta.title, /Example|Saga|조각|같은|모으는/i)
    assert.match(meta.title, /항해|원정대|작전|탐사록|항해단|야행|대소동|프론티어|퀘스트/)
    assert.ok(Array.from(meta.title).length <= 28)
    assert.equal(meta.reference.contractId, originalityContract.contractId)
  }

  const comparisonOnly = await mockProvider.generate({
    hint: 'code', messages: [{ role: 'user', text: '[안건] 어떤 유명작처럼 몬스터를 수집하는 탐험 게임' }]
  })
  const comparisonTitle = loadMeta(extractCode(comparisonOnly.text)).title
  assert.doesNotMatch(comparisonTitle, /유명작|처럼|몬스터를|수집하는/)
  assert.match(comparisonTitle, /^몬스터\s+/)
})

const referenceContract = {
  version: '1.0',
  contractId: 'reference-contract-mock-7',
  target: { id: 'structural-target', title: 'Structural Target' },
  screens: [
    { id: 'title', required: true },
    { id: 'gameplay', required: true },
    { id: 'result', required: true },
    { id: 'loadout', required: true }
  ],
  patterns: [
    { id: 'command-menu', required: true, signals: ['token:selectedIndex'], targetScreens: ['loadout'] },
    { id: 'tactical-map', required: true, signals: ['renderer:drawTacticalMap'], targetScreens: ['loadout'] },
    { id: 'optional-dialog', required: false, signals: ['renderer:drawMissingDialog'] }
  ],
  qa: {
    requiredScreens: ['title', 'gameplay', 'result', 'loadout'],
    requiredPatternIds: ['command-menu', 'tactical-map'],
    requiredStates: [{ id: 'battle-ready', signals: ['state:battleReady'] }],
    depthSignals: [{ id: 'perspective-scale', signals: ['token:depthScale'] }],
    feedbackSignals: [{ id: 'selection-feedback', signals: ['token:selectedIndex'] }]
  }
}

const contractPrompt = `[안건] 작은 전술 캐처 게임\n[정규화된 레퍼런스 디자인 계약 — 모든 제작 단계의 단일 기준]\n\`\`\`json\n${JSON.stringify(referenceContract, null, 2)}\n\`\`\``

test('code and repair fallbacks carry the normalized reference contract through strict visual QA', async () => {
  for (const hint of ['code', 'repair']) {
    const out = await mockProvider.generate({ hint, messages: [{ role: 'user', text: contractPrompt }] })
    const code = extractCode(out.text)
    const meta = loadMeta(code)
    assert.equal(meta.reference.contractId, referenceContract.contractId)
    assert.equal(meta.reference.targetId, referenceContract.target.id)
    assert.deepEqual(meta.reference.implementedPatterns, ['command-menu', 'tactical-map'])
    assert.deepEqual(meta.reference.implementedStates, ['battle-ready'])
    assert.ok(meta.visual.screens.includes('loadout'))
    assert.match(code, /function drawOverlayScreen\s*\(/)
    assert.match(code, /function drawTacticalMap\s*\(/)
    assert.doesNotMatch(code, /drawMissingDialog/, 'optional reference patterns must not be claimed or generated')

    const quality = visualQualityCheck(code, meta, { colors: 12, regions: [80, 90, 100] }, {
      designContract: referenceContract
    })
    assert.equal(quality.ok, true, quality.missing.join('\n'))
    assert.equal(quality.reference.traceable, true)
    assert.equal(quality.reference.implementationVerified, true)
  }
})

test('field-only meta examples are parsed without evaluating prompt code', async () => {
  delete globalThis.__mockContractExecuted
  const metaOnlyContract = {
    contractId: 'meta-example-contract', targetId: 'meta-example-target',
    screens: ['title', 'gameplay', 'result', 'status'],
    patterns: ['safe-hud'], states: ['gameplay-active'],
    depth: ['perspective-scale'], feedback: ['semantic-event']
  }
  const prompt = `[안건] 운석 피하기\n구현 코드의 meta 선언 예: reference: { contractId: '${metaOnlyContract.contractId}', targetId: '${metaOnlyContract.targetId}', implementedPatterns: ['safe-hud'], screens: ['title','gameplay','result','status'], implementedStates: ['gameplay-active'], depthSignals: ['perspective-scale'], feedbackSignals: ['semantic-event'] }; (() => { globalThis.__mockContractExecuted = true })()`
  const out = await mockProvider.generate({ hint: 'code', messages: [{ role: 'user', text: prompt }] })
  assert.equal(globalThis.__mockContractExecuted, undefined)
  const code = extractCode(out.text)
  const meta = loadMeta(code)
  assert.equal(meta.reference.contractId, metaOnlyContract.contractId)
  assert.equal(meta.reference.targetId, metaOnlyContract.targetId)
  assert.ok(meta.visual.screens.includes('status'))

  const designContract = {
    contractId: metaOnlyContract.contractId,
    targetId: metaOnlyContract.targetId,
    screens: metaOnlyContract.screens,
    patterns: metaOnlyContract.patterns,
    qa: {
      requiredScreens: metaOnlyContract.screens,
      requiredPatternIds: metaOnlyContract.patterns,
      requiredStates: metaOnlyContract.states,
      depthSignals: metaOnlyContract.depth,
      feedbackSignals: metaOnlyContract.feedback
    }
  }
  const quality = visualQualityCheck(code, meta, { colors: 12, regions: [80, 90, 100] }, { designContract })
  assert.equal(quality.ok, true, quality.missing.join('\n'))
})
