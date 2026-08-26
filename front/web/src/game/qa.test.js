import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReferenceContract, runtimeVisualQualityCheck, visualQualityCheck } from './qa.js'

const richRenderer = `
function drawFarLayer(){ ctx.fillRect(0,0,480,320); ctx.createLinearGradient(0,0,0,320) }
function drawMidLayer(){ const horizon = 100; const depthScale = y => .65 + y / 600; ctx.beginPath(); ctx.lineTo(2,3) }
function drawNearLayer(){ ctx.ellipse(20,20,8,3,0,0,Math.PI*2) }
function drawTitle(){ ctx.fillText('TITLE',20,20) }
function drawGameplay(){ drawPanel() }
function drawResult(){ ctx.strokeRect(10,10,100,80) }
function drawCollection(){ drawPanel() }
function drawParty(){ drawPanel() }
function drawCodex(){ drawPanel() }
function drawPanel(){ ctx.strokeRect(0,0,10,10); ctx.fillText('UI',2,8) }
`

const meta = {
  viewport: { w: 480, h: 320 },
  visual: {
    aspect: '3:2', depthLayers: ['far', 'mid', 'near'], perspective: true,
    screens: ['title', 'gameplay', 'result', 'collection']
  }
}

test('visual contract accepts layered Canvas 2D game with one genre-appropriate auxiliary screen', () => {
  const result = visualQualityCheck(richRenderer, meta, { colors: 12, regions: [30, 40, 50] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
})

test('collection game can require both party and codex without forcing them on every genre', () => {
  const missing = visualQualityCheck(richRenderer, meta, null, { requiredScreens: ['party', 'codex'] })
  assert.equal(missing.ok, false)
  assert.match(missing.missing.join('\n'), /party\/codex/)

  const collectionMeta = {
    ...meta,
    visual: { ...meta.visual, screens: [...meta.visual.screens, 'party', 'codex'] }
  }
  assert.equal(visualQualityCheck(richRenderer, collectionMeta, null, { requiredScreens: ['party', 'codex'] }).ok, true)
})

test('viewport aspect label must match one of the supported game orientations', () => {
  const portrait = {
    ...meta,
    viewport: { w: 360, h: 480 },
    visual: { ...meta.visual, aspect: '3:4' }
  }
  assert.equal(visualQualityCheck(richRenderer, portrait).ok, true)

  const wrong = { ...portrait, visual: { ...portrait.visual, aspect: '3:2' } }
  const result = visualQualityCheck(richRenderer, wrong)
  assert.equal(result.ok, false)
  assert.match(result.missing.join('\n'), /3:4/)
})

test('high-quality composed drawWorld and genre screen names avoid name-only false negatives', () => {
  const composed = `
    function drawWorld(){
      const horizon = 120, depthScale = .8; ctx.createLinearGradient(0,0,0,320)
      ctx.fillRect(0,0,480,320); ctx.beginPath(); ctx.lineTo(10,20)
      ctx.ellipse(30,30,12,4,0,0,6.28); ctx.strokeRect(0,0,20,20); ctx.fillText('HUD',4,12)
    }
    function drawPanel(){ ctx.strokeRect(1,1,10,10); ctx.fillText('UI',2,8) }
    function drawTitle(){} function drawBattle(){} function drawGameOver(){} function drawParty(){} function drawCodex(){}
  `
  const collectionMeta = {
    ...meta,
    visual: { ...meta.visual, screens: ['title', 'gameplay', 'result', 'party', 'codex'] }
  }
  const result = visualQualityCheck(composed, collectionMeta, null, { requiredScreens: ['party', 'codex'] })
  assert.equal(result.ok, true)
  assert.equal(result.signals.composedWorldRenderer, true)
})

test('flat single-screen renderer is rejected with actionable diagnostics', () => {
  const result = visualQualityCheck(`function drawGameplay(){ctx.fillRect(0,0,480,320)}`, {
    viewport: { w: 480, h: 320 },
    visual: { aspect: '3:2', depthLayers: ['mid'], perspective: false, screens: ['gameplay'] }
  })
  assert.equal(result.ok, false)
  assert.ok(result.missing.length >= 6)
  assert.match(result.missing.join('\n'), /far\/mid\/near/)
  assert.match(result.missing.join('\n'), /보조 화면/)
})

const frame = value => Array.from({ length: 8 * 6 * 3 }, () => value)
const quality = ({ clipped = [], unsafe = [], screens = [] } = {}) => ({
  text: { samples: 6, clipped, unsafe },
  screens: { samples: screens }
})

test('runtime gate rejects actual clipped and unsafe text even when source/meta look complete', () => {
  const result = runtimeVisualQualityCheck(quality({
    clipped: [{ text: 'A title that cannot fit', left: -38, right: 520, top: 10, bottom: 34 }],
    unsafe: [{ text: 'A title that cannot fit', left: -38, right: 520, top: 10, bottom: 34 }]
  }), { requiredScreens: [] })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'VIS_TEXT_CLIPPED'))
  assert.ok(result.issues.some(issue => issue.code === 'VIS_TEXT_SAFE_AREA'))
})

test('runtime gate rejects maxWidth text that is technically bounded but visibly squashed', () => {
  const result = runtimeVisualQualityCheck({
    text: {
      samples: 1, clipped: [], unsafe: [],
      squashed: [{ text: 'A very long generated title', naturalWidth: 420, width: 220 }]
    },
    screens: { samples: [] }
  }, { requiredScreens: [] })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'VIS_TEXT_SQUASHED'))
  assert.match(result.issues.find(issue => issue.code === 'VIS_TEXT_SQUASHED').hint, /wrap.*ellipsis/)
})

test('runtime gate requires real reachable and visually distinct non-terminal screens', () => {
  const result = runtimeVisualQualityCheck(quality({ screens: [
    { id: 'title', signature: frame(1) },
    { id: 'gameplay', signature: frame(10) },
    { id: 'collection', signature: frame(6) }
  ] }), { requiredScreens: ['title', 'gameplay', 'result', 'collection'] })
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.deepEqual(result.summary.visitedScreens, ['title', 'gameplay', 'collection'])

  const unreachable = runtimeVisualQualityCheck(quality({ screens: [
    { id: 'title', signature: frame(2) },
    { id: 'gameplay', signature: frame(2) }
  ] }), { requiredScreens: ['title', 'gameplay', 'result', 'collection'] })
  assert.equal(unreachable.ok, false)
  assert.ok(unreachable.issues.some(issue => issue.code === 'VIS_SCREEN_UNREACHABLE' && issue.item === 'collection'))
  assert.ok(unreachable.issues.some(issue => issue.code === 'VIS_SCREEN_NOT_DISTINCT' && issue.item === 'gameplay'))
  assert.ok(!unreachable.issues.some(issue => issue.item === 'result'))
})

test('runtime gate requires result reachability when the game actually fires game over', () => {
  const result = runtimeVisualQualityCheck(quality({ screens: [
    { id: 'title', signature: frame(1) },
    { id: 'gameplay', signature: frame(7) },
    { id: 'help', signature: frame(4) }
  ] }), { requiredScreens: ['title', 'gameplay', 'result', 'help'], terminalExpected: true })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'VIS_SCREEN_UNREACHABLE' && issue.item === 'result'))
})

const designContract = {
  version: 1,
  contractId: 'reference-contract-42',
  targetId: 'target-example',
  targetTitle: 'Example Reference',
  screens: [
    { id: 'title', required: true },
    { id: 'gameplay', required: true },
    { id: 'result', required: true },
    { id: 'collection', required: true }
  ],
  patterns: [
    { id: 'command-menu', required: true, implementationCue: 'token:selectedIndex' },
    { id: 'optional-map', required: false, implementationCue: 'renderer:drawMap' }
  ],
  qa: {
    requiredScreens: ['title', 'gameplay', 'result', 'collection'],
    requiredPatternIds: ['command-menu'],
    requiredStates: [{ id: 'battle-ready', signals: ['state:battleReady'] }],
    depthSignals: [{ id: 'perspective-scale', signals: ['token:depthScale'] }],
    feedbackSignals: [{ id: 'selection-feedback', signals: ['token:selectedIndex'] }]
  }
}

const referenceMeta = {
  ...meta,
  reference: {
    contractId: 'reference-contract-42',
    target: 'target-example',
    screens: ['title', 'gameplay', 'result', 'collection'],
    implementedPatterns: ['command-menu'],
    implementedStates: ['battle-ready'],
    depthSignals: ['perspective-scale'],
    feedbackSignals: ['selection-feedback']
  }
}

test('normalizes the persisted design contract and excludes optional patterns', () => {
  const normalized = normalizeReferenceContract({ designContract })
  assert.equal(normalized.contractId, 'reference-contract-42')
  assert.deepEqual(normalized.requiredScreens, ['title', 'gameplay', 'result', 'collection'])
  assert.deepEqual(normalized.requiredPatternIds, ['command-menu'])
})

test('reference contract passes only with matching trace and objective implementation signals', () => {
  const code = `${richRenderer}\nconst selectedIndex = 0, battleReady = true`
  const result = visualQualityCheck(code, referenceMeta, { colors: 12, regions: [20, 30, 40] }, { designContract })
  assert.equal(result.ok, true)
  assert.equal(result.reference.traceable, true)
  assert.equal(result.reference.implementationVerified, true)
  assert.equal(result.reference.passed, result.reference.checks)
})

test('matching meta trace alone cannot satisfy a missing reference implementation', () => {
  const result = visualQualityCheck(richRenderer, referenceMeta, null, { referenceContract: designContract })
  assert.equal(result.ok, false)
  assert.equal(result.reference.traceable, true)
  assert.equal(result.reference.implementationVerified, false)
  assert.ok(result.issues.some(issue => issue.code === 'REF_PATTERN_SIGNAL'))
  assert.match(result.missing.join('\n'), /selectedIndex/)
})

test('reference-only identifiers may stay in code trace but forbidden terms cannot leak into the visible title', () => {
  const originalityContract = {
    ...designContract,
    originality: { forbiddenVisibleTerms: ['ReferenceMon'] }
  }
  const code = `${richRenderer}\nconst selectedIndex = 0, battleReady = true, internalTargetId = 'ReferenceMon'`
  const cleanMeta = { ...referenceMeta, title: '별빛 생태 조사단' }
  const cleanResult = visualQualityCheck(code, cleanMeta, null, { designContract: originalityContract })
  assert.equal(cleanResult.ok, true, cleanResult.missing.join('\n'))
  assert.equal(cleanResult.reference.originalityVerified, true)

  const leakedResult = visualQualityCheck(code, { ...cleanMeta, title: 'ReferenceMon 별빛 탐험' }, null, {
    designContract: originalityContract
  })
  assert.equal(leakedResult.ok, false)
  assert.ok(leakedResult.issues.some(issue => issue.code === 'REF_ORIGINALITY_TITLE'))
  assert.match(leakedResult.issues.find(issue => issue.code === 'REF_ORIGINALITY_TITLE').hint, /meta\.title/)
})

test('reference diagnostics identify trace, screen and pattern repair actions separately', () => {
  const brokenMeta = {
    ...meta,
    visual: { ...meta.visual, screens: ['title', 'gameplay', 'result'] },
    reference: { contractId: 'wrong-contract', targetId: 'wrong-target', implementedPatterns: [] }
  }
  const result = visualQualityCheck(richRenderer, brokenMeta, null, { designContract })
  const codes = result.issues.map(issue => issue.code)
  assert.ok(codes.includes('REF_TRACE_CONTRACT'))
  assert.ok(codes.includes('REF_TRACE_TARGET'))
  assert.ok(codes.includes('REF_SCREEN_META'))
  assert.ok(codes.includes('REF_PATTERN_TRACE'))
  assert.match(result.issues.find(issue => issue.code === 'REF_TRACE_CONTRACT').hint, /meta\.reference\.contractId/)
})

test('canonical prose blueprint uses semantic state, depth and feedback checks without literal-prose false negatives', () => {
  const canonical = {
    contractId: 'canonical-1', targetId: 'generic-target',
    screens: designContract.screens,
    patterns: [
      { id: 'depth-stage', implementationCue: 'Use a horizon, y-dependent scale and contact shadows.', required: true },
      { id: 'state-feedback', verify: 'Every consequential input settles visibly.', required: true },
      { id: 'safe-hud', implementationCue: 'Keep the playfield dominant.', required: true },
      { id: 'adaptive-viewport', verify: 'Core screens remain readable.', required: true }
    ],
    requiredStates: ['title:idle', 'gameplay:active', 'gameplay:feedback', 'result:summary'],
    qa: {
      requiredScreens: ['title', 'gameplay', 'result', 'collection'],
      requiredPatternIds: ['depth-stage', 'state-feedback', 'safe-hud', 'adaptive-viewport'],
      requiredStates: ['title:idle', 'gameplay:active', 'gameplay:feedback', 'result:summary'],
      depthSignals: ['meta.visual.perspective=true', 'far/mid/near render passes', 'y-dependent scale', 'ellipse contact shadows', 'foreground light/vignette'],
      feedbackSignals: ['input acknowledgement', 'anticipation', 'impact or reaction', 'settled state', 'semantic event']
    }
  }
  const source = `${richRenderer}
    const canvas = { width: 480, height: 320 }, selectedIndex = 0
    let feedbackTimer = 0, stateTimer = 0, damageFlash = 0
    window.addEventListener('keydown', () => { feedbackTimer = 8; api.emit('hit', { value: 1 }) })
  `
  const ids = values => values.map(value => String(value).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-'))
  const canonicalMeta = {
    ...meta,
    reference: {
      contractId: 'canonical-1', targetId: 'generic-target',
      screens: canonical.qa.requiredScreens,
      implementedPatterns: canonical.qa.requiredPatternIds,
      implementedStates: ids(canonical.qa.requiredStates),
      depthSignals: ids(canonical.qa.depthSignals),
      feedbackSignals: ids(canonical.qa.feedbackSignals)
    }
  }
  const result = visualQualityCheck(source, canonicalMeta, null, { designContract: canonical })
  assert.equal(result.ok, true, result.missing.join('\n'))
  assert.equal(result.reference.implementationVerified, true)
})
