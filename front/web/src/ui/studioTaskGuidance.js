const isActionable = task => !!task && task.enabled !== false && task.status !== 'locked'

const matchesRecommended = (task, recommended) => {
  if (!task || !recommended) return false
  if (recommended.id && task.id === recommended.id) return true
  if (!recommended.action || task.action !== recommended.action) return false
  return !recommended.gameId || !task.gameId || task.gameId === recommended.gameId
}

export function studioTaskKey(task) {
  return task ? [task.id, task.action, task.gameId].filter(Boolean).join(':') : ''
}

export function selectGuidedTask(tasks = [], recommended = null) {
  const actionable = tasks.filter(isActionable)
  return actionable.find(task => task.status === 'active')
    || actionable.find(task => task.status !== 'done' && matchesRecommended(task, recommended))
    || actionable.find(task => task.status === 'available')
    || actionable.find(task => task.status === 'done' && task.repeatable)
    || null
}

export function getTaskGuidance(task) {
  if (!task) return null
  const locked = task.status === 'locked' || (task.enabled === false && task.status !== 'done')
  if (locked) {
    return {
      label: '해제 조건',
      text: task.blockReason || task.detail || '앞 단계를 먼저 완료해 주세요.',
      destination: '',
      actionLabel: '조건 확인',
      locked: true
    }
  }

  const repeatableDone = task.status === 'done' && task.repeatable
  return {
    label: task.status === 'active'
      ? '진행 중 · 계속하기'
      : repeatableDone ? '완료 · 다시 할 수 있어요' : '추천 · 지금 할 수 있어요',
    text: task.guide || task.arrivalNote || task.detail || '',
    destination: task.destination || '',
    actionLabel: task.actionLabel || (task.status === 'active' ? '계속하기' : '안내 시작'),
    locked: false
  }
}
