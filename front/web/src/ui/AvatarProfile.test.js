import test from 'node:test'
import assert from 'node:assert/strict'
import { getAvatarProfile } from './avatarProfile.js'

test('normalizes the existing team member shape into a public profile', () => {
  const profile = getAvatarProfile({
    id: 'designer',
    name: '김다은',
    role: '디자이너',
    title: '도트 아티스트 · UX 디자이너',
    sprite: 'designer',
    age: 29,
    bmad: 'UX Designer — 아트 스펙 단계 담당',
    ambient: ['팔레트 다시 뽑는 중']
  })

  assert.deepEqual(
    {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      status: profile.status,
      activity: profile.activity,
      imageSrc: profile.imageSrc
    },
    {
      id: 'designer',
      name: '김다은',
      role: '디자이너',
      status: '온라인',
      activity: '팔레트 다시 뽑는 중',
      imageSrc: '/assets/sprites_v2/designer/face.png'
    }
  )
})

test('supports visitor and offline states without requiring team-only fields', () => {
  const profile = getAvatarProfile({
    id: 'v01',
    name: '민준',
    job: '초등학생',
    age: 11,
    online: false,
    status: '평가 종료',
    persona: '이름: 민준.\n성격: 쉬운 게임을 좋아하고 솔직하게 평가한다.'
  })

  assert.equal(profile.title, '초등학생')
  assert.equal(profile.role, '')
  assert.equal(profile.online, false)
  assert.equal(profile.status, '평가 종료')
  assert.equal(profile.summary, '쉬운 게임을 좋아하고 솔직하게 평가한다.')
  assert.equal(profile.imageSrc, '/assets/sprites_v2/v01/face.png')
})

test('requires an id and display name', () => {
  assert.equal(getAvatarProfile(null), null)
  assert.equal(getAvatarProfile({ id: 'pm' }), null)
  assert.equal(getAvatarProfile({ name: '박서준' }), null)
})
