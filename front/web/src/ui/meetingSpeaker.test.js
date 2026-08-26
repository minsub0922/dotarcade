import test from 'node:test'
import assert from 'node:assert/strict'
import { getMeetingSpeaker, meetingEntryKindLabel } from './meetingSpeaker.js'

test('team members expose their concise role and canonical color in meetings', () => {
  assert.deepEqual(
    getMeetingSpeaker('dev1'),
    {
      id: 'dev1',
      name: '이도현',
      role: '시니어 개발자',
      color: '#41c7b8',
      faceSrc: '/assets/sprites_v2/dev1/face.png'
    }
  )
})

test('player name and role stay separate so 팀장 is not duplicated', () => {
  const player = getMeetingSpeaker('player')
  assert.equal(player.name, '나')
  assert.equal(player.role, '팀장')
})

test('unknown speakers fall back safely and system has no identity badge', () => {
  assert.equal(getMeetingSpeaker('system'), null)
  assert.deepEqual(getMeetingSpeaker('reviewer'), {
    id: 'reviewer',
    name: 'reviewer',
    role: '',
    color: '#8a93c6',
    faceSrc: '/assets/sprites_v2/pm/face.png'
  })
})

test('message kind remains distinct from the participant role', () => {
  assert.equal(meetingEntryKindLabel('qa'), 'QA')
  assert.equal(meetingEntryKindLabel('note'), '조사 메모')
  assert.equal(meetingEntryKindLabel('talk'), '')
})
