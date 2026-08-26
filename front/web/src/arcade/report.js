import { CRITERIA } from '../data/criteria.js'

const clean = value => String(value || '').replace(/\s+/g, ' ').trim()

export const validArcadeReports = reports => (reports || [])
  .filter(report => typeof report?.score === 'number' && Number.isFinite(report.score) && !report?.evaluationFailed)

// The LLM summary is presentation sugar, not the source of truth. A completed
// simulation must still have a useful report when streaming is empty or fails.
export function ensureArcadeSummary({ text, game, version, reports = [], avg = null, ratings = null, error = '' }) {
  const streamed = clean(text)
  if (streamed) return String(text).trim()

  const valid = validArcadeReports(reports)
  const axes = CRITERIA
    .map(axis => [axis.label, Number(ratings?.[axis.key])])
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])
  const strongest = axes[0]
  const weakest = axes.at(-1)
  const reactions = valid
    .filter(report => clean(report.oneLiner))
    .slice(0, 3)
    .map(report => `- **${clean(report.visitor?.name) || '손님'} ${report.score}/10** — ${clean(report.oneLiner)}`)
  const suggestions = [...new Set(valid.flatMap(report => report.suggestions || []).map(clean).filter(Boolean))]
    .slice(0, 3)
    .map((suggestion, index) => `${index + 1}. ${suggestion}`)

  return [
    `# 오락실 반응 리포트 — ${clean(game?.title) || '새 게임'} ${clean(version)}`,
    '',
    `**총평**: AI 손님 ${reports.length}명이 실제 게임을 실행했고, ${valid.length}명의 유효 평가를 확보했습니다.${avg == null ? '' : ` 평균은 **${avg}/10**입니다.`}`,
    strongest && weakest
      ? `평가 축에서는 **${strongest[0]} ${strongest[1]}**이 가장 강했고, **${weakest[0]} ${weakest[1]}**을 다음 버전에서 우선 개선해야 합니다.`
      : '유효한 평가 축이 부족해 개별 플레이 기록을 중심으로 확인해야 합니다.',
    '',
    '## 대표 플레이 반응',
    ...(reactions.length ? reactions : ['- 유효한 한줄평이 없어 플레이 실패 기록을 확인해야 합니다.']),
    '',
    '## 다음 버전 우선순위',
    ...(suggestions.length ? suggestions : ['1. 실패한 플레이 기록과 런타임 오류를 먼저 재현합니다.', '2. 조작 피드백과 난이도 곡선을 다시 검증합니다.']),
    error ? `\n> 자동 요약을 불러오지 못해 실제 평가 데이터로 리포트를 복구했습니다: ${clean(error)}` : ''
  ].filter(Boolean).join('\n')
}

export async function saveFeedbackWithRetry(save, payload, { attempts = 2, wait = () => Promise.resolve() } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      const result = await save(payload)
      if (result?.ok !== true) throw new Error(result?.error || '피드백 저장 확인 응답이 없습니다')
      return result
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(attempt)
    }
  }
  throw lastError || new Error('피드백 저장 실패')
}

export function mergeSavedFeedback(games, gameId, version, feedback, stats = null) {
  return (games || []).map(game => game.id !== gameId ? game : {
    ...game,
    feedback: { ...(game.feedback || {}), [version]: feedback },
    ...(stats ? { stats } : {})
  })
}
