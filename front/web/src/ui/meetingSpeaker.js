import { PLAYER, TEAM } from '../data/personas.js'

const SPEAKERS = new Map([PLAYER, ...TEAM].map(person => [person.id, person]))

export function getMeetingSpeaker(id) {
  if (!id || id === 'system') return null
  const person = SPEAKERS.get(id)
  const sprite = person?.sprite || 'pm'
  return {
    id,
    name: person?.name || String(id),
    role: person?.role || '',
    color: person?.color || '#8a93c6',
    faceSrc: `/assets/sprites_v2/${sprite}/face.png`
  }
}

export function meetingEntryKindLabel(kind) {
  if (kind === 'qa') return 'QA'
  if (kind === 'note') return '조사 메모'
  return ''
}
