import { PHASES } from '../meeting/prompts.js'

export const MILESTONE_ACTION = Object.freeze({
  NEW_MEETING: 'new-meeting',
  RESUME_MEETING: 'resume-meeting',
  START_PLAYTEST: 'start-playtest',
  WATCH_PLAYTEST: 'watch-playtest',
  VIEW_REPORT: 'view-report',
  UPGRADE_MEETING: 'upgrade-meeting'
})

const hasCurrentFeedback = game => !!game?.feedback?.[game.version]

/**
 * Turns the current studio state into one concrete, playable next action.
 * Keep this pure: App owns navigation, HUD only presents this contract.
 */
const updatedAt = game => {
  const value = new Date(game?.updatedAt || game?.createdAt || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

export function selectActiveProject(games, meeting, studio) {
  const authored = games.filter(game => game?.source === 'meeting')
  const ids = [meeting?.resultGameId, studio?.activeMission?.gameId].filter(Boolean)
  for (const id of ids) {
    const game = authored.find(candidate => candidate.id === id)
    if (game) return game
  }
  return [...authored].sort((a, b) => updatedAt(b) - updatedAt(a))[0] || null
}

export function getMilestoneConflict({ meeting = null, arcade = null } = {}, action) {
  if (meeting?.status === 'running' && action !== MILESTONE_ACTION.RESUME_MEETING) return '진행 중인 제작 회의를 먼저 마쳐 주세요.'
  if (arcade && ['running', 'summarizing'].includes(arcade.status) && action !== MILESTONE_ACTION.WATCH_PLAYTEST) return '진행 중인 플레이테스트를 먼저 완료해 주세요.'
  return ''
}

export function getStudioMilestone({ games = [], meeting = null, arcade = null, studio = null, map = 'office' } = {}) {
  const meetingActive = meeting?.status === 'running'
  const arcadeActive = arcade && ['running', 'summarizing'].includes(arcade.status)

  if (meetingActive) {
    const phaseIndex = Math.max(0, PHASES.findIndex(phase => phase.key === meeting.phase))
    return {
      action: MILESTONE_ACTION.RESUME_MEETING,
      icon: '✦', tone: 'building', kicker: '제작 회의 진행 중',
      title: meeting.phaseLabel || PHASES[phaseIndex]?.label || '제작 현황 확인',
      detail: meeting.agenda || '팀의 제작 논의를 이어서 확인합니다.',
      confirmTitle: '진행 중인 제작 회의로 돌아갈까요?',
      destination: '회의 진행 화면', actionLabel: '회의 열기',
      arrivalNote: '진행 중인 회의 화면이 자동으로 열립니다.',
      progress: ((phaseIndex + 1) / PHASES.length) * 100,
      step: `${phaseIndex + 1}/${PHASES.length}`
    }
  }

  if (arcadeActive) {
    const completed = Math.max(0, Math.min(20, Number(arcade.progress) || 0))
    return {
      action: MILESTONE_ACTION.WATCH_PLAYTEST,
      icon: '◆', tone: 'testing',
      kicker: arcade.status === 'summarizing' ? '평가 리포트 작성 중' : 'AI 플레이테스트 진행 중',
      title: arcade.title || '신작 플레이테스트',
      detail: arcade.status === 'summarizing'
        ? '20명의 플레이 기록을 종합하고 있습니다.'
        : `AI 손님 ${completed}/20명이 실제 게임을 플레이하고 있습니다.`,
      confirmTitle: '진행 중인 플레이테스트 현장으로 이동할까요?',
      destination: map === 'arcade' ? '오락실 진행 화면' : '오락실', actionLabel: '현장 보기',
      arrivalNote: '도착하면 라이브 플레이테스트 화면이 자동으로 열립니다.',
      progress: (completed / 20) * 100,
      step: arcade.status === 'summarizing' ? '리포트' : `${completed}/20`
    }
  }

  if (arcade && !arcade.reportSeen && ['done', 'report_error'].includes(arcade.status)) {
    return {
      action: MILESTONE_ACTION.VIEW_REPORT,
      gameId: arcade.gameId,
      icon: arcade.status === 'report_error' ? '!' : '▥',
      tone: arcade.status === 'report_error' ? 'warning' : 'ready',
      kicker: arcade.status === 'report_error' ? '평가 복구 필요' : '플레이테스트 완료',
      title: arcade.status === 'report_error' ? '저장된 평가 결과 확인' : `「${arcade.title || '신작'}」 평가 리포트`,
      detail: arcade.status === 'report_error'
        ? '평가 결과는 보존했습니다. 리포트를 확인한 뒤 필요하면 테스트를 다시 실행할 수 있습니다.'
        : `${arcade.progress || 20}명의 플레이 결과와 다음 업데이트 우선순위를 확인합니다.`,
      confirmTitle: arcade.status === 'report_error' ? '보존된 평가 결과를 확인할까요?' : '완료된 평가 리포트를 확인할까요?',
      destination: '오락실 평가 리포트', actionLabel: '리포트 열기',
      arrivalNote: '도착하면 저장된 평가 리포트가 자동으로 열립니다.',
      progress: 100, step: '완료'
    }
  }

  const activeGame = selectActiveProject(games, meeting, studio)
  if (!activeGame) {
    return {
      action: MILESTONE_ACTION.NEW_MEETING,
      icon: '✦', tone: 'idle', kicker: '다음 행동 · 게임 기획',
      title: '첫 게임 제작 회의 열기',
      detail: '회의실로 이동해 팀원들과 신작의 방향을 정합니다.',
      confirmTitle: '첫 게임 제작 회의를 시작할까요?',
      destination: '사무실 회의실', actionLabel: '회의실로 이동',
      arrivalNote: '도착하면 회의 안건 제출 화면이 자동으로 열립니다.',
      progress: 0, step: '1/3'
    }
  }

  if (!hasCurrentFeedback(activeGame)) {
    const retry = arcade?.gameId === activeGame.id && ['cancelled', 'report_error'].includes(arcade.status)
    return {
      action: MILESTONE_ACTION.START_PLAYTEST,
      gameId: activeGame.id,
      icon: retry ? '↻' : '▶', tone: retry ? 'warning' : 'idle',
      kicker: retry ? '테스트 중단됨 · 재시도' : '다음 행동 · 출시 검증',
      title: retry ? `「${activeGame.title}」 플레이테스트 다시 시작` : `「${activeGame.title}」 플레이테스트`,
      detail: retry
        ? '완료되지 않은 평가를 초기화하고 AI 손님 20명 테스트를 다시 실행합니다.'
        : '오락실에 배포하고 AI 손님 20명의 반응을 확인합니다.',
      confirmTitle: retry ? `「${activeGame.title}」 평가를 다시 시작할까요?` : `「${activeGame.title} ${activeGame.version || ''}」을 오락실에 배포할까요?`,
      destination: '오락실 테스트 캐비닛', actionLabel: '이동하고 20명 평가 시작',
      arrivalNote: '도착하면 AI 손님 20명의 평가가 자동으로 시작됩니다.',
      progress: 50, step: '2/3'
    }
  }

  const feedback = activeGame.feedback?.[activeGame.version]
  return {
    action: MILESTONE_ACTION.UPGRADE_MEETING,
    gameId: activeGame.id,
    icon: '↻', tone: 'ready', kicker: '다음 행동 · 업데이트',
    title: `「${activeGame.title || '출시작'}」 다음 버전 기획`,
    detail: feedback?.avg == null
      ? '플레이 피드백을 바탕으로 다음 버전을 설계합니다.'
      : `평균 ${feedback.avg}/10의 플레이 피드백을 다음 회의에 반영합니다.`,
    confirmTitle: '평가 피드백으로 다음 버전을 기획할까요?',
    destination: '사무실 회의실', actionLabel: '개선 회의 열기',
    arrivalNote: '도착하면 피드백이 연결된 개선 회의 화면이 자동으로 열립니다.',
    progress: 67, step: '3/3 진행'
  }
}
