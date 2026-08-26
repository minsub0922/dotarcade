const DEFAULT_COLOR = '#6658d7'

const clean = value => typeof value === 'string' ? value.trim() : ''

const personaSummary = persona => {
  const lines = clean(persona).split('\n').map(line => line.trim()).filter(Boolean)
  const publicLine = lines.find(line => /^(성격|관심|소개)\s*:/.test(line))
  return publicLine?.replace(/^[^:]+:\s*/, '') || ''
}

/**
 * Public, read-only shape consumed by AvatarProfile.
 *
 * Required: { id, name }
 * Optional: { sprite, imageSrc, color, role, title, job, age, online,
 *             status, activity, currentActivity, summary, bio, persona,
 *             bmad, specialty, ambient }
 */
export function getAvatarProfile(avatar) {
  if (!avatar?.id || !clean(avatar.name)) return null

  const title = clean(avatar.title) || clean(avatar.role) || clean(avatar.job) || '스튜디오 멤버'
  const role = clean(avatar.role) || clean(avatar.job)
  const activity = clean(avatar.currentActivity) || clean(avatar.activity) || clean(avatar.ambient?.[0])
  const summary = clean(avatar.summary) || clean(avatar.bio) || personaSummary(avatar.persona)
  const specialty = clean(avatar.specialty) || clean(avatar.bmad)
  const online = avatar.online !== false
  const age = avatar.age !== '' && Number.isFinite(Number(avatar.age)) ? Number(avatar.age) : null

  return {
    id: String(avatar.id),
    name: clean(avatar.name),
    title,
    role: role && role !== title ? role : '',
    age,
    color: clean(avatar.color) || DEFAULT_COLOR,
    imageSrc: clean(avatar.imageSrc) || `/assets/sprites_v2/${clean(avatar.sprite) || avatar.id}/face.png`,
    online,
    status: clean(avatar.status) || (online ? '온라인' : '자리 비움'),
    activity,
    summary,
    specialty
  }
}
