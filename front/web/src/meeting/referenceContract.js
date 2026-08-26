// Reference research is allowed to evolve independently on the server. This module
// turns both the canonical designContract and older blueprint-shaped payloads into
// one bounded, prompt-safe contract used by every production phase.

const CORE_SCREENS = ['title', 'gameplay', 'result']
const VIEWPORTS = {
  '3:2': { w: 480, h: 320, aspect: '3:2' },
  '3:4': { w: 360, h: 480, aspect: '3:4' },
  '1:1': { w: 400, h: 400, aspect: '1:1' }
}

const clean = (value, max = 360) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const list = value => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value])
const unique = values => [...new Set(values.filter(Boolean))]
const SUPPORTED_SCHEMA_MAJOR = 1

function slug(value, fallback = '') {
  const result = clean(value, 100)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48)
  return result || fallback
}

function fold(value) {
  return clean(value, 140).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function stableHash(value) {
  let hash = 2166136261
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function schemaMajor(value) {
  const text = clean(value, 30).toLowerCase()
  if (!text) return null
  const match = text.match(/(?:^|\/|-)v?(\d+)$/) || text.match(/^(\d+)(?:\.|$)/)
  return match ? Number(match[1]) : null
}

function normalizeViewport(raw = {}) {
  const width = Number(raw.w ?? raw.width)
  const height = Number(raw.h ?? raw.height)
  const stated = clean(raw.aspect ?? raw.ratio, 12)
  let aspect = VIEWPORTS[stated] ? stated : ''
  if (!aspect && width > 0 && height > 0) {
    const ratio = width / height
    aspect = Math.abs(ratio - 1.5) < .08 ? '3:2' : Math.abs(ratio - .75) < .08 ? '3:4' : '1:1'
  }
  const canonical = VIEWPORTS[aspect || '3:2']
  return { ...canonical }
}

function inferScreenIds(values) {
  const text = values.map(value => clean(value, 200).toLowerCase()).join(' ')
  const rules = [
    ['party', /party|파티|편성|unit\s*grid/],
    ['codex', /codex|pok[eé]dex|도감|collection\s*grid/],
    ['inventory', /inventory|인벤토리|아이템|가방/],
    ['map', /world\s*map|미니맵|지도/],
    ['loadout', /loadout|장비|덱\s*편성/],
    ['help', /tutorial|instruction|도움말|조작\s*안내/]
  ]
  return rules.filter(([, re]) => re.test(text)).map(([id]) => id)
}

function normalizeScreen(raw, index) {
  const item = typeof raw === 'string' ? { id: raw, label: raw } : (raw || {})
  const label = clean(item.label ?? item.title ?? item.name ?? item.id ?? item.key ?? item.type, 100)
  const id = slug(item.id ?? item.key ?? item.name ?? item.type ?? label, `screen-${index + 1}`)
  return {
    id,
    label: label || id,
    role: clean(item.role ?? item.purpose ?? item.informationRole, 240),
    entry: clean(list(item.entry ?? item.enter ?? item.entryAction).join(' → '), 180),
    exit: clean(list(item.exit ?? item.leave ?? item.exitAction).join(' → '), 180),
    required: item.required !== false && (!item.priority || item.priority === 'required'),
    verify: clean(list(item.verify ?? item.verification ?? item.acceptance).join('; '), 260),
    layout: clean(item.layout ?? item.composition, 300),
    primaryAction: clean(item.primaryAction ?? item.action, 180),
    feedback: clean(item.feedback, 260),
    patternIds: unique(list(item.patternIds ?? item.patterns).map(value => slug(value))).slice(0, 8)
  }
}

function normalizePattern(raw, index) {
  const item = typeof raw === 'string' ? { sourcePattern: raw, adaptation: raw } : (raw || {})
  const sourcePattern = clean(item.sourcePattern ?? item.requirement ?? item.pattern ?? item.label ?? item.name ?? item.id, 180)
  const adaptation = clean(item.adaptation ?? item.apply ?? item.translation ?? item.targetPattern ?? item.implementationCue ?? item.implementationHint, 280)
  const id = slug(item.id ?? item.key ?? sourcePattern, `pattern-${index + 1}`)
  return {
    id,
    category: clean(item.category ?? item.type, 100),
    requirement: clean(item.requirement ?? sourcePattern, 280),
    sourcePattern: sourcePattern || id,
    adaptation: adaptation || sourcePattern || id,
    targetScreens: unique(list(item.targetScreens ?? item.screens ?? item.screen).map(value => slug(value))).slice(0, 6),
    implementationCue: clean(item.implementationCue ?? item.implementationHint ?? item.implementation ?? item.renderer ?? item.component, 240),
    verify: clean(list(item.verify ?? item.verification ?? item.acceptance ?? item.qa).join('; '), 280),
    required: item.required !== false && item.priority !== 'optional'
  }
}

function normalizeTrace(raw, index) {
  const item = raw || {}
  const contractId = slug(item.contractId ?? item.patternId ?? item.id ?? item.pattern, `trace-${index + 1}`)
  return {
    contractId,
    sourcePattern: clean(item.sourcePattern ?? item.pattern ?? item.source, 180),
    targetScreen: slug(item.targetScreen ?? item.screen),
    implementation: clean(item.implementation ?? item.implementationCue ?? item.renderer ?? item.component, 240),
    verification: clean(item.verification ?? item.verify ?? item.acceptance ?? item.qa, 280)
  }
}

function normalizeControls(raw) {
  const allowed = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Escape'])
  const controls = []
  for (const value of list(raw)) {
    const text = clean(value, 160)
    if (allowed.has(text)) controls.push(text)
    if (/arrow\s*keys?|방향키|wasd|a\s*[,/]\s*d/i.test(text)) controls.push('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown')
    if (/space|스페이스/i.test(text)) controls.push('Space')
  }
  return unique(controls)
}

function normalizeQaSignal(raw, index, prefix) {
  // Free-form server prose names a semantic requirement; it is not a literal code
  // token. Only structured payloads may opt into exact machine-readable signals.
  const item = typeof raw === 'string' ? { label: raw, codeSignals: [] } : (raw || {})
  const label = clean(item.label ?? item.name ?? item.signal ?? item.id, 180)
  return {
    id: slug(item.id ?? item.key ?? item.name ?? item.signal ?? label, `${prefix}-${index + 1}`),
    label: label || `${prefix}-${index + 1}`,
    codeSignals: list(item.codeSignals ?? item.signals ?? item.code ?? item.tokens)
      .map(value => clean(value, 220)).filter(Boolean).slice(0, 10),
    verify: clean(item.verify ?? item.verification ?? item.acceptance, 260)
  }
}

function promptSafe(value, depth = 0) {
  if (depth > 4 || value == null) return undefined
  if (typeof value === 'string') return clean(value, 500)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 16).map(item => promptSafe(item, depth + 1)).filter(item => item !== undefined)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 24)
      .map(([key, item]) => [clean(key, 60), promptSafe(item, depth + 1)])
      .filter(([, item]) => item !== undefined))
  }
  return undefined
}

/**
 * Normalize a structured server result. A legacy referenceContext string still
 * flows through prompts unchanged and intentionally returns null here.
 */
export function normalizeReferenceDesignContract(reference) {
  if (!reference || typeof reference === 'string') return null
  const source = reference.designContract || reference.blueprint || null
  if (!source && !reference.selected) return null

  const selected = reference.selected || {}
  const targetId = slug(source?.targetId ?? source?.target?.id ?? (typeof source?.target === 'string' ? source.target : undefined) ?? selected.id, 'reference-target')
  const targetTitle = clean(source?.targetTitle ?? source?.target?.title ?? (typeof source?.target === 'string' ? source.target : undefined) ?? selected.title, 140) || targetId
  const qaSource = source?.qa || {}
  const explicitPatterns = list(source?.patterns ?? source?.uiPatterns ?? source?.adaptations)
  const fallbackPatterns = list(selected.uiFocus).map(pattern => ({
    sourcePattern: pattern,
    adaptation: `이번 게임의 정보 구조와 입력 흐름에 맞게 ${clean(pattern, 140)} 패턴을 독자적으로 재설계`
  }))
  const qaPatternIds = unique(list(qaSource.requiredPatternIds).map(value => slug(value)))
  const normalizedPatterns = (explicitPatterns.length ? explicitPatterns : fallbackPatterns)
    .slice(0, 24).map(normalizePattern)
  const patterns = [
    ...normalizedPatterns.filter(pattern => qaPatternIds.includes(pattern.id) || pattern.required),
    ...normalizedPatterns.filter(pattern => !qaPatternIds.includes(pattern.id) && !pattern.required)
  ].slice(0, 16)
  for (const id of qaPatternIds) {
    if (patterns.some(pattern => pattern.id === id)) continue
    if (patterns.length >= 16) patterns.pop()
    patterns.push(normalizePattern({ id, sourcePattern: id, adaptation: `계약의 ${id} 패턴을 독자적으로 구현`, required: true }, patterns.length))
  }

  const inferredScreens = inferScreenIds([
    ...patterns.flatMap(pattern => [pattern.sourcePattern, pattern.adaptation]),
    ...list(selected.uiFocus)
  ])
  const explicitScreens = list(source?.screens ?? source?.screenPlan ?? source?.requiredScreens)
  const qaScreens = list(qaSource.requiredScreens)
  const screenInputs = explicitScreens.length
    ? [...explicitScreens, ...qaScreens]
    : [...CORE_SCREENS, ...qaScreens, ...inferredScreens]
  const screens = []
  const seenScreens = new Set()
  for (const screen of [...screenInputs.slice(0, 13), ...CORE_SCREENS].map(normalizeScreen)) {
    if (!seenScreens.has(screen.id)) {
      seenScreens.add(screen.id)
      screens.push(screen)
    }
  }
  for (const pattern of patterns) {
    if (!pattern.targetScreens.length) {
      pattern.targetScreens = screens.filter(screen => screen.patternIds.includes(pattern.id)).map(screen => screen.id).slice(0, 6)
    }
  }

  let traceability = list(source?.traceability ?? source?.trace ?? source?.implementationTrace)
    .slice(0, 16).map(normalizeTrace)
  if (!traceability.length) {
    traceability = patterns.map(pattern => ({
      contractId: pattern.id,
      sourcePattern: pattern.sourcePattern,
      targetScreen: pattern.targetScreens[0] || screens.find(screen => !CORE_SCREENS.includes(screen.id))?.id || 'gameplay',
      implementation: pattern.implementationCue || `renderer/helper에서 ${pattern.adaptation}`,
      verification: pattern.verify || 'meta.reference 구현 ID 선언 + 해당 화면 키보드 도달 확인'
    }))
  }
  for (const pattern of patterns.filter(item => item.required)) {
    if (traceability.some(trace => trace.contractId === pattern.id)) continue
    traceability.push({
      contractId: pattern.id,
      sourcePattern: pattern.sourcePattern,
      targetScreen: pattern.targetScreens[0] || 'gameplay',
      implementation: pattern.implementationCue || `renderer/helper에서 ${pattern.adaptation}`,
      verification: pattern.verify || 'meta.reference 구현 ID 선언 + 해당 화면 키보드 도달 확인'
    })
  }

  const requiredScreens = unique([
    ...qaScreens.map(value => slug(value)),
    ...screens.filter(screen => screen.required).map(screen => screen.id)
  ]).filter(Boolean)
  const requiredPatternIds = unique([
    ...list(qaSource.requiredPatternIds).map(value => slug(value)),
    ...patterns.filter(pattern => pattern.required).map(pattern => pattern.id)
  ]).filter(Boolean)
  const requiredStates = unique([
    ...list(source?.requiredStates ?? source?.states).map(value => slug(value)),
    ...list(qaSource.requiredStates).map(value => slug(value))
  ]).filter(Boolean).slice(0, 12)
  const originalitySource = promptSafe(source?.originality || {})
  const originality = originalitySource && typeof originalitySource === 'object' && !Array.isArray(originalitySource)
    ? originalitySource : {}
  originality.forbiddenVisibleTerms = unique([
    ...list(source?.originality?.forbiddenVisibleTerms ?? source?.forbiddenVisibleTerms),
    ...list(qaSource.forbiddenVisibleTerms)
  ].map(value => clean(value, 100)).filter(value => fold(value).length >= 3)).slice(0, 12)
  originality.forbiddenVisibleTermKeys = unique([
    ...list(source?.originality?.forbiddenVisibleTermKeys).map(fold),
    ...originality.forbiddenVisibleTerms.map(fold)
  ]).filter(Boolean).slice(0, 12)
  originality.visibleTextRule = 'forbiddenVisibleTerms는 meta.title·화면 제목·사용자 노출 문구에 쓰지 않고 독자적 명칭으로 바꾼다. targetId/meta.reference 같은 비노출 추적 필드만 예외다.'
  const schemaVersion = clean(source?.schemaVersion, 30) || '1'
  const sourceQuality = promptSafe(source?.quality || {})
  const quality = sourceQuality && typeof sourceQuality === 'object' && !Array.isArray(sourceQuality)
    ? sourceQuality : {}
  const major = schemaMajor(schemaVersion)
  const schemaWarnings = major != null && major !== SUPPORTED_SCHEMA_MAJOR
    ? [`unsupported-reference-schema-major:${major}; normalized-compatible-subset-only`]
    : []
  quality.warnings = unique([...list(quality.warnings).map(value => clean(value, 180)), ...schemaWarnings])
  const seed = JSON.stringify({
    schemaVersion, targetId, targetTitle,
    viewport: normalizeViewport(source?.viewport || source?.layout?.viewport || {}),
    screens: screens.map(({ id, role, entry, exit, required, verify, layout, primaryAction, feedback, patternIds }) =>
      ({ id, role, entry, exit, required, verify, layout, primaryAction, feedback, patternIds })),
    patterns: patterns.map(({ id, category, requirement, sourcePattern, adaptation, targetScreens, implementationCue, verify, required }) =>
      ({ id, category, requirement, sourcePattern, adaptation, targetScreens, implementationCue, verify, required })),
    requiredStates,
    layout: promptSafe(source?.layout || {}), visual: promptSafe(source?.visual || {}),
    interaction: promptSafe(source?.interaction || {}), implementation: promptSafe(source?.implementation || {}),
    originality, requiredScreens, requiredPatternIds
  })
  const contractId = clean(source?.contractId ?? source?.id, 100) || `ref-${targetId}-${stableHash(seed)}`

  return {
    schemaVersion,
    schemaCompatibility: schemaWarnings.length ? 'forward-compatible-subset' : 'supported',
    version: clean(source?.version, 30) || '1.0',
    contractId,
    targetId,
    targetTitle,
    viewport: normalizeViewport(source?.viewport || source?.layout?.viewport || {}),
    coreLoop: promptSafe(source?.coreLoop || {}),
    requiredStates,
    screens,
    patterns,
    layout: promptSafe(source?.layout || {}),
    visual: promptSafe(source?.visual || {}),
    interaction: {
      ...promptSafe(source?.interaction || {}),
      controls: normalizeControls(source?.interaction?.controls ?? source?.controls)
    },
    implementation: promptSafe(source?.implementation || {}),
    originality,
    prohibitedCopying: list(source?.prohibitedCopying).map(value => clean(value, 220)).filter(Boolean).slice(0, 10),
    sourcePolicy: promptSafe(source?.sourcePolicy || {}),
    quality,
    traceability,
    qa: {
      requiredScreens,
      requiredPatternIds,
      requiredStates,
      forbiddenVisibleTerms: originality.forbiddenVisibleTerms,
      depthSignals: list(qaSource.depthSignals).slice(0, 12).map((value, index) => normalizeQaSignal(value, index, 'depth')),
      feedbackSignals: list(qaSource.feedbackSignals).slice(0, 12).map((value, index) => normalizeQaSignal(value, index, 'feedback'))
    }
  }
}

export function visualQaRequiredScreens(contract, { collectionFallback = false } = {}) {
  if (contract) return unique(list(contract.qa?.requiredScreens).map(value => slug(value)).filter(Boolean))
  return collectionFallback ? ['party'] : []
}

export function referenceContractPrompt(contract, { summary = false } = {}) {
  if (!contract) return ''
  const fullContract = {
    schemaVersion: contract.schemaVersion,
    schemaCompatibility: contract.schemaCompatibility,
    version: contract.version,
    contractId: contract.contractId,
    target: { id: contract.targetId, title: contract.targetTitle },
    viewport: contract.viewport,
    coreLoop: contract.coreLoop,
    requiredStates: contract.requiredStates,
    screens: contract.screens,
    patterns: contract.patterns,
    layout: contract.layout,
    visual: contract.visual,
    interaction: contract.interaction,
    implementation: contract.implementation,
    originality: contract.originality,
    prohibitedCopying: contract.prohibitedCopying,
    sourcePolicy: contract.sourcePolicy,
    quality: contract.quality,
    traceability: contract.traceability,
    qa: contract.qa
  }
  const compact = summary ? {
    schemaVersion: contract.schemaVersion,
    schemaCompatibility: contract.schemaCompatibility,
    contractId: contract.contractId,
    target: { id: contract.targetId, title: contract.targetTitle },
    viewport: contract.viewport,
    coreLoop: contract.coreLoop,
    requiredStates: contract.requiredStates,
    screens: contract.screens.map(screen => ({ id: screen.id, role: screen.role, required: screen.required })),
    patterns: contract.patterns.map(pattern => ({
      id: pattern.id, adaptation: pattern.adaptation,
      targetScreens: pattern.targetScreens, required: pattern.required
    })),
    originality: contract.originality,
    quality: contract.quality,
    qa: {
      requiredScreens: contract.qa.requiredScreens,
      requiredPatternIds: contract.qa.requiredPatternIds
    }
  } : fullContract
  return `\n[정규화된 레퍼런스 디자인 계약 — 모든 제작 단계의 단일 기준]\n\`\`\`json\n${JSON.stringify(compact, null, 2)}\n\`\`\`\n- PRD의 각 화면·기능은 screens/patterns의 ID를 그대로 사용해 추적한다.\n- 디자인은 각 pattern ID를 독자적 화면 구성으로 번역하고, 기술 설계는 renderer/state/검증 방법까지 연결한다.\n- 구현은 window.game.meta.reference 또는 meta.designContract에 contractId, target, implementedPatterns, screens, implementedStates, depthSignals, feedbackSignals를 선언한다. 각 배열에는 실제 구현한 계약 ID만 넣는다.\n- 구현 코드의 meta 선언 예: reference: { contractId: '${contract.contractId}', target: '${contract.targetId}', implementedPatterns: ${JSON.stringify(contract.qa.requiredPatternIds)}, screens: ${JSON.stringify(contract.qa.requiredScreens)}, implementedStates: ${JSON.stringify(contract.qa.requiredStates)}, depthSignals: ${JSON.stringify(contract.qa.depthSignals.map(signal => signal.id))}, feedbackSignals: ${JSON.stringify(contract.qa.feedbackSignals.map(signal => signal.id))} }\n- quality.warnings에 low-evidence 경고가 있어도 제작을 중단하지 말고, 계약에 포함된 결정적 장르 baseline을 구현하되 검증되지 않은 세부 주장은 추가하지 않는다.\n- 원본 캐릭터·명칭·아트·팔레트·맵·픽셀은 복제하지 않는다. 패턴의 정보 계층·입력 흐름·피드백 타이밍만 독자적으로 구현한다.\n- originality.forbiddenVisibleTerms의 명칭은 meta.title·HUD·대화·결과 화면 등 사용자가 보는 문구에 노출하지 말고 독자적 이름으로 대체한다.\n`
}

const escapeCell = value => clean(value, 400).replace(/\|/g, '\\|') || '-'

export function referenceImplementationMarkdown(contract, input = '') {
  if (!contract) return ''
  const options = typeof input === 'string' ? { code: input } : (input || {})
  const code = String(options.code || '')
  const docs = options.docs || {}
  const qaResult = options.qaResult || null
  const qaText = JSON.stringify(qaResult?.diagnostics?.reference || qaResult?.diagnostics?.designContract || {})
  const rows = contract.traceability.map(trace => {
    const pattern = contract.patterns.find(item => item.id === trace.contractId)
    const screen = trace.targetScreen || pattern?.targetScreens?.[0] || 'gameplay'
    const planned = key => String(docs[key] || '').includes(trace.contractId)
    const declared = code.includes(contract.contractId) && code.includes(trace.contractId) && code.includes(screen)
    const verified = declared && (qaResult?.pass === true || qaText.includes(trace.contractId))
    return `| \`${escapeCell(trace.contractId)}\` | ${escapeCell(trace.sourcePattern || pattern?.sourcePattern)} | \`${escapeCell(screen)}\` | ${planned('prd') ? '계획됨' : '누락'} | ${planned('design') ? '설계됨' : '누락'} | ${planned('arch') ? '연결됨' : '누락'} | ${declared ? '선언됨' : '누락'} | ${verified ? '검증됨' : '미검증'} |`
  }).join('\n')
  const ids = values => values.map(value => `\`${typeof value === 'string' ? value : value.id}\``).join(', ') || '-'
  return `# 레퍼런스 구현 추적\n\n- 계약: \`${contract.contractId}\` (${contract.version})\n- 타겟: ${contract.targetTitle} — 구조적 패턴만 독자적으로 번역\n- 코드 선언: \`window.game.meta.reference\` 또는 \`meta.designContract\`\n\n## Implementation Traceability Matrix\n\n| 계약/패턴 ID | 일반화 패턴 | 적용 화면 | PRD | 디자인 | 아키텍처 | meta 선언 | QA |\n|---|---|---|---|---|---|---|---|\n${rows || '| - | - | - | - | - | - | - | 계약 없음 |'}\n\n## 구현·검증 기준\n\n${contract.traceability.map(trace => `- \`${trace.contractId}\` — 구현: ${trace.implementation || '-'} / 검증: ${trace.verification || '-'}`).join('\n') || '- 없음'}\n\n## 필수 선언\n\n- 화면: ${ids(contract.qa.requiredScreens)}\n- 패턴: ${ids(contract.qa.requiredPatternIds)}\n- 상태: ${ids(contract.qa.requiredStates)}\n- 깊이 단서: ${ids(contract.qa.depthSignals)}\n- 피드백 단서: ${ids(contract.qa.feedbackSignals)}\n`
}
