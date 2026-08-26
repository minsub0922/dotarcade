export const ACTIVE_MEETING_STATUSES = Object.freeze([
  'running',
  'pausing',
  'paused',
  'resuming',
  'interrupting',
  'interrupted',
  'waiting_for_human',
  'error'
])

const ACTIVE = new Set(ACTIVE_MEETING_STATUSES)

export function meetingStatus(value) {
  return typeof value === 'string' ? value : value?.status || ''
}

export function isMeetingActive(value) {
  return ACTIVE.has(meetingStatus(value))
}

export function isMeetingPaused(value) {
  return ['paused', 'interrupted', 'waiting_for_human', 'error'].includes(meetingStatus(value))
}

export function isMeetingTransitioning(value) {
  const status = meetingStatus(value)
  return status === 'pausing' || status === 'resuming' || status === 'interrupting'
}

export function meetingStatusCopy(value) {
  switch (meetingStatus(value)) {
    case 'pausing': return { label: '안전하게 일시정지 중', tone: 'saving' }
    case 'interrupting': return { label: '안전하게 일시정지 중', tone: 'saving' }
    case 'paused': return { label: '팀장 개입 대기', tone: 'paused' }
    case 'interrupted': return { label: '팀장 개입 대기', tone: 'paused' }
    case 'waiting_for_human': return { label: '팀장 개입 대기', tone: 'paused' }
    case 'resuming': return { label: '컨텍스트 복원 중', tone: 'saving' }
    case 'running': return { label: '회의 진행 중', tone: 'running' }
    case 'done': return { label: '회의 완료', tone: 'done' }
    case 'cancelled': return { label: '회의 종료', tone: 'cancelled' }
    case 'error': return { label: '회의 오류', tone: 'error' }
    default: return { label: '회의 상태 확인 중', tone: 'idle' }
  }
}
