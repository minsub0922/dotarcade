import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearReferenceResearchCache,
  deriveReferencePlan,
  runReferenceResearch
} from './reference-research.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Pokémon 기획은 검색 키워드와 Let’s Go 우선 후보를 만든다', () => {
  const plan = deriveReferencePlan({ agenda: '포켓몬스터처럼 몬스터를 수집하고 전투하는 게임' })
  assert.ok(plan.keywords.includes('creature collection'))
  assert.ok(plan.keywords.includes('turn-based battle'))
  assert.equal(plan.queries.length, 3)
  assert.match(plan.queries[0], /creature collection/)
  assert.match(plan.queries[1], /Pokémon Let's Go/)
  assert.match(plan.queries[1], /Pokemon Emerald/)
  assert.equal(plan.profile.candidates[0].id, 'pokemon-lets-go')
  assert.equal(plan.profile.candidates[1].id, 'pokemon-emerald')
})

test('몬스터 수집 기획은 특정 IP 대신 범용 collection 프로필로 분류한다', () => {
  const plan = deriveReferencePlan({ agenda: '친근한 몬스터를 수집하고 함께 탐험하는 게임' })
  assert.equal(plan.profile.id, 'creature-collection')
  assert.equal(plan.profile.candidates[0].id, 'monster-sanctuary')
  assert.equal(plan.profile.candidates.some(candidate => candidate.id.startsWith('pokemon-')), false)
})

test('검색을 병렬 실행하고 근거 없는 모델 후보 대신 검증된 profile 후보를 선택한다', async () => {
  clearReferenceResearchCache()
  let active = 0
  let peak = 0
  const calls = []
  const progress = []
  const search = async query => {
    calls.push(query)
    active++; peak = Math.max(peak, active)
    await wait(8)
    active--
    if (query.includes('gameuidatabase')) {
      return { results: [{
        title: "Pokémon: Let’s Go UI Database",
        url: 'https://gameuidatabase.com/gameData.php?id=96',
        content: 'Player Menu Party Summary Inventory Codex Battle Command World Map', score: 0.95
      }] }
    }
    if (query.includes('interfaceingame')) {
      return { results: [{
        title: 'Pokémon interface overview',
        url: 'https://interfaceingame.com/games/pokemon/',
        content: 'Interface overview', score: 0.7
      }] }
    }
    return { results: [{
      title: 'Pokémon creature collection comparison',
      url: `https://example.com/reference-${calls.length}`,
      content: "Pokémon Let's Go party battle overworld UI", score: 0.8
    }] }
  }
  const generate = async () => ({
    // evidenceIds가 없고 검색 본문에도 없는 후보는 live target이 될 수 없다.
    text: JSON.stringify({
      candidates: [
        { id: 'other', title: 'Unrelated Game', why: 'other', mechanics: ['x'], uiFocus: ['y'] },
        { id: 'other-2', title: 'Other 2', why: 'other', mechanics: ['x'], uiFocus: ['y'] },
        { id: 'other-3', title: 'Other 3', why: 'other', mechanics: ['x'], uiFocus: ['y'] }
      ],
      selectedIndex: 1,
      reason: 'model choice'
    })
  })

  const result = await runReferenceResearch(
    { agenda: '포켓몬스터 기반의 간단한 수집 전투 게임' },
    { search, generate, emit: event => progress.push(event.status) }
  )

  assert.equal(result.status, 'done')
  assert.equal(result.selected.id, 'pokemon-lets-go')
  assert.equal(result.selectionMode, 'profile-evidence')
  assert.equal(result.candidates[1].id, 'pokemon-emerald')
  assert.equal(result.candidates[2].id, 'pokemon-sword-shield')
  assert.ok(result.candidates[0].evidenceCount > 0)
  assert.ok(result.selected.confidence > result.candidates[1].score)
  assert.equal(calls.length, 6)
  assert.ok(peak >= 3, `parallel search peak=${peak}`)
  assert.deepEqual(progress.slice(0, 3), ['keywords', 'searching', 'searching'])

  const gameUiCards = result.uiReferences.filter(item => item.source === 'gameuidatabase.com')
  assert.equal(gameUiCards.length, 1)
  for (const item of gameUiCards) {
    assert.equal(item.url, 'https://gameuidatabase.com/gameData.php?id=96')
    assert.equal(item.policy, 'manual-review-only')
    assert.equal(item.aiUseAllowed, false)
    assert.equal(item.aiInputAllowed, false)
    assert.equal(item.downloadAllowed, false)
    assert.equal(item.thumbnail, null)
    assert.equal(item.excerpt, '')
    assert.equal(item.apply, undefined)
  }
})

test('모델이 선택한 후보가 근거 검증에서 제거되면 다른 index로 암묵적 재선택하지 않는다', async () => {
  clearReferenceResearchCache()
  const search = async () => ({ results: ['Runner A', 'Runner B', 'Runner C'].map(title => ({
    title: `${title} interface analysis`,
    url: `https://allowed.example/${title.toLowerCase().replace(' ', '-')}`,
    content: `${title} has a compact runner interface.`, score: 0.8
  })) })
  const generate = async payload => {
    if (payload.hint !== 'reference_select') return { text: '{invalid-blueprint' }
    const prompt = payload.messages[0].text
    const evidenceId = title => prompt.match(new RegExp(`\\[(src-[^\\]]+)\\] ${title}`))?.[1]
    return { text: JSON.stringify({
      candidates: [
        { id: 'uncited', title: 'Uncited Winner', why: 'unsupported', mechanics: ['run'], uiFocus: ['hud'], evidenceIds: [] },
        ...['Runner A', 'Runner B', 'Runner C'].map((title, index) => ({
          id: `runner-${index + 1}`, title, why: 'cited comparison', mechanics: ['run'],
          uiFocus: ['hud'], evidenceIds: [evidenceId(title)]
        }))
      ],
      selectedIndex: 0,
      reason: 'the unsupported item was selected'
    }) }
  }
  const result = await runReferenceResearch(
    { agenda: '짧은 원버튼 러너' }, { search, generate }
  )
  assert.equal(result.selectionMode, 'profile-fallback')
  assert.equal(result.selected.id, 'canabalt')
  assert.equal(result.fallback, true)
})

test('검색 불가 시에도 완결된 Pokémon POC와 조회 절차를 반환한다', async () => {
  clearReferenceResearchCache()
  const result = await runReferenceResearch(
    { agenda: '포켓몬 같은 수집형 RPG POC' },
    { search: null, generate: null }
  )
  assert.equal(result.status, 'fallback')
  assert.equal(result.fallback, true)
  assert.equal(result.selected.id, 'pokemon-lets-go')
  assert.equal(result.queryRuns.length, 6)
  assert.equal(result.selectionMode, 'profile-fallback')
  assert.equal(result.uiReferences.filter(item => item.source === 'gameuidatabase.com').length, 1)
  assert.equal(result.uiReferences[0].captureStatus, 'lookup-required')
})

test('동일 기획의 동시 요청은 검색 작업을 중복 실행하지 않는다', async () => {
  clearReferenceResearchCache()
  let calls = 0
  const search = async query => {
    calls++
    await wait(6)
    return { results: [{ title: query, url: `https://example.com/${calls}`, content: 'reference', score: 0.5 }] }
  }
  const input = { agenda: '리듬에 맞춰 버튼을 누르는 타이밍 게임' }
  const [left, right] = await Promise.all([
    runReferenceResearch(input, { search }),
    runReferenceResearch(input, { search })
  ])
  assert.equal(calls, 6)
  assert.equal(left.selected.id, right.selected.id)
})

test('폴백은 cache하지 않고 currentInfo 전체가 cache identity에 반영된다', async () => {
  clearReferenceResearchCache()
  const input = { agenda: '장애물을 피하는 원버튼 러너' }
  const fallback = await runReferenceResearch(input, { search: null, generate: null })
  assert.equal(fallback.fallback, true)

  let calls = 0
  const search = async () => {
    calls++
    return { results: [{
      title: 'Canabalt gameplay and interface analysis', url: 'https://allowed.example/canabalt',
      content: 'Canabalt one-button jump, obstacle readability and score HUD.', score: 0.9
    }] }
  }
  const recovered = await runReferenceResearch(input, { search, generate: null })
  assert.equal(recovered.fallback, false)
  assert.equal(calls, 6, '폴백이 cache됐다면 검색이 실행되지 않는다')

  const sharedPrefix = 'x'.repeat(600)
  await runReferenceResearch({ ...input, currentInfo: `${sharedPrefix} A` }, { search, generate: null })
  await runReferenceResearch({ ...input, currentInfo: `${sharedPrefix} B` }, { search, generate: null })
  assert.equal(calls, 18, '400자 이후 currentInfo 차이도 별도 계약을 만들어야 한다')
})

test('검색 실패 시에도 구현·QA까지 연결되는 완결된 2.5D 설계 계약을 만든다', async () => {
  clearReferenceResearchCache()
  const first = await runReferenceResearch(
    { agenda: '포켓몬처럼 작은 몬스터를 모아 짧게 전투하는 게임' },
    { search: null, generate: null }
  )
  clearReferenceResearchCache()
  const second = await runReferenceResearch(
    { agenda: '포켓몬처럼 작은 몬스터를 모아 짧게 전투하는 게임' },
    { search: null, generate: null }
  )

  const contract = first.designContract
  assert.equal(first.blueprint.contractId, contract.contractId)
  assert.equal(contract.schemaVersion, 'reference-blueprint/v1')
  assert.equal(contract.contractId, second.designContract.contractId, 'generatedAt과 무관한 안정 contract id')
  assert.equal(contract.target.id, 'pokemon-lets-go')
  assert.deepEqual(contract.qa.requiredScreens, ['title', 'gameplay', 'result', 'party'])
  assert.equal(contract.screens.find(item => item.id === 'codex').priority, 'recommended')
  assert.ok(contract.coreLoop.steps.length >= 4)
  assert.ok(contract.requiredStates.includes('party:selected'))
  assert.deepEqual(contract.visualGrammar.depthLayers, ['far', 'mid', 'near', 'ui'])
  assert.match(contract.visualGrammar.perspective, /horizon|scale/i)
  assert.ok(contract.patterns.some(item => item.id === 'party-grid' && item.required))
  assert.ok(contract.patterns.every(item => item.implementationHint && item.verify && item.evidenceIds.length))
  assert.ok(contract.qa.depthSignals.includes('ellipse contact shadows'))
  assert.ok(contract.qa.feedbackSignals.includes('impact or reaction'))
  assert.equal(contract.quality.mode, 'deterministic-fallback')
  assert.ok(contract.quality.warnings.includes('permitted-web-evidence-unavailable'))
  assert.equal(contract.evidenceMap[0].id, 'src-baseline')
  assert.ok(contract.originality.forbidden.includes('characters or recognizable silhouettes'))
  assert.ok(contract.originality.forbiddenVisibleTerms.includes('포켓몬'))
  assert.ok(contract.originality.forbiddenVisibleTermKeys.includes('pokemon let s go pikachu eevee'))
  assert.ok(contract.qa.forbiddenVisibleTerms.includes('포켓몬'))
})

test('같은 타겟·ID여도 실행 의미가 바뀌면 contractId가 바뀐다', async () => {
  const search = async () => ({ results: [{
    title: 'Canabalt interface analysis', url: 'https://allowed.example/canabalt',
    content: 'Canabalt uses early obstacle visibility and a compact score HUD.', score: 0.9
  }] })
  let implementationHint = 'Use one warning silhouette.'
  const generate = async payload => {
    if (payload.hint === 'reference_select') return { text: '{invalid-selection' }
    const evidenceId = payload.messages[0].text.match(/\[(src-[^\]]+)\]/)?.[1]
    return { text: JSON.stringify({
      coreLoop: {
        goal: 'Read and jump.', verbs: ['read', 'jump'],
        steps: [
          { id: 'read', action: 'Read hazard.', feedback: 'Warning appears.' },
          { id: 'jump', action: 'Jump.', feedback: 'Launch reacts.' },
          { id: 'land', action: 'Land.', feedback: 'Landing settles.' }
        ], sessionGoal: 'Run briefly.', failureRecovery: 'Retry.'
      },
      screens: [
        { id: 'title', purpose: 'Start.', layout: 'start', primaryAction: 'Start', feedback: 'pulse', priority: 'required' },
        { id: 'gameplay', purpose: 'Run.', layout: 'world', primaryAction: 'Jump', feedback: 'react', priority: 'required' },
        { id: 'result', purpose: 'Retry.', layout: 'score', primaryAction: 'Retry', feedback: 'settle', priority: 'required' },
        { id: 'help', purpose: 'Explain.', layout: 'overlay', primaryAction: 'Resume', feedback: 'focus', priority: 'recommended' }
      ],
      patterns: [{
        id: 'evidence-layout', category: 'readability', requirement: 'Warn before collision.',
        implementationHint, verify: 'Warning precedes collision.', evidenceIds: [evidenceId], required: true
      }]
    }) }
  }
  clearReferenceResearchCache()
  const first = await runReferenceResearch({ agenda: '장애물을 피하는 러너' }, { search, generate })
  implementationHint = 'Use a lane marker and distance pulse.'
  clearReferenceResearchCache()
  const second = await runReferenceResearch({ agenda: '장애물을 피하는 러너' }, { search, generate })
  assert.notEqual(first.designContract.contractId, second.designContract.contractId)
  assert.equal(first.designContract.qa.requiredScreens.includes('help'), false)
})

test('허용된 검색 근거에서 LLM 설계 패턴을 추출하고 근거→화면→검증 trace를 보존한다', async () => {
  clearReferenceResearchCache()
  const blueprintCalls = []
  const search = async query => {
    if (query.includes('gameuidatabase')) return { results: [
      {
        title: 'MANUAL CATALOG SECRET',
        url: 'https://gameuidatabase.com/gameData.php?id=999',
        content: 'PROHIBITED PIXEL CONTENT', score: 1
      },
      {
        title: 'SUBDOMAIN MANUAL SECRET',
        url: 'https://media.gameuidatabase.com/private-capture',
        content: 'SUBDOMAIN PROHIBITED CONTENT', score: 0.99
      }
    ] }
    return { results: ['Runner A', 'Runner B', 'Runner C'].map((title, index) => ({
      title: `${title} interface analysis`,
      url: `https://allowed.example/${title.toLowerCase().replace(' ', '-')}`,
      content: `${title} telegraphs hazards early, keeps score compact, and gives immediate landing feedback.`,
      score: 0.86 - index * 0.04
    })) }
  }
  const generate = async payload => {
    if (payload.hint === 'reference_select') {
      const prompt = payload.messages[0].text
      const evidenceId = title => prompt.match(new RegExp(`\\[(src-[^\\]]+)\\] ${title}`))?.[1]
      return { text: JSON.stringify({
        candidates: [
          { id: 'runner-a', title: 'Runner A', why: 'small scope', mechanics: ['auto-run', 'timed jump'], uiFocus: ['hazard telegraph'], evidenceIds: [evidenceId('Runner A')] },
          { id: 'runner-b', title: 'Runner B', why: 'comparison', mechanics: ['run'], uiFocus: ['score'], evidenceIds: [evidenceId('Runner B')] },
          { id: 'runner-c', title: 'Runner C', why: 'comparison', mechanics: ['run'], uiFocus: ['result'], evidenceIds: [evidenceId('Runner C')] }
        ],
        selectedIndex: 0, reason: 'best implementation fit'
      }) }
    }
    blueprintCalls.push(payload)
    const citedEvidenceId = payload.messages[0].text.match(/\[(src-[^\]]+)\]/)?.[1]
    return { text: JSON.stringify({
      coreLoop: {
        goal: 'Read, jump and extend the run.', verbs: ['read', 'jump', 'land'],
        steps: [
          { id: 'read', action: 'Read the next obstacle.', feedback: 'Contrast reveals the lane.' },
          { id: 'jump', action: 'Jump in the timing window.', feedback: 'Launch squash acknowledges input.' },
          { id: 'land', action: 'Land and extend score.', feedback: 'A landing pulse settles the action.' }
        ],
        sessionGoal: 'Survive one minute.', failureRecovery: 'One-input retry.'
      },
      screens: [
        { id: 'title', label: 'Start', purpose: 'Teach input.', layout: 'hero then start', primaryAction: 'Start', feedback: 'button pulse', priority: 'required' },
        { id: 'gameplay', label: 'Run', purpose: 'Read and act.', layout: 'world then HUD', primaryAction: 'Jump', feedback: 'launch and land', priority: 'required' },
        { id: 'result', label: 'Result', purpose: 'Explain outcome.', layout: 'score then retry', primaryAction: 'Retry', feedback: 'score settle', priority: 'required' },
        { id: 'help', label: 'Help', purpose: 'Explain controls.', layout: 'short overlay', primaryAction: 'Resume', feedback: 'focus restore', priority: 'recommended' }
      ],
      patterns: [{
        id: 'evidence-telegraph', category: 'readability',
        requirement: 'Reveal the obstacle before the reaction window.',
        implementationHint: 'Use silhouette and lane contrast, with original geometry.',
        verify: 'A hazard is visible before it enters collision range.', evidenceIds: [citedEvidenceId], required: true
      }],
      visualGrammar: {
        composition: 'sky, city, road and UI layers', perspective: 'road narrows toward a horizon',
        lighting: 'single sunset key', shadows: 'grounded ellipses', palette: 'value-separated planes',
        motion: 'anticipate, launch, land and settle'
      },
      requiredStates: ['gameplay:airborne'],
      implementation: {
        difficulty: 'small', systems: ['runner state'], reusableComponents: ['layer renderer'],
        cutOrder: ['secondary particles']
      }
    }) }
  }

  const result = await runReferenceResearch(
    { agenda: '장애물을 미리 보고 점프하는 짧은 러너 게임' },
    { search, generate }
  )

  assert.equal(blueprintCalls.length, 1)
  const modelInput = JSON.stringify(blueprintCalls[0])
  assert.doesNotMatch(modelInput, /gameuidatabase\.com|MANUAL CATALOG SECRET|PROHIBITED PIXEL CONTENT|SUBDOMAIN MANUAL SECRET|SUBDOMAIN PROHIBITED CONTENT/)
  assert.equal(result.designContract.quality.mode, 'llm-evidence')
  const extracted = result.designContract.patterns.find(item => item.id === 'evidence-telegraph')
  assert.match(extracted.evidenceIds[0], /^src-[a-f0-9]{8}$/)
  const trace = result.designContract.traceability.find(item => item.contractId === extracted.id)
  assert.deepEqual(trace.sourceIds, extracted.evidenceIds)
  assert.equal(trace.verification, extracted.verify)
  assert.ok(result.designContract.evidenceMap.some(item => item.id === extracted.evidenceIds[0] && item.aiInputAllowed))
  assert.ok(result.designContract.quality.evidenceCoverage > 0)
  assert.equal(result.evidence.some(item => /gameuidatabase/.test(item.url)), false)
  const manualSources = result.sources.filter(item => /gameuidatabase/.test(item.url))
  assert.equal(manualSources.length, 2)
  assert.ok(manualSources.every(item => item.excerpt === '' && item.aiInputAllowed === false))
  assert.equal(result.designContract.qa.requiredScreens.includes('help'), false)
  assert.equal(result.designContract.screens.find(item => item.id === 'help').priority, 'recommended')
})

test('깨진 blueprint 모델 응답은 장르 baseline으로 안전하게 복구한다', async () => {
  clearReferenceResearchCache()
  const search = async query => ({ results: [{
    title: 'Rhythm UX note', url: `https://example.org/${encodeURIComponent(query).slice(0, 24)}`,
    content: 'Fixed timing line and redundant timing grades.', score: 0.7
  }] })
  const generate = async payload => payload.hint === 'reference_select'
    ? { text: '{not-json' }
    : { text: JSON.stringify({ screens: [] }) }
  const result = await runReferenceResearch(
    { agenda: '박자에 맞춰 버튼 하나를 누르는 리듬 게임' },
    { search, generate }
  )
  const contract = result.blueprint
  assert.equal(contract.genre, 'rhythm')
  assert.equal(contract.extractionMode, 'deterministic-fallback')
  assert.ok(contract.patterns.some(item => item.id === 'fixed-judgment-line'))
  assert.ok(contract.qa.requiredScreens.includes('help'))
  assert.ok(contract.coreLoop.verbs.includes('tap'))
})
