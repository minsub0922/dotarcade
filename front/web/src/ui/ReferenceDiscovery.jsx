import React, { useMemo, useState } from 'react'

const STATUS_INDEX = {
  pending: 0,
  keywords: 0,
  searching: 1,
  selecting: 2,
  'ui-search': 3,
  blueprinting: 4,
  done: 5,
  fallback: 5,
  error: 0
}

const STATUS_COPY = {
  pending: '기획 내용을 읽는 중',
  keywords: '검색 키워드 설계 중',
  searching: '후보 게임 병렬 검색 중',
  selecting: '최종 타겟 게임 선정 중',
  'ui-search': 'UI 화면 레퍼런스 수집 중',
  blueprinting: '레퍼런스를 제작·QA 계약으로 변환 중',
  done: '제작 레퍼런스 준비 완료',
  fallback: '대체 출처로 레퍼런스 준비 완료',
  error: '레퍼런스 탐색 일부 실패'
}

const STEPS = [
  ['01', '키워드 설계'],
  ['02', '병렬 웹 검색'],
  ['03', '타겟 선정'],
  ['04', 'UI 레퍼런스'],
  ['05', '제작 계약']
]

const array = value => Array.isArray(value) ? value.filter(Boolean) : []
const titleOf = value => typeof value === 'string'
  ? value
  : value?.title || value?.name || value?.game || value?.label || '게임 레퍼런스'
const urlOf = value => {
  const url = typeof value === 'string' ? value : value?.url || value?.uri || value?.href
  return /^https?:\/\//i.test(url || '') ? url : ''
}
const sourceOf = value => {
  if (typeof value === 'string') {
    try { return new URL(value).hostname.replace(/^www\./, '') } catch { return value }
  }
  return value?.source || value?.site || value?.provider || (urlOf(value) ? sourceOf(urlOf(value)) : 'UI reference')
}
const percentOf = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return `${Math.round(number <= 1 ? number * 100 : number)}%`
}
const contractOf = reference => reference?.designContract || reference?.blueprint?.designContract || reference?.blueprint || reference?.contract || null
const idOf = value => String(typeof value === 'string' ? value : value?.id || value?.key || value?.name || '').trim()
const itemLabel = value => typeof value === 'string' ? value : value?.label || value?.title || value?.name || value?.id || '계약 항목'
const includesId = (values, id) => array(values).some(value => idOf(value) === id)

function ReferenceContractBoard({ reference }) {
  const contract = contractOf(reference)
  if (!contract) return null

  const qaContract = contract.qa || {}
  const screens = array(contract.screens).filter(screen => {
    const required = array(qaContract.requiredScreens)
    return required.length ? includesId(required, idOf(screen)) : screen?.required !== false && screen?.priority !== 'recommended'
  })
  const patterns = array(contract.patterns).filter(pattern => {
    const required = array(qaContract.requiredPatternIds)
    return required.length ? includesId(required, idOf(pattern)) : pattern?.required !== false
  })
  const requiredStates = array(qaContract.requiredStates || contract.requiredStates)
  const depthSignals = array(qaContract.depthSignals || contract.depthSignals)
  const feedbackSignals = array(qaContract.feedbackSignals || contract.feedbackSignals)
  const progress = reference?.contractStatus || reference?.contractProgress || reference?.implementationStatus || {}
  const visualQa = progress?.qa?.reference || progress?.qa?.visual?.reference || progress?.qa ||
    reference?.contractQa?.reference || reference?.contractQa?.visual?.reference || reference?.contractQa ||
    reference?.qaResult?.diagnostics?.visual?.reference || reference?.qaStatus?.reference || null
  const issues = array(progress?.issues || reference?.contractIssues || reference?.contractQa?.issues || reference?.qaResult?.diagnostics?.visual?.issues)
  const implementedPatterns = array(progress?.implementedPatterns || progress?.meta?.reference?.implementedPatterns || reference?.implementationTrace?.implementedPatterns)
  const implementedScreens = array(progress?.screens || progress?.implementedScreens || progress?.meta?.reference?.screens || reference?.implementationTrace?.screens)
  const implementedStates = array(progress?.implementedStates || progress?.meta?.reference?.implementedStates || reference?.implementationTrace?.implementedStates)
  const implementedDepth = array(progress?.depthSignals || progress?.meta?.reference?.depthSignals || reference?.implementationTrace?.depthSignals)
  const implementedFeedback = array(progress?.feedbackSignals || progress?.meta?.reference?.feedbackSignals || reference?.implementationTrace?.feedbackSignals)
  const issueFor = (category, id) => issues.some(issue => issue?.category === category && String(issue?.item) === id)
  const qaComplete = visualQa?.checks > 0 && visualQa?.passed === visualQa?.checks && visualQa?.implementationVerified !== false
  const explicitStage = String(progress?.stage || progress?.status || '').toLowerCase()
  const needsRepair = issues.length > 0 || /repair|fail|issue|unstable/.test(explicitStage)
  const hasImplementation = implementedPatterns.length > 0 || implementedScreens.length > 0 || /implement|test|qa|verif|pass/.test(explicitStage)
  const stage = qaComplete || /verified|pass/.test(explicitStage) ? 'verified'
    : needsRepair ? 'repair' : hasImplementation ? 'implemented' : 'extracted'
  const stageCopy = {
    extracted: ['계약 추출됨', '문서·코드 반영 대기'],
    implemented: ['코드 추적됨', '런타임 QA 대기'],
    repair: ['수리 필요', `${issues.length || 1}개 진단`],
    verified: ['QA 검증 완료', `${visualQa?.passed || 0}/${visualQa?.checks || 0} 검사 통과`]
  }[stage]
  const declaredByKind = { screen: implementedScreens, pattern: implementedPatterns, state: implementedStates, depth: implementedDepth, feedback: implementedFeedback }
  const itemState = (kind, id) => issueFor(kind, id) ? 'issue'
    : qaComplete ? 'verified'
      : includesId(declaredByKind[kind], id) ? 'traced' : 'planned'
  const itemStateLabel = { issue: '수리', verified: '검증', traced: '반영', planned: '계약' }
  const flow = [
    ['리서치 근거', 'done'],
    ['제작 계약', 'done'],
    ['코드 반영', stage === 'extracted' ? 'active' : stage === 'repair' ? 'issue' : 'done'],
    ['자동 QA', stage === 'verified' ? 'done' : stage === 'repair' ? 'issue' : stage === 'implemented' ? 'active' : 'waiting']
  ]
  const traceCount = array(contract.traceability).length || patterns.length
  const targetTitle = contract.targetTitle || contract.target?.title || titleOf(reference?.selected)

  return (
    <section className={`reference-contract stage-${stage}`} aria-label="레퍼런스 제작 계약과 구현 상태">
      <div className="reference-contract-head">
        <div>
          <span>REFERENCE → BUILD CONTRACT</span>
          <b>추출된 제작 계약</b>
          <small>{targetTitle}의 표현이 아닌 구조를 독자적인 구현 기준으로 변환</small>
        </div>
        <em><b>{stageCopy[0]}</b><small>{stageCopy[1]}</small></em>
      </div>

      <ol className="reference-contract-flow" aria-label="제작 계약 반영 단계">
        {flow.map(([label, state], index) => (
          <li key={label} className={state}><span>{state === 'done' ? '✓' : state === 'issue' ? '!' : index + 1}</span><b>{label}</b></li>
        ))}
      </ol>

      <div className="reference-contract-proof">
        <span><b>TRACE</b>{contract.contractId || reference?.contractId || 'contract'} · {traceCount} mappings</span>
        <span className={visualQa?.traceable ? 'ok' : ''}><i />META 추적 {visualQa ? (visualQa.traceable ? '확인' : '미확인') : '검증 대기'}</span>
        <span className={visualQa?.implementationVerified ? 'ok' : ''}><i />렌더·코드 신호 {visualQa ? (visualQa.implementationVerified ? '확인' : '미확인') : '검증 대기'}</span>
      </div>

      {screens.length > 0 && (
        <div className="reference-contract-group">
          <div className="reference-contract-title"><b>필수 화면·상태</b><span>{screens.length} SCREENS · {requiredStates.length} STATES</span></div>
          <div className="reference-screen-grid">
            {screens.map(screen => {
              const id = idOf(screen)
              const state = itemState('screen', id)
              return (
                <article key={id} className={state}>
                  <span>{id}</span><b>{itemLabel(screen)}</b>
                  <small>{screen?.role || screen?.purpose || screen?.verify || '명시된 입력으로 진입하고 종료 가능한 화면'}</small>
                  <em>{itemStateLabel[state]}</em>
                </article>
              )
            })}
          </div>
          {requiredStates.length > 0 && <div className="reference-signal-list states"><b>STATE</b>{requiredStates.map(state => <span className={itemState('state', idOf(state))} key={idOf(state)}>{itemLabel(state)}</span>)}</div>}
        </div>
      )}

      {patterns.length > 0 && (
        <div className="reference-contract-group">
          <div className="reference-contract-title"><b>UI 패턴 전환표</b><span>{patterns.length} REQUIRED</span></div>
          <div className="reference-pattern-list">
            {patterns.map(pattern => {
              const id = idOf(pattern)
              const state = itemState('pattern', id)
              const trace = array(contract.traceability).find(item => idOf(item?.contractId || item?.patternId) === id)
              const targets = array(pattern?.targetScreens).length ? array(pattern.targetScreens) : trace?.targetScreen ? [trace.targetScreen] : []
              return (
                <article key={id} className={state}>
                  <span className="reference-pattern-id">{id}</span>
                  <div><small>GENERALIZED PATTERN</small><b>{pattern?.sourcePattern || pattern?.requirement || id}</b></div>
                  <i aria-hidden="true">→</i>
                  <div><small>ORIGINAL IMPLEMENTATION</small><b>{pattern?.adaptation || pattern?.implementationHint || trace?.implementation || '독자적 UI 구조로 재설계'}</b></div>
                  <em>{targets.map(idOf).filter(Boolean).join(' · ') || 'gameplay'} · {itemStateLabel[state]}</em>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {(depthSignals.length > 0 || feedbackSignals.length > 0) && (
        <div className="reference-contract-signals">
          {depthSignals.length > 0 && <div className="reference-signal-list depth"><b>DEPTH QA</b>{depthSignals.map(signal => <span className={itemState('depth', idOf(signal))} key={idOf(signal) || itemLabel(signal)}>{itemLabel(signal)}</span>)}</div>}
          {feedbackSignals.length > 0 && <div className="reference-signal-list feedback"><b>FEEDBACK QA</b>{feedbackSignals.map(signal => <span className={itemState('feedback', idOf(signal))} key={idOf(signal) || itemLabel(signal)}>{itemLabel(signal)}</span>)}</div>}
        </div>
      )}

      {needsRepair && issues.length > 0 && (
        <div className="reference-contract-diagnostics">
          <b>ACTIONABLE QA</b>
          {issues.slice(0, 3).map((issue, index) => <span key={`${issue?.code}-${index}`}>{issue?.hint || issue?.message || issue?.code}</span>)}
        </div>
      )}
    </section>
  )
}

function ReferenceThumb({ item, manualOnly }) {
  const [failed, setFailed] = useState(false)
  const image = item?.thumbnail || item?.image || item?.imageUrl || item?.thumb
  const label = item?.screen || item?.category || array(item?.screens)[0] || 'UI SCREEN'

  return (
    <div className="ui-reference-thumb">
      {image && !failed && !manualOnly
        ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : (
          <span className="ui-reference-placeholder" aria-hidden="true">
            <i className="ui-ref-top" /><i className="ui-ref-stage" /><i className="ui-ref-menu" />
            <b>{label}</b>
          </span>
          )}
    </div>
  )
}

export default function ReferenceDiscovery({ reference }) {
  const [expanded, setExpanded] = useState(true)
  const status = reference?.status || 'pending'
  const stepIndex = STATUS_INDEX[status] ?? 0
  const keywords = array(reference?.keywords)
  const candidates = array(reference?.candidates).slice(0, 4)
  const selected = reference?.selected
  const uiReferences = array(reference?.uiReferences || reference?.uiReference).slice(0, 6)
  const sources = useMemo(() => {
    const pool = [...array(reference?.sources), ...array(selected?.sourceUrls)]
    const seen = new Set()
    return pool.filter(item => {
      const key = urlOf(item) || titleOf(item)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 8)
  }, [reference?.sources, selected?.sourceUrls])
  const isComplete = status === 'done' || status === 'fallback'
  const isTerminal = isComplete || status === 'error'
  const selectedReason = selected?.why || selected?.reason || reference?.reason
  const completed = Number(reference?.completedQueries) || 0
  const total = Number(reference?.totalQueries) || 0
  const catalogScreens = uiReferences.reduce((sum, item) => sum + (Number(item?.screenCount) || 0), 0)

  if (!reference?.enabled) return null

  return (
    <section className={`reference-discovery status-${status} ${expanded ? 'expanded' : ''}`} aria-label="게임 레퍼런스 탐색">
      <button
        type="button"
        className="reference-discovery-head"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="reference-radar" aria-hidden="true"><i /></span>
        <span className="reference-head-copy">
          <span><b>REFERENCE SCOUT</b><em>{status === 'fallback' ? 'FALLBACK' : status === 'error' ? 'ISSUE' : isComplete ? 'READY' : 'LIVE'}</em></span>
          <small aria-live="polite">{STATUS_COPY[status] || '레퍼런스 탐색 중'}</small>
        </span>
        {status === 'searching' && total > 0 && <span className="reference-query-count">{completed}/{total}</span>}
        {selected && <strong className="reference-selected-mini">{titleOf(selected)}</strong>}
        <span className={`reference-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">⌄</span>
      </button>

      {expanded && (
        <div className="reference-discovery-body">
          <ol className="reference-steps" aria-label="탐색 진행 단계">
            {STEPS.map(([number, label], index) => {
              const state = stepIndex > index || isComplete ? 'done' : stepIndex === index && !isTerminal ? 'active' : 'waiting'
              return (
                <li key={number} className={state} aria-current={state === 'active' ? 'step' : undefined}>
                  <span>{state === 'done' ? '✓' : number}</span><b>{label}</b>
                </li>
              )
            })}
          </ol>

          {keywords.length > 0 && (
            <div className="reference-keywords">
              <span>SEARCH QUERY</span>
              <div>{keywords.map((keyword, index) => <i key={`${keyword}-${index}`}>#{keyword}</i>)}</div>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="reference-candidates" aria-label="검색된 후보 게임">
              {candidates.map((candidate, index) => {
                const confidence = percentOf(candidate?.confidence ?? candidate?.score ?? candidate?.relevance)
                const isSelected = selected && titleOf(candidate).toLowerCase() === titleOf(selected).toLowerCase()
                return (
                  <div key={`${titleOf(candidate)}-${index}`} className={`reference-candidate ${isSelected ? 'selected' : ''}`}>
                    <span>{isSelected ? '★' : String(index + 1).padStart(2, '0')}</span>
                    <div><b>{titleOf(candidate)}</b><small>{candidate?.reason || candidate?.why || candidate?.genre || '기획 적합도 분석'}</small></div>
                    {confidence && <em>{confidence}</em>}
                  </div>
                )
              })}
            </div>
          )}

          {selected && (
            <div className="reference-target">
              <div className="reference-target-mark"><span>FINAL</span><b>★</b></div>
              <div className="reference-target-copy">
                <span className="reference-target-kicker">SELECTED GAME REFERENCE</span>
                <div className="reference-target-title">
                  <strong>{titleOf(selected)}</strong>
                  {percentOf(selected?.confidence) && <em>적합도 {percentOf(selected.confidence)}</em>}
                </div>
                {selectedReason && <p>{selectedReason}</p>}
                {array(selected?.mechanics).length > 0 && (
                  <div className="reference-mechanics">
                    {selected.mechanics.slice(0, 5).map(mechanic => <span key={mechanic}>{mechanic}</span>)}
                  </div>
                )}
              </div>
            </div>
          )}

          <ReferenceContractBoard reference={reference} />

          {status === 'ui-search' && !uiReferences.length && (
            <div className="reference-loading" role="status">
              <i /><div><b>Game UI Database · 유사 아카이브 탐색 중</b><small>메뉴, HUD, 전투, 피드백 화면을 수집하고 있습니다.</small></div>
            </div>
          )}

          {uiReferences.length > 0 && (
            <div className="ui-reference-section">
              <div className="ui-reference-title">
                <div><b>UI REFERENCE BOARD</b><small>제작에 반영할 화면 구조와 인터랙션 근거</small></div>
                <span>{catalogScreens ? `${catalogScreens} CATALOG SCREENS` : `${uiReferences.length} REFERENCES`}</span>
              </div>
              <div className="reference-usage-rule"><b>USE POLICY</b><span>화면 정보 구조만 사람이 검토합니다. 원본 이미지·캐릭터·아트는 AI 입력이나 생성 에셋에 사용하지 않습니다.</span></div>
              <div className="ui-reference-grid">
                {uiReferences.map((item, index) => {
                  const link = urlOf(item)
                  const source = sourceOf(item).toLowerCase()
                  const manualOnly = item?.policy === 'manual-review-only' || item?.aiUseAllowed === false || source === 'gameuidatabase.com'
                  const humanReference = item?.policy === 'human-reference' || item?.humanReference === true
                  const content = (
                    <>
                      <ReferenceThumb item={item} manualOnly={manualOnly} />
                      <span className="ui-reference-meta">
                        <i>{sourceOf(item)}</i><b>{titleOf(item)}</b>
                        <small>{item?.apply || item?.note || item?.screen || item?.category || array(item?.screens).join(' · ') || item?.excerpt || 'UI 구조 참고'}</small>
                        {manualOnly && <em className="reference-policy manual">수동 검토 전용 · AI 입력 금지</em>}
                        {!manualOnly && humanReference && <em className="reference-policy human">사람 참고용</em>}
                      </span>
                    </>
                  )
                  return link
                    ? <a key={`${link}-${index}`} href={link} target="_blank" rel="noreferrer" className={`ui-reference-card ${manualOnly ? 'manual-only' : ''}`}>{content}</a>
                    : <div key={`${titleOf(item)}-${index}`} className={`ui-reference-card ${manualOnly ? 'manual-only' : ''}`}>{content}</div>
                })}
              </div>
            </div>
          )}

          {reference?.fallback && (
            <div className="reference-fallback">원본 UI 아카이브 접근이 제한되어 공식 사이트·영상·위키 등 검증 가능한 대체 출처를 사용했습니다.</div>
          )}
          {reference?.error && <div className="reference-error">⚠ {reference.error}</div>}

          {sources.length > 0 && (
            <details className="reference-sources">
              <summary>근거 출처 {sources.length}개 보기</summary>
              <div>
                {sources.map((source, index) => {
                  const link = urlOf(source)
                  return link
                    ? <a key={`${link}-${index}`} href={link} target="_blank" rel="noreferrer"><span>{sourceOf(source)}</span>{titleOf(source)}</a>
                    : <span key={`${titleOf(source)}-${index}`}>{titleOf(source)}</span>
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
