import { PHASES } from '../meeting/prompts.js'
import { isMeetingActive, isMeetingPaused, meetingStatusCopy } from '../meeting/status.js'

export const MILESTONE_ACTION = Object.freeze({
  TEAM_INTERACTION: 'team-interaction',
  PLAY_GAME: 'play-game',
  NEW_MEETING: 'new-meeting',
  RESUME_MEETING: 'resume-meeting',
  INTERRUPT_MEETING: 'interrupt-meeting',
  START_PLAYTEST: 'start-playtest',
  WATCH_PLAYTEST: 'watch-playtest',
  VIEW_REPORT: 'view-report',
  UPGRADE_MEETING: 'upgrade-meeting'
})

export const STUDIO_TODO = Object.freeze({
  TEAM_INTERACTION: 'team-interaction',
  PLAY_GAME: 'play-game',
  CREATE_GAME: 'create-game',
  INTERRUPT_MEETING: 'interrupt-meeting',
  GET_EVALUATION: 'get-evaluation',
  IMPROVE_GAME: 'improve-game'
})

export const MILESTONE_STATUS = Object.freeze({
  ACTIVE: 'active',
  AVAILABLE: 'available',
  LOCKED: 'locked',
  DONE: 'done'
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

const progressDone = (progress, id) => {
  const value = progress?.[id]
  return value === true || value?.done === true || value?.status === MILESTONE_STATUS.DONE
}

const isExplicitlyPaused = meeting => ['paused', 'interrupted', 'waiting_for_human'].includes(meeting?.status)
const isInterrupting = meeting => ['pausing', 'interrupting'].includes(meeting?.status)
const isRunningMeeting = meeting => ['running', 'resuming'].includes(meeting?.status)

const isUpgradeRelease = game => {
  if ((game?.versions?.length || 0) > 1) return true
  const match = String(game?.version || '').match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/)
  return !!match && (Number(match[1]) > 1 || Number(match[2]) > 0)
}

const withState = (item, status, blockReason = '') => {
  const canStart = !blockReason && (
    status === MILESTONE_STATUS.AVAILABLE
    || status === MILESTONE_STATUS.ACTIVE
    || (status === MILESTONE_STATUS.DONE && item.repeatable === true)
  )
  return {
    ...item,
    status,
    done: status === MILESTONE_STATUS.DONE,
    active: status === MILESTONE_STATUS.ACTIVE,
    locked: status === MILESTONE_STATUS.LOCKED,
    canStart,
    enabled: canStart,
    blockReason,
    step: `${item.order}/6`,
    progress: status === MILESTONE_STATUS.DONE ? 100 : ((item.order - 1) / 6) * 100
  }
}

/**
 * Returns the complete, stable six-step studio activity list.
 *
 * The array always stays in the user-facing 1→6 order. `status` is presentation
 * state, while `canStart` is the execution gate: optional earlier activities do
 * not lock later ones, but real domain prerequisites (a built game or feedback)
 * do. App owns confirmation, travel and the arrival effect described by `route`.
 * Short free-roam activities can be persisted in `studio.todoProgress` using a
 * boolean or `{ done: true }`; production milestones are also inferred from the
 * meeting/game/arcade state so reloads cannot erase their completion.
 */
export function getStudioMilestones({ games = [], meeting = null, arcade = null, studio = null, map = 'office', taskActivity = null } = {}) {
  const progress = studio?.todoProgress || {}
  const authored = games.filter(game => game?.source === 'meeting')
  const activeGame = selectActiveProject(games, meeting, studio)
  const meetingActive = isMeetingActive(meeting)
  const initialMeetingActive = meetingActive && !meeting?.upgrade
  const upgradeMeetingActive = meetingActive && !!meeting?.upgrade
  const arcadeActive = !!arcade && ['running', 'summarizing'].includes(arcade.status)
  const terminalReport = !!arcade && ['done', 'report_error'].includes(arcade.status)
  const testedGame = activeGame && hasCurrentFeedback(activeGame)

  const teamDone = progressDone(progress, STUDIO_TODO.TEAM_INTERACTION) || !!taskActivity?.socialized
  const team = withState({
    id: STUDIO_TODO.TEAM_INTERACTION,
    order: 1,
    action: MILESTONE_ACTION.TEAM_INTERACTION,
    icon: '💬', tone: 'social', kicker: '자유 행동',
    title: '시비 걸기',
    detail: '팀원에게 다가가 말을 걸거나, 물건을 집어 던져 반응을 확인합니다.',
    confirmTitle: '팀원에게 다가가 상호작용할까요?',
    destination: '사무실의 가까운 팀원', actionLabel: '팀원에게 이동',
    arrivalNote: '도착하면 대화를 시작하거나 주변 물건을 집어 던질 수 있습니다.',
    repeatable: true,
    route: { map: 'office', target: 'nearest-teammate', arrival: 'team-interaction' }
  }, teamDone ? MILESTONE_STATUS.DONE : getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.TEAM_INTERACTION) ? MILESTONE_STATUS.LOCKED : MILESTONE_STATUS.AVAILABLE,
  getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.TEAM_INTERACTION))

  const playDone = progressDone(progress, STUDIO_TODO.PLAY_GAME) || !!taskActivity?.playedGame
  const hasPlayableGame = games.length > 0
  const play = withState({
    id: STUDIO_TODO.PLAY_GAME,
    order: 2,
    action: MILESTONE_ACTION.PLAY_GAME,
    icon: '🎮', tone: 'playing', kicker: '자유 행동',
    title: '게임하기',
    detail: hasPlayableGame ? '게임팩에서 원하는 게임을 골라 바로 플레이합니다.' : '플레이할 게임팩이 아직 없습니다.',
    confirmTitle: '게임팩을 열고 플레이할 게임을 고를까요?',
    destination: map === 'arcade' ? '오락실 게임 캐비닛' : '사무실 게임팩 진열대', actionLabel: '게임팩 고르기',
    arrivalNote: '도착하면 게임팩 목록이 열리고 원하는 게임을 실행할 수 있습니다.',
    repeatable: true,
    route: { map, target: map === 'arcade' ? 'game-cabinet' : 'game-shelf', arrival: 'open-library' }
  }, playDone ? MILESTONE_STATUS.DONE : hasPlayableGame && !getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.PLAY_GAME) ? MILESTONE_STATUS.AVAILABLE : MILESTONE_STATUS.LOCKED,
  getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.PLAY_GAME) || (hasPlayableGame ? '' : '플레이할 게임을 먼저 제작해 주세요.'))

  const createDone = progressDone(progress, STUDIO_TODO.CREATE_GAME) || authored.length > 0 || meeting?.status === 'done'
  const createStatus = initialMeetingActive
    ? MILESTONE_STATUS.ACTIVE
    : createDone ? MILESTONE_STATUS.DONE : MILESTONE_STATUS.AVAILABLE
  const createAction = initialMeetingActive ? MILESTONE_ACTION.RESUME_MEETING : MILESTONE_ACTION.NEW_MEETING
  const createConflict = !initialMeetingActive ? getMilestoneConflict({ meeting, arcade }, createAction) : ''
  const create = withState({
    id: STUDIO_TODO.CREATE_GAME,
    order: 3,
    action: createAction,
    icon: '✦', tone: initialMeetingActive ? 'building' : 'idle', kicker: initialMeetingActive ? '제작 진행 중' : '게임 제작',
    title: initialMeetingActive ? meeting.phaseLabel || '게임 제작 회의 진행 중' : '게임 제작 회의',
    detail: initialMeetingActive ? meeting.agenda || '진행 중인 제작 회의로 돌아갑니다.' : '회의실에서 팀원들과 새로운 게임의 방향을 정하고 실제 게임을 제작합니다.',
    confirmTitle: initialMeetingActive ? '진행 중인 제작 회의로 돌아갈까요?' : '새 게임 제작 회의를 시작할까요?',
    destination: initialMeetingActive ? '회의 진행 화면' : '사무실 회의실', actionLabel: initialMeetingActive ? '회의 열기' : '회의실로 이동',
    arrivalNote: initialMeetingActive ? '진행 중인 회의 화면이 열립니다.' : '도착하면 회의 안건 제출 화면이 열립니다.',
    repeatable: true,
    route: { map: 'office', target: 'meeting-room', arrival: initialMeetingActive ? 'open-meeting' : 'open-meeting-start' }
  }, createConflict && createStatus !== MILESTONE_STATUS.ACTIVE ? MILESTONE_STATUS.LOCKED : createStatus, createConflict)

  const interruptDone = progressDone(progress, STUDIO_TODO.INTERRUPT_MEETING) || !!taskActivity?.pausedMeeting || isExplicitlyPaused(meeting)
  const interruptStatus = isInterrupting(meeting)
    ? MILESTONE_STATUS.ACTIVE
    : isRunningMeeting(meeting) ? MILESTONE_STATUS.AVAILABLE
      : interruptDone ? MILESTONE_STATUS.DONE : MILESTONE_STATUS.LOCKED
  const interruptReason = isInterrupting(meeting)
    ? '회의 컨텍스트를 체크포인트에 저장하고 있습니다.'
    : interruptStatus === MILESTONE_STATUS.LOCKED
    ? '진행 중인 제작 회의가 있을 때 사용할 수 있습니다.'
    : interruptDone && !isRunningMeeting(meeting) ? '회의가 이미 안전하게 일시정지되었습니다.' : ''
  const interrupt = withState({
    id: STUDIO_TODO.INTERRUPT_MEETING,
    order: 4,
    action: MILESTONE_ACTION.INTERRUPT_MEETING,
    icon: 'Ⅱ', tone: interruptDone ? 'ready' : 'warning', kicker: '팀장 개입',
    title: isInterrupting(meeting) ? '회의를 안전하게 멈추는 중' : '중간에 회의 끊기',
    detail: '현재 멀티에이전트 컨텍스트를 체크포인트에 저장하고 제작 회의를 일시정지합니다.',
    confirmTitle: '현재 단계에서 회의를 안전하게 일시정지할까요?',
    destination: '회의 진행 화면', actionLabel: '회의 일시정지',
    arrivalNote: '회의 화면을 연 뒤 현재 컨텍스트를 저장하고 일시정지합니다.',
    route: { map: 'office', target: 'meeting-room', arrival: 'interrupt-meeting' }
  }, interruptStatus, interruptReason)

  let evaluationAction = MILESTONE_ACTION.START_PLAYTEST
  let evaluationStatus = testedGame ? MILESTONE_STATUS.DONE : activeGame ? MILESTONE_STATUS.AVAILABLE : MILESTONE_STATUS.LOCKED
  let evaluationTitle = activeGame ? `「${activeGame.title}」 게임 평가 받기` : '게임 평가 받기'
  let evaluationDestination = '오락실 테스트 캐비닛'
  let evaluationActionLabel = '20명 평가 시작'
  let evaluationArrival = 'start-playtest'
  if (arcadeActive) {
    evaluationAction = MILESTONE_ACTION.WATCH_PLAYTEST
    evaluationStatus = MILESTONE_STATUS.ACTIVE
    evaluationTitle = arcade.title ? `「${arcade.title}」 평가 진행 중` : 'AI 게임 평가 진행 중'
    evaluationDestination = '오락실 테스트 현장'
    evaluationActionLabel = '평가 현장 보기'
    evaluationArrival = 'watch-playtest'
  } else if (terminalReport && !arcade.reportSeen) {
    evaluationAction = MILESTONE_ACTION.VIEW_REPORT
    evaluationStatus = MILESTONE_STATUS.ACTIVE
    evaluationTitle = arcade.title ? `「${arcade.title}」 평가 결과` : '게임 평가 결과'
    evaluationDestination = '오락실 평가 리포트'
    evaluationActionLabel = '리포트 열기'
    evaluationArrival = 'view-report'
  }
  const evaluationConflict = evaluationStatus === MILESTONE_STATUS.AVAILABLE
    ? getMilestoneConflict({ meeting, arcade }, evaluationAction) : ''
  if (evaluationConflict) evaluationStatus = MILESTONE_STATUS.LOCKED
  const evaluation = withState({
    id: STUDIO_TODO.GET_EVALUATION,
    order: 5,
    action: evaluationAction,
    gameId: arcade?.gameId || activeGame?.id,
    icon: '◆', tone: evaluationStatus === MILESTONE_STATUS.DONE ? 'ready' : 'testing', kicker: 'AI 플레이테스트',
    title: evaluationTitle,
    detail: arcadeActive
      ? `AI 손님 ${Math.max(0, Number(arcade.progress) || 0)}/20명이 실제 게임을 플레이하고 있습니다.`
      : testedGame ? '현재 버전의 AI 플레이테스트와 평가 저장을 완료했습니다.'
        : activeGame ? '오락실에 게임을 배포하고 AI 손님 20명의 플레이 평가를 받습니다.' : '평가할 제작 게임이 아직 없습니다.',
    confirmTitle: evaluationAction === MILESTONE_ACTION.VIEW_REPORT ? '완료된 평가 리포트를 확인할까요?' : evaluationAction === MILESTONE_ACTION.WATCH_PLAYTEST ? '진행 중인 평가 현장으로 이동할까요?' : '게임을 배포하고 AI 평가를 시작할까요?',
    destination: evaluationDestination, actionLabel: evaluationActionLabel,
    arrivalNote: evaluationAction === MILESTONE_ACTION.START_PLAYTEST ? '도착하면 AI 손님 20명의 평가가 자동으로 시작됩니다.' : '도착하면 평가 화면이 자동으로 열립니다.',
    route: { map: 'arcade', target: 'playtest-observer', arrival: evaluationArrival }
  }, evaluationStatus, evaluationConflict || (!activeGame && !arcadeActive && !terminalReport ? '게임 제작 회의를 마치고 평가할 게임을 먼저 만들어 주세요.' : ''))

  const improvementDone = progressDone(progress, STUDIO_TODO.IMPROVE_GAME)
    || authored.some(isUpgradeRelease)
    || (!!meeting?.upgrade && meeting.status === 'done')
  let improvementStatus = upgradeMeetingActive
    ? MILESTONE_STATUS.ACTIVE
    : improvementDone ? MILESTONE_STATUS.DONE : testedGame ? MILESTONE_STATUS.AVAILABLE : MILESTONE_STATUS.LOCKED
  const improvementConflict = improvementStatus === MILESTONE_STATUS.AVAILABLE
    ? getMilestoneConflict({ meeting, arcade }, MILESTONE_ACTION.UPGRADE_MEETING) : ''
  if (improvementConflict) improvementStatus = MILESTONE_STATUS.LOCKED
  const improvement = withState({
    id: STUDIO_TODO.IMPROVE_GAME,
    order: 6,
    action: upgradeMeetingActive ? MILESTONE_ACTION.RESUME_MEETING : MILESTONE_ACTION.UPGRADE_MEETING,
    gameId: meeting?.gameId || activeGame?.id,
    icon: '↻', tone: improvementStatus === MILESTONE_STATUS.DONE ? 'ready' : 'building', kicker: '피드백 반영',
    title: upgradeMeetingActive ? meeting.phaseLabel || '게임 개선 회의 진행 중' : activeGame ? `「${activeGame.title}」 게임 개선하기` : '게임 개선하기',
    detail: upgradeMeetingActive ? meeting.agenda || '진행 중인 개선 회의로 돌아갑니다.'
      : improvementDone ? '평가 피드백을 반영한 개선 버전 출시를 완료했습니다.'
        : testedGame ? `평균 ${activeGame.feedback[activeGame.version]?.avg ?? '-'} / 10 평가와 제안사항을 다음 버전에 반영합니다.`
          : '현재 버전 평가 피드백을 받은 뒤 개선할 수 있습니다.',
    confirmTitle: upgradeMeetingActive ? '진행 중인 개선 회의로 돌아갈까요?' : '평가 피드백으로 개선 회의를 시작할까요?',
    destination: upgradeMeetingActive ? '회의 진행 화면' : '사무실 회의실', actionLabel: upgradeMeetingActive ? '개선 회의 열기' : '개선 회의 시작',
    arrivalNote: upgradeMeetingActive ? '진행 중인 개선 회의 화면이 열립니다.' : '도착하면 평가 피드백이 연결된 개선 회의 화면이 열립니다.',
    route: { map: 'office', target: 'meeting-room', arrival: upgradeMeetingActive ? 'open-meeting' : 'open-upgrade-meeting' }
  }, improvementStatus, improvementConflict || (!testedGame && !improvementDone && !upgradeMeetingActive ? '현재 버전의 게임 평가를 먼저 완료해 주세요.' : ''))

  return [team, play, create, interrupt, evaluation, improvement]
}

export function getStudioMilestoneById(state, id) {
  return getStudioMilestones(state).find(item => item.id === id) || null
}

export function getMilestoneConflict({ meeting = null, arcade = null } = {}, action) {
  if (action === MILESTONE_ACTION.INTERRUPT_MEETING && !isRunningMeeting(meeting)) return '현재 진행 중인 제작 회의가 없습니다.'
  if (isMeetingActive(meeting) && ![MILESTONE_ACTION.RESUME_MEETING, MILESTONE_ACTION.INTERRUPT_MEETING].includes(action)) return '진행 중이거나 일시정지된 제작 회의를 먼저 마쳐 주세요.'
  if (arcade && ['running', 'summarizing'].includes(arcade.status) && action !== MILESTONE_ACTION.WATCH_PLAYTEST) return '진행 중인 플레이테스트를 먼저 완료해 주세요.'
  return ''
}

export function getStudioMilestone({ games = [], meeting = null, arcade = null, studio = null, map = 'office' } = {}) {
  const meetingActive = isMeetingActive(meeting)
  const arcadeActive = arcade && ['running', 'summarizing'].includes(arcade.status)

  if (meetingActive) {
    const phaseIndex = Math.max(0, PHASES.findIndex(phase => phase.key === meeting.phase))
    const paused = isMeetingPaused(meeting)
    const runtime = meetingStatusCopy(meeting)
    return {
      action: MILESTONE_ACTION.RESUME_MEETING,
      icon: paused ? 'Ⅱ' : '✦', tone: paused ? 'warning' : 'building', kicker: runtime.label,
      title: paused ? `${meeting.phaseLabel || PHASES[phaseIndex]?.label || '제작 회의'} · 개입 대기` : meeting.phaseLabel || PHASES[phaseIndex]?.label || '제작 현황 확인',
      detail: paused ? '전체 팀 컨텍스트가 체크포인트에 보존되어 있습니다. 지시를 더하거나 그대로 재개할 수 있습니다.' : meeting.agenda || '팀의 제작 논의를 이어서 확인합니다.',
      confirmTitle: paused ? '일시정지된 제작 회의를 열까요?' : '진행 중인 제작 회의로 돌아갈까요?',
      destination: '회의 진행 화면', actionLabel: paused ? '열고 재개' : '회의 열기',
      arrivalNote: paused ? '도착하면 팀장 개입과 재개 화면이 열립니다.' : '진행 중인 회의 화면이 자동으로 열립니다.',
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
