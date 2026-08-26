// DOTCADE — 자동 QA: 샌드박스에서 봇 스모크 테스트
import { mountGame } from './harness.js'

export const REQUIRED_VISUAL_SCREENS = ['title', 'gameplay', 'result']
export const REQUIRED_DEPTH_LAYERS = ['far', 'mid', 'near']
export const AUXILIARY_VISUAL_SCREENS = ['party', 'loadout', 'collection', 'codex', 'help', 'map', 'status']

const VIEWPORT_ASPECTS = new Map([
  ['480x320', '3:2'],
  ['360x480', '3:4'],
  ['400x400', '1:1']
])

const rendererSignal = (source, name) => new RegExp(`\\b${name}\\s*(?:=|\\()`, 'i').test(source)

const array = value => Array.isArray(value) ? value.filter(Boolean) : []
const list = value => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
const compactId = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-')
const unique = values => [...new Set(values.filter(Boolean))]
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sourceToken = (source, value) => {
  const token = String(value || '').trim()
  if (!token) return false
  const parts = token.split(/[^a-z0-9가-힣]+/i).filter(part => part.length > 2)
  if (!parts.length) return false
  return parts.every(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(source))
}

const itemId = item => compactId(typeof item === 'string' ? item : item?.id || item?.key || item?.name || item?.screen || item?.state)
const requiredItems = value => array(value).filter(item => typeof item === 'string' || item?.required !== false)

// reference-research의 출력은 저장된 구버전과 새 designContract를 모두 읽는다.
// QA 내부 표현을 하나로 모아 호출부/저장 데이터 마이그레이션 없이 계약을 강화한다.
export function normalizeReferenceContract(value) {
  if (!value || typeof value !== 'object') return null
  const contract = value.designContract || value.blueprint || value
  const qa = contract.qa || contract.validation || {}
  const target = contract.target || contract.referenceTarget || {}
  const availableScreens = array(contract.screens || contract.screenContract || qa.screens)
  const availablePatterns = array(contract.patterns || contract.uiPatterns || qa.patterns)
  const explicitScreenIds = array(qa.requiredScreens).map(itemId)
  const explicitPatternIds = array(qa.requiredPatternIds).map(itemId)
  const screens = requiredItems(explicitScreenIds.length
    ? [...availableScreens.filter(item => explicitScreenIds.includes(itemId(item))), ...explicitScreenIds.filter(id => !availableScreens.some(item => itemId(item) === id))]
    : availableScreens)
  const patterns = requiredItems(explicitPatternIds.length
    ? [...availablePatterns.filter(item => explicitPatternIds.includes(itemId(item))), ...explicitPatternIds.filter(id => !availablePatterns.some(item => itemId(item) === id))]
    : availablePatterns)
  const states = requiredItems(qa.requiredStates || contract.requiredStates || contract.states)
  const depth = requiredItems(qa.depthSignals || contract.depthSignals || contract.depth?.required || contract.depth)
  const feedback = requiredItems(qa.feedbackSignals || contract.feedbackSignals || contract.feedback?.required || contract.feedback)
  const forbiddenVisibleTerms = unique(array(
    contract.originality?.forbiddenVisibleTerms || contract.forbiddenVisibleTerms || contract.originality?.visibleTerms
  ).map(value => String(value || '').trim()).filter(value => value.length >= 2))
  return {
    raw: contract,
    traceability: array(contract.traceability || contract.trace || contract.implementationTrace),
    contractId: String(contract.contractId || contract.id || contract.trace?.contractId || ''),
    targetId: String(target.id || contract.targetId || contract.trace?.targetId || ''),
    targetTitle: String(target.title || contract.targetTitle || ''),
    screens,
    patterns,
    states,
    depth,
    feedback,
    forbiddenVisibleTerms,
    requiredScreens: unique([
      ...array(qa.requiredScreens).map(itemId),
      ...screens.map(itemId)
    ]),
    requiredPatternIds: patterns.map(itemId),
    requiredStateIds: states.map(itemId),
    requiredDepthIds: depth.map(itemId),
    requiredFeedbackIds: feedback.map(itemId)
  }
}

const machineSignal = signal => {
  if (typeof signal === 'object') return true
  const value = String(signal || '').trim()
  return /^(?:renderer|regex|token|state|draw):/i.test(value) || (!/\s/.test(value) && /[._()=:]|^[A-Za-z_$][\w$]*$/.test(value))
}
const signalList = item => unique([
  ...list(item?.qaSignals), ...list(item?.implementationSignals), ...list(item?.codeSignals), ...list(item?.signals), ...list(item?.tokens),
  ...list(item?.implementationCue), ...list(item?.verify)
].filter(machineSignal))

function customSignalPresent(source, signal) {
  if (!signal) return false
  if (typeof signal === 'object') {
    const type = compactId(signal.type || signal.kind)
    const value = signal.value || signal.name || signal.token || signal.renderer || signal.pattern
    if (type === 'renderer') return rendererSignal(source, value)
    if (type === 'regex') {
      try { return new RegExp(String(value), 'i').test(source) } catch { return false }
    }
    return sourceToken(source, value)
  }
  const [prefix, ...rest] = String(signal).split(':')
  const value = rest.join(':')
  if (value && prefix === 'renderer') return rendererSignal(source, value)
  if (value && prefix === 'regex') {
    try { return new RegExp(value, 'i').test(source) } catch { return false }
  }
  if (value && ['token', 'state', 'draw'].includes(prefix)) return sourceToken(source, value)
  return sourceToken(source, signal)
}

function semanticSignalPresent(source, id, kind, baseSignals) {
  const key = compactId(id)
  if (!key) return false
  if (kind === 'depth') {
    if (/far|mid|near|layer/.test(key)) return baseSignals.depthRenderers
    if (/perspective|scale|horizon|원근/.test(key)) return baseSignals.perspective
    if (/light|gradient|vignette|조명/.test(key)) return baseSignals.lighting
    if (/shadow|contact|ground|그림자/.test(key)) return baseSignals.groundShadow
    if (/parallax|패럴랙스/.test(key)) return /parallax|scroll(?:X|Y)|camera(?:X|Y)/i.test(source)
    if (/sort|overlap|occlusion|y-depth|y-sort/.test(key)) return /\.sort\s*\([^)]*(?:\.y|\by\b)|ySort|sortByY/i.test(source)
  }
  if (kind === 'feedback') {
    if (/input|acknowledg|press|입력/.test(key)) return /lastInput|inputFlash|pressed|keyPulse|acknowledge|feedbackTimer/i.test(source) ||
      (/key(?:down|up)|addEventListener\s*\(\s*['"]key/i.test(source) && /flash|pulse|timer|feedback/i.test(source))
    if (/anticipation|windup|예고/.test(key)) return /anticipation|windup|charge|prepare|telegraph|tween|stateTimer|feedbackTimer/i.test(source)
    if (/settle|settled|resolve|정착/.test(key)) return /settle|resolve|cooldown|feedbackTimer|stateTimer/i.test(source)
    if (/semantic|event|emit/.test(key)) return /api\.emit\s*\(/i.test(source)
    if (/select|focus|cursor|선택/.test(key)) return /selected|selection|cursor|focus|activeIndex/i.test(source)
    if (/hit|damage|impact|피격/.test(key)) return /hit|damage|impact|hurt|flash|shake/i.test(source)
    if (/collect|reward|score|획득/.test(key)) return /collect|reward|score|popup|particle/i.test(source)
    if (/transition|enter|exit|전환/.test(key)) return /transition|fade|wipe|screenFlash|sceneTime/i.test(source)
    if (/game-over|result|fail|success|결과/.test(key)) return /gameOver|drawResult|drawGameOver|victory/i.test(source)
    if (/shake|flash|particle|pulse|hitstop/.test(key)) return sourceToken(source, key)
  }
  if (kind === 'pattern') {
    if (/depth|perspective|layer|stage/.test(key)) return baseSignals.depthRenderers && baseSignals.perspective && baseSignals.groundShadow
    if (/state-feedback|game-feel|reaction/.test(key)) return /feedback|flash|shake|particle|reaction|impact|timer/i.test(source)
    if (/safe-hud|information|hierarchy|panel/.test(key)) return baseSignals.panelHierarchy
    if (/adaptive|viewport|responsive|safe-area/.test(key)) return /viewport|canvas\.(?:width|height)|\b(?:W|H|width|height)\b/i.test(source)
    if (/command|menu|choice|action/.test(key)) return /selected|cursor|choice|command/i.test(source) && baseSignals.panelHierarchy
    if (/card|grid|party|inventory|collection|loadout/.test(key)) return /card|grid|party|inventory|collection|loadout/i.test(source) && baseSignals.panelHierarchy
    if (/hud|status|health|gauge|meter/.test(key)) return /hud|status|health|\bhp\b|gauge|meter/i.test(source) && /fillRect|strokeRect|roundRect/i.test(source)
    if (/dialog|message|caption|prompt/.test(key)) return /dialog|message|caption|prompt/i.test(source) && /fillText/i.test(source)
    if (/map|radar|minimap/.test(key)) return /drawMap|miniMap|radar|mapState/i.test(source)
    if (/hazard|telegraph|obstacle/.test(key)) return /hazard|telegraph|obstacle|danger/i.test(source)
    if (/onboarding|instruction|tutorial/.test(key)) return /instruction|tutorial|drawHelp|hint|objective/i.test(source)
    if (/judgment|timing|rhythm|grade/.test(key)) return /judgment|receptor|perfect|good|miss|timing/i.test(source)
    if (/trajectory|ball|paddle/.test(key)) return /trajectory|ball|paddle|trail/i.test(source)
    if (/target-damage|durability|brick/.test(key)) return /target|brick|damage|crack|hit/i.test(source)
    if (/score|milestone|progression/.test(key)) return /score|milestone|scorePop|banner/i.test(source)
  }
  if (kind === 'state') {
    if (/^title-/.test(key)) return rendererSignal(source, 'drawTitle')
    if (/^gameplay-active/.test(key)) return ['drawGameplay', 'drawBattle', 'drawPlayfield', 'drawWorld'].some(name => rendererSignal(source, name))
    if (/^gameplay-feedback/.test(key)) return /feedback|flash|shake|particle|impact|reaction|timer/i.test(source)
    if (/^result-/.test(key)) return ['drawResult', 'drawGameOver', 'drawSummary', 'drawVictory'].some(name => rendererSignal(source, name))
    if (/^party-/.test(key)) return rendererSignal(source, 'drawParty') && (!/selected/.test(key) || /selected|activeIndex|partyIndex/i.test(source))
    if (/^codex-/.test(key)) return rendererSignal(source, 'drawCodex') && (!/(unknown|owned)/.test(key) || /unknown|owned|locked|discovered/i.test(source))
    const stateToken = key.split('-').filter(part => part.length > 2).at(-1)
    const occurrences = stateToken ? (source.match(new RegExp(`\\b${escapeRegExp(stateToken)}\\b`, 'gi')) || []).length : 0
    return occurrences > 1 && /\b(?:state|mode|phase)\b\s*(?:=|:|\[)/i.test(source)
  }
  // 계약 ID는 meta trace에도 들어가므로, 알려지지 않은 ID 자체의 문자열 일치는
  // 구현 증거가 아니다. 명시 codeSignals나 화면 renderer가 있어야 통과한다.
  return false
}

function referenceContractCheck(source, meta, contract, baseSignals) {
  if (!contract) return { ok: true, issues: [], summary: null }
  const trace = meta?.reference || meta?.designContract || meta?.visual?.reference || {}
  const declaredScreens = unique([
    ...array(meta?.visual?.screens).map(compactId),
    ...array(trace.screens || trace.implementedScreens).map(itemId)
  ])
  const declaredPatterns = unique(array(trace.implementedPatterns || trace.patterns || trace.appliedPatterns).map(itemId))
  const declaredStates = unique(array(trace.implementedStates || trace.states).map(itemId))
  const declaredDepth = unique(array(trace.depthSignals || trace.implementedDepth).map(itemId))
  const declaredFeedback = unique(array(trace.feedbackSignals || trace.implementedFeedback).map(itemId))
  const issues = []
  const add = (code, category, item, expected, actual, hint) => issues.push({ code, category, item, expected, actual, hint })

  if (contract.contractId && String(trace.contractId || trace.id || '') !== contract.contractId) {
    add('REF_TRACE_CONTRACT', 'trace', contract.contractId, contract.contractId, trace.contractId || trace.id || '누락',
      `meta.reference.contractId를 "${contract.contractId}"로 선언하세요.`)
  }
  const tracedTarget = trace.targetId || (typeof trace.target === 'string' ? trace.target : trace.target?.id) || ''
  if (contract.targetId && String(tracedTarget) !== contract.targetId) {
    add('REF_TRACE_TARGET', 'trace', contract.targetId, contract.targetId, tracedTarget || '누락',
      `meta.reference.targetId를 "${contract.targetId}"로 선언하세요.`)
  }

  const visibleTitle = String(meta?.title || '').trim()
  for (const term of contract.forbiddenVisibleTerms) {
    if (visibleTitle && visibleTitle.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
      add('REF_ORIGINALITY_TITLE', 'originality', term, '레퍼런스 고유명 없는 독자적 게임 제목', visibleTitle,
        `meta.title에서 레퍼런스 고유명 "${term}"을 제거하고 게임의 독자적 세계관을 나타내는 제목으로 바꾸세요.`)
    }
  }

  for (const id of contract.requiredScreens) {
    if (!declaredScreens.includes(id)) {
      add('REF_SCREEN_META', 'screen', id, 'meta.visual.screens 선언', '누락', `meta.visual.screens에 "${id}"를 추가하세요.`)
    }
    const pascal = id.split('-').filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join('')
    const renderer = rendererSignal(source, `draw${pascal}`) || rendererSignal(source, 'drawOverlayScreen') ||
      (id === 'gameplay' && ['drawBattle', 'drawPlayfield', 'drawWorld'].some(name => rendererSignal(source, name))) ||
      (id === 'result' && ['drawGameOver', 'drawVictory', 'drawSummary'].some(name => rendererSignal(source, name)))
    if (!renderer) {
      add('REF_SCREEN_RENDERER', 'screen', id, `draw${pascal} renderer`, '코드 신호 없음',
        `"${id}" 화면을 실제로 그리는 draw${pascal} 함수를 구현하세요.`)
    }
  }

  const checkItems = (items, ids, declared, kind, code, label) => items.forEach((item, index) => {
    const id = ids[index]
    if (!id) return
    if (!declared.includes(id)) {
      add(`${code}_TRACE`, kind, id, 'meta.reference 구현 목록', '누락',
        `meta.reference.${label}에 "${id}"를 추가하고 실제 구현과 일치시키세요.`)
    }
    const signals = typeof item === 'object' ? signalList(item) : []
    let implemented = signals.length
      ? signals.some(signal => customSignalPresent(source, signal))
      : semanticSignalPresent(source, id, kind, baseSignals)
    if (!implemented && kind === 'pattern') {
      const tracedScreen = array(item?.targetScreens || item?.screens).map(itemId)[0] ||
        itemId(contract.traceability.find(traceItem => itemId(traceItem?.contractId || traceItem?.patternId) === id)?.targetScreen)
      if (tracedScreen) {
        const pascal = tracedScreen.split('-').filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join('')
        implemented = (rendererSignal(source, `draw${pascal}`) || rendererSignal(source, 'drawOverlayScreen')) && baseSignals.panelHierarchy
      }
    }
    if (!implemented) {
      add(`${code}_SIGNAL`, kind, id, signals.length ? signals.join(' 또는 ') : `${id} 코드 신호`, '코드 신호 없음',
        `"${id}" ${kind} 계약을 renderer/state/feedback 코드로 구현하세요${signals.length ? ` (${signals.join(', ')})` : ''}.`)
    }
  })

  checkItems(contract.patterns, contract.requiredPatternIds, declaredPatterns, 'pattern', 'REF_PATTERN', 'implementedPatterns')
  checkItems(contract.states, contract.requiredStateIds, declaredStates, 'state', 'REF_STATE', 'implementedStates')
  checkItems(contract.depth, contract.requiredDepthIds, declaredDepth, 'depth', 'REF_DEPTH', 'depthSignals')
  checkItems(contract.feedback, contract.requiredFeedbackIds, declaredFeedback, 'feedback', 'REF_FEEDBACK', 'feedbackSignals')

  const checks = Number(!!contract.contractId) + Number(!!contract.targetId) + contract.forbiddenVisibleTerms.length + contract.requiredScreens.length * 2 + contract.requiredPatternIds.length * 2 +
    contract.requiredStateIds.length * 2 + contract.requiredDepthIds.length * 2 + contract.requiredFeedbackIds.length * 2
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      contractId: contract.contractId || null,
      targetId: contract.targetId || null,
      checks,
      passed: Math.max(0, checks - issues.length),
      traceable: !issues.some(issue => issue.category === 'trace' || issue.code.endsWith('_TRACE') || issue.code.endsWith('_META')),
      implementationVerified: !issues.some(issue => issue.code.endsWith('_SIGNAL') || issue.code === 'REF_SCREEN_RENDERER'),
      originalityVerified: !issues.some(issue => issue.category === 'originality')
    }
  }
}

const signatureDistance = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 3 || left.length !== right.length) return 0
  let delta = 0
  for (let i = 0; i < left.length; i++) delta += Math.abs(Number(left[i]) - Number(right[i]))
  return delta / (left.length * 15)
}

// 코드의 renderer 이름이나 meta 선언이 아니라 iframe에서 실제 관찰한 결과를
// 검사한다. 하네스는 fillText 경계와 화면 전환 직후의 저해상도 프레임 서명을
// 수집할 뿐이라 이미지 모델/스크린샷 업로드 없이도 P0 회귀를 빠르게 잡는다.
export function runtimeVisualQualityCheck(quality, { requiredScreens = [], terminalExpected = false } = {}) {
  const issues = []
  const add = (code, category, item, expected, actual, hint) => issues.push({ code, category, item, expected, actual, hint })
  if (!quality || typeof quality !== 'object') {
    add('VIS_RUNTIME_TELEMETRY', 'runtime', 'qualitycheck', '실제 Canvas 품질 텔레메트리', '누락',
      '하네스의 runtime qualitycheck가 완료될 때까지 테스트하고 api.emit("screen", { id }) 계측을 유지하세요.')
    return { ok: false, issues, summary: { checks: 1, passed: 0, textVerified: false, reachabilityVerified: false, distinctionVerified: false } }
  }

  const text = quality.text || {}
  const clipped = array(text.clipped)
  const unsafe = array(text.unsafe)
  const squashed = array(text.squashed)
  if (!(Number(text.samples) > 0)) {
    add('VIS_TEXT_UNOBSERVED', 'text', 'fillText', '실제 텍스트 렌더 1개 이상', '0개',
      '핵심 제목·HUD·조작 도움말을 Canvas에 실제로 렌더하세요.')
  }
  if (clipped.length) {
    const sample = clipped[0]
    add('VIS_TEXT_CLIPPED', 'text', sample.text || 'text', 'Canvas 경계 안', `${sample.left},${sample.top}–${sample.right},${sample.bottom}`,
      'measureText 기반 fit/wrap/ellipsis 또는 fillText maxWidth를 사용해 텍스트가 Canvas 밖으로 잘리지 않게 하세요.')
  }
  if (unsafe.length) {
    const sample = unsafe[0]
    add('VIS_TEXT_SAFE_AREA', 'text', sample.text || 'text', '12px safe area 안', `${sample.left},${sample.top}–${sample.right},${sample.bottom}`,
      '핵심 텍스트의 실제 바운드를 viewport 각 가장자리에서 12px 이상 띄우세요.')
  }
  if (squashed.length) {
    const sample = squashed[0]
    add('VIS_TEXT_SQUASHED', 'text', sample.text || 'text', '원래 폭의 68% 이상 또는 wrap/ellipsis', `${sample.naturalWidth || '?'}px → ${sample.width || '?'}px`,
      '긴 문자열을 fillText maxWidth로 과도하게 눌러 쓰지 말고, 2줄 wrap·최소 폰트 크기·grapheme-safe ellipsis 순으로 맞추세요.')
  }

  const samples = array(quality.screens?.samples).filter(sample => itemId(sample?.id) && Array.isArray(sample?.signature))
  const expected = unique(requiredScreens.map(compactId)).filter(id => id && (terminalExpected || id !== 'result'))
  const byId = new Map(expected.map(id => [id, samples.filter(sample => itemId(sample.id) === id)]))
  for (const id of expected) {
    if (!byId.get(id)?.length) {
      add('VIS_SCREEN_UNREACHABLE', 'screen', id, 'QA 입력으로 실제 도달 + screen 이벤트', '관찰되지 않음',
        `실제 "${id}" 상태로 전환한 뒤 해당 프레임을 그리고 api.emit('screen', { id: '${id}' })을 1회 보내세요.`)
    }
  }

  const titleSamples = byId.get('title') || []
  if (titleSamples.length) {
    for (const id of expected.filter(value => value !== 'title')) {
      const targetSamples = byId.get(id) || []
      if (!targetSamples.length) continue
      const distances = targetSamples.flatMap(target => titleSamples.map(title => signatureDistance(target.signature, title.signature)))
      const closestSeparation = distances.length ? Math.min(...distances) : 0
      if (closestSeparation < 0.04) {
        add('VIS_SCREEN_NOT_DISTINCT', 'screen', id, 'title과 구분되는 실제 프레임', `차이 ${closestSeparation.toFixed(3)}`,
          `"${id}" 화면의 패널 배치·정보 위계·플레이필드를 title과 시각적으로 구분하세요.`)
      }
    }
  }

  const checks = 4 + expected.length + Math.max(0, expected.length - 1)
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      checks,
      passed: Math.max(0, checks - issues.length),
      textVerified: !issues.some(issue => issue.category === 'text'),
      reachabilityVerified: !issues.some(issue => issue.code === 'VIS_SCREEN_UNREACHABLE'),
      distinctionVerified: !issues.some(issue => issue.code === 'VIS_SCREEN_NOT_DISTINCT'),
      visitedScreens: unique(samples.map(sample => itemId(sample.id)))
    }
  }
}

// 생성 결과가 스스로 "예쁘다"고 선언하는 것만으로는 부족하다. 런타임 meta와
// 코드 구조를 함께 보고, 렌더 구현을 과도하게 해석하지 않는 작은 계약 검사다.
// 기존 seed 게임은 runSmokeTest의 strictVisual=false 기본값으로 그대로 호환된다.
export function visualQualityCheck(code, meta = null, draw = null, { requiredScreens = [], referenceContract = null, designContract = null, requireRuntimeQuality = false, terminalExpected = false } = {}) {
  const source = String(code || '')
  const contract = normalizeReferenceContract(referenceContract || designContract)
  const visual = meta?.visual
  const viewport = meta?.viewport
  const layers = new Set(Array.isArray(visual?.depthLayers) ? visual.depthLayers.map(String) : [])
  const screens = new Set(Array.isArray(visual?.screens) ? visual.screens.map(String) : [])
  const required = [...new Set([...REQUIRED_VISUAL_SCREENS, ...requiredScreens.map(String), ...(contract?.requiredScreens || [])])]
  const declaredAux = [...screens].filter(screen => !REQUIRED_VISUAL_SCREENS.includes(screen))
  const runtimeRequiredScreens = unique([...required.map(compactId), ...declaredAux.map(compactId)])
  const namedRenderer = screen => {
    const pascal = screen.split(/[^a-z0-9]+/i).filter(Boolean)
      .map(part => part[0].toUpperCase() + part.slice(1)).join('')
    return pascal && rendererSignal(source, `draw${pascal}`)
  }
  const screenRenderer = screen => {
    if (namedRenderer(screen)) return true
    if (screen === 'gameplay') return ['drawBattle', 'drawPlayfield', 'drawWorld'].some(name => rendererSignal(source, name))
    if (screen === 'result') return ['drawGameOver', 'drawVictory', 'drawSummary'].some(name => rendererSignal(source, name))
    return false
  }
  const coreRenderers = REQUIRED_VISUAL_SCREENS.every(screenRenderer)
  const auxiliaryRenderer = declaredAux.some(namedRenderer) || rendererSignal(source, 'drawOverlayScreen')
  const requiredRenderers = required.every(screen => REQUIRED_VISUAL_SCREENS.includes(screen)
    ? screenRenderer(screen)
    : (namedRenderer(screen) || rendererSignal(source, 'drawOverlayScreen')))
  const screenRenderers = coreRenderers && auxiliaryRenderer && requiredRenderers
  const perspective = /\b(?:depthScale|scaleByY|horizonY?|perspectiveScale)\b|ctx\.(?:scale|transform)\s*\(/i.test(source)
  const lighting = /create(?:Linear|Radial)Gradient\s*\(|\b(?:drawLighting|lightOverlay|vignette)\b|ctx\.shadowBlur\s*=/i.test(source)
  const groundShadow = /ctx\.ellipse\s*\(|\b(?:drawShadow|groundShadow)\b/i.test(source)
  const splitDepthRenderers = REQUIRED_DEPTH_LAYERS.every(layer => rendererSignal(source, `draw${layer[0].toUpperCase()}${layer.slice(1)}Layer`))
  const composedWorldRenderer = rendererSignal(source, 'drawWorld') && perspective && lighting && groundShadow
  const depthRenderers = splitDepthRenderers || composedWorldRenderer
  const panelHierarchy = /\b(?:drawPanel|panel)\s*\(|ctx\.(?:strokeRect|roundRect)\s*\(/i.test(source) && /ctx\.fillText\s*\(/i.test(source)
  const drawOps = ['fillRect', 'fillText', 'beginPath', 'lineTo', 'ellipse', 'arc', 'strokeRect', 'createLinearGradient', 'createRadialGradient']
    .filter(op => new RegExp(`ctx\\.${op}\\s*\\(`).test(source))

  const missing = []
  const viewportKey = `${viewport?.w}x${viewport?.h}`
  const expectedAspect = VIEWPORT_ASPECTS.get(viewportKey)
  if (!expectedAspect) missing.push('meta.viewport는 480×320, 360×480, 400×400 중 하나여야 합니다.')
  else if (visual?.aspect !== expectedAspect) missing.push(`meta.visual.aspect는 viewport와 같은 ${expectedAspect}이어야 합니다.`)
  if (!REQUIRED_DEPTH_LAYERS.every(layer => layers.has(layer))) missing.push('meta.visual.depthLayers에 far/mid/near가 모두 필요합니다.')
  if (visual?.perspective !== true) missing.push('meta.visual.perspective를 true로 선언해야 합니다.')
  if (!required.every(screen => screens.has(screen))) missing.push(`meta.visual.screens에 ${required.join('/')}가 모두 필요합니다.`)
  if (!declaredAux.length) missing.push('장르에 맞는 보조 화면(loadout/collection/help 등)을 1개 이상 선언해야 합니다.')
  if (!depthRenderers) missing.push('far/mid/near 개별 renderer 또는 원근·조명·접지 그림자를 갖춘 drawWorld 합성 renderer가 필요합니다.')
  if (!screenRenderers) missing.push('drawTitle/drawGameplay/drawResult와 선언한 보조 화면 renderer를 구현해야 합니다.')
  if (!perspective) missing.push('horizon과 y 기반 depthScale(또는 동등한 원근 스케일) 구현이 필요합니다.')
  if (!lighting) missing.push('Canvas 그라디언트 또는 명시적인 조명/비네트 렌더가 필요합니다.')
  if (!groundShadow) missing.push('캐릭터·오브젝트의 타원형 접지 그림자가 필요합니다.')
  if (!panelHierarchy) missing.push('stroke/roundRect와 텍스트 위계를 갖춘 공통 패널 UI가 필요합니다.')
  if (drawOps.length < 5) missing.push('평면 사각형을 벗어나려면 최소 5종의 Canvas 드로잉 연산이 필요합니다.')
  if (draw?.colors != null && draw.colors >= 0 && draw.colors < 6) missing.push('실제 렌더의 색상 단계가 너무 적습니다(최소 6개 양자화 색상).')
  if (Array.isArray(draw?.regions) && draw.regions.some(value => value <= 0)) missing.push('실제 렌더가 원경/중경/전경 세로 구간을 모두 채우지 못했습니다.')

  const reference = referenceContractCheck(source, meta, contract, {
    depthRenderers, perspective, lighting, groundShadow, panelHierarchy
  })
  const runtime = requireRuntimeQuality
    ? runtimeVisualQualityCheck(draw?.quality, { requiredScreens: runtimeRequiredScreens, terminalExpected })
    : { ok: true, issues: [], summary: null }
  const issues = [...reference.issues, ...runtime.issues]
  issues.forEach(issue => missing.push(`[${issue.code}] ${issue.hint}`))
  if (reference.summary && runtime.summary) {
    reference.summary = {
      ...reference.summary,
      checks: reference.summary.checks + runtime.summary.checks,
      passed: reference.summary.passed + runtime.summary.passed,
      runtimeVerified: runtime.ok,
      runtime: runtime.summary
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    issues,
    signals: { depthRenderers, splitDepthRenderers, composedWorldRenderer, screenRenderers, coreRenderers, auxiliaryRenderer, perspective, lighting, groundShadow, panelHierarchy, drawOps },
    runtime: draw ? { colors: draw.colors ?? null, regions: draw.regions || null, quality: runtime.summary } : null,
    reference: reference.summary
  }
}

export function syntaxCheck(code) {
  try { new Function(code); return { ok: true } }
  catch (e) { return { ok: false, error: String(e.message || e) } }
}

// mountEl이 주어지면 그 안에 라이브 프리뷰로 표시 (rAF 스로틀 방지 겸 관전 요소)
export function runSmokeTest(code, { mountEl, durationMs = 9000, seed = 12345, bot, strictVisual = false, requiredScreens = [], referenceContract = null, designContract = null } = {}) {
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
    const d = {
      ready: false, fatal: null, errors: [], score: 0, scoreChanged: false,
      overFired: false, lit: null, presses: 0, ms: 0,
      visual: strictVisual ? visualQualityCheck(code, null, null, { requiredScreens, referenceContract, designContract, requireRuntimeQuality: true }) : null
    }
    const game = mountGame(host, code, { mode: 'bot', seed, quality: strictVisual, bot: bot || { aggression: 0.65, intervalMs: 130, holdMs: 150, durationMs: durationMs - 1200 } })
    const finish = () => {
      clearTimeout(killT)
      if (strictVisual) d.visual = visualQualityCheck(code, d.meta, d.draw, {
        requiredScreens, referenceContract, designContract, requireRuntimeQuality: true, terminalExpected: d.overFired
      })
      game.dispose()
      if (temp) host.remove()
      const pass = d.ready && !d.fatal && d.errors.length === 0 &&
        (d.lit === null || d.lit >= 15) && (d.scoreChanged || d.overFired) &&
        (!strictVisual || d.visual?.ok)
      resolve({ pass, diagnostics: d })
    }
    const killT = setTimeout(finish, durationMs + 2500)
    game.on(m => {
      if (m.type === 'ready') {
        d.ready = true
        d.meta = m.meta || null
        if (strictVisual) d.visual = visualQualityCheck(code, m.meta, d.draw, { requiredScreens, referenceContract, designContract, requireRuntimeQuality: true })
      }
      if (m.type === 'fatal') { d.fatal = m.message; setTimeout(finish, 50) }
      if (m.type === 'error') d.errors.push(m.message + (m.line ? ` (line ${m.line})` : ''))
      if (m.type === 'score') { if (m.score !== d.score) d.scoreChanged = true; d.score = m.score }
      if (m.type === 'drawcheck') {
        d.lit = m.lit
        d.draw = { ...(d.draw || {}), colors: m.colors, regions: m.regions }
        if (strictVisual) d.visual = visualQualityCheck(code, m.meta || d.meta, d.draw, { requiredScreens, referenceContract, designContract, requireRuntimeQuality: true })
      }
      if (m.type === 'qualitycheck') {
        d.draw = { ...(d.draw || {}), quality: m.quality || null }
        if (strictVisual) d.visual = visualQualityCheck(code, d.meta, d.draw, { requiredScreens, referenceContract, designContract, requireRuntimeQuality: true })
      }
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
