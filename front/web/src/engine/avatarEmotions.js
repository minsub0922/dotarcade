// DOTCADE — bounded, reusable avatar emotion state + canvas renderer.
//
// The system is intentionally independent from the autonomy planner. World
// events may offer emotion cues, but this module owns probability, priority and
// cooldown decisions so a fast observe/plan/action loop cannot spam emotes.

export const AVATAR_EMOTIONS = Object.freeze({
  happy: Object.freeze({ emoji: '😊', color: '#65d69a', ink: '#17613e', priority: 1, durationMs: 1900 }),
  focused: Object.freeze({ emoji: '🎯', color: '#69bff8', ink: '#184f79', priority: 1, durationMs: 2200 }),
  excited: Object.freeze({ emoji: '🤩', color: '#ffd45f', ink: '#72510a', priority: 2, durationMs: 2050 }),
  nervous: Object.freeze({ emoji: '😰', color: '#a9b8ef', ink: '#3f4d85', priority: 2, durationMs: 1850 }),
  annoyed: Object.freeze({ emoji: '💢', color: '#ff8b91', ink: '#7c2830', priority: 3, durationMs: 1900 }),
  proud: Object.freeze({ emoji: '⭐', color: '#c997f2', ink: '#5c347b', priority: 2, durationMs: 2250 })
})

export const EMOTION_LIMITS = Object.freeze({
  minGapMs: 3800,
  kindCooldownMs: 9800,
  sourceCooldownMs: 6800,
  ambientMinMs: 7200,
  ambientMaxMs: 13800,
  minDurationMs: 900,
  maxDurationMs: 3200,
  historySize: 6
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const kindOf = value => typeof value === 'string' ? value : value?.kind || ''
const activityOf = context => kindOf(context?.activity) || ''
const goalOf = context => kindOf(context?.goal) || ''

const weighted = (...entries) => entries.map(([kind, weight]) => ({ kind, weight }))

// Pure cue policy. Keeping this separate makes the semantic mapping testable
// without constructing a world or relying on random timing.
export function emotionRuleForCue(cue, context = {}) {
  const goal = goalOf(context)
  const activity = activityOf(context) || goal

  if (cue === 'goal-start') {
    if (goal === 'work') return { chance: .46, candidates: weighted(['focused', 1]) }
    if (goal === 'socialize') return { chance: .38, candidates: weighted(['happy', .76], ['excited', .24]) }
    if (goal === 'portablePlay') return { chance: .48, candidates: weighted(['focused', .36], ['happy', .3], ['excited', .34]) }
    if (goal === 'arcadePlay') return { chance: .54, candidates: weighted(['excited', .62], ['nervous', .22], ['focused', .16]) }
    if (goal === 'returnHome') return { chance: .13, candidates: weighted(['focused', 1]) }
    if (goal === 'wander') return { chance: .09, candidates: weighted(['happy', 1]) }
    return null
  }

  if (cue === 'goal-success') {
    if (goal === 'work') return { chance: .42, candidates: weighted(['proud', .7], ['focused', .3]) }
    if (goal === 'socialize') return { chance: .45, candidates: weighted(['happy', .76], ['proud', .24]) }
    if (goal === 'portablePlay' || goal === 'arcadePlay') {
      return { chance: .52, candidates: weighted(['proud', .38], ['happy', .34], ['excited', .28]) }
    }
    return { chance: .12, candidates: weighted(['happy', .65], ['proud', .35]) }
  }

  if (cue === 'goal-failed') {
    return { chance: .34, candidates: weighted(['annoyed', .58], ['nervous', .42]) }
  }

  if (cue === 'activity-start') {
    if (activity === 'work') return { chance: .48, candidates: weighted(['focused', .86], ['proud', .14]) }
    if (activity === 'portablePlay' || activity === 'portable-play') {
      return { chance: .54, candidates: weighted(['focused', .3], ['happy', .3], ['excited', .4]) }
    }
    if (activity === 'arcadePlay' || activity === 'arcade-play') {
      return { chance: .6, candidates: weighted(['excited', .6], ['nervous', .22], ['focused', .18]) }
    }
    return null
  }

  if (cue === 'social-start') return { chance: .34, candidates: weighted(['happy', .74], ['excited', .26]) }
  if (cue === 'social-turn') return { chance: .18, candidates: weighted(['happy', .82], ['excited', .18]) }
  if (cue === 'social-complete') return { chance: .4, candidates: weighted(['happy', .68], ['proud', .32]) }
  if (cue === 'player-mount') return { chance: .7, candidates: weighted(['excited', .8], ['happy', .2]) }
  if (cue === 'player-pickup') return { chance: .42, candidates: weighted(['focused', .78], ['excited', .22]) }
  if (cue === 'player-throw') return { chance: .56, candidates: weighted(['excited', .66], ['nervous', .34]) }
  return null
}

function ambientRule(context = {}) {
  const activity = activityOf(context)
  const goal = goalOf(context)
  if (activity === 'socialize') return { chance: .34, candidates: weighted(['happy', .78], ['excited', .22]) }
  if (activity === 'work') return { chance: .36, candidates: weighted(['focused', .8], ['proud', .2]) }
  if (activity === 'portablePlay' || activity === 'portable-play' || context.handheld) {
    return { chance: .4, candidates: weighted(['focused', .28], ['happy', .3], ['excited', .42]) }
  }
  if (activity === 'arcadePlay' || activity === 'arcade-play' || context.playingGame) {
    return { chance: .43, candidates: weighted(['excited', .48], ['nervous', .2], ['proud', .32]) }
  }
  if (context.mounted) return { chance: .25, candidates: weighted(['excited', .72], ['happy', .28]) }
  if (context.holding) return { chance: .16, candidates: weighted(['focused', .72], ['nervous', .28]) }
  if (goal) return emotionRuleForCue('goal-start', { goal })
  return null
}

function contextKey(context = {}) {
  const activity = activityOf(context)
  const goal = goalOf(context)
  if (activity) return `activity:${activity}`
  if (context.handheld) return 'activity:portablePlay'
  if (context.playingGame) return 'activity:arcadePlay'
  if (context.mounted) return 'player:mounted'
  if (context.holding) return 'player:holding'
  if (goal) return `goal:${goal}`
  return 'idle'
}

function entityId(entityOrId) {
  return typeof entityOrId === 'string' ? entityOrId : entityOrId?.id
}

function drawExpressionFace(ctx, kind, ink) {
  ctx.save()
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineWidth = 1.8
  ctx.lineCap = 'round'
  const browY = -4.5
  const eyeY = -.5

  if (kind === 'happy' || kind === 'proud') {
    ctx.beginPath()
    ctx.arc(-5, eyeY, 2.6, .18, Math.PI - .18)
    ctx.moveTo(2.4, eyeY)
    ctx.arc(5, eyeY, 2.6, .18, Math.PI - .18)
    ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 3, kind === 'proud' ? 6 : 5, .2, Math.PI - .2); ctx.stroke()
  } else if (kind === 'excited') {
    for (const x of [-5, 5]) {
      ctx.beginPath()
      ctx.moveTo(x - 2.4, eyeY); ctx.lineTo(x + 2.4, eyeY)
      ctx.moveTo(x, eyeY - 2.4); ctx.lineTo(x, eyeY + 2.4)
      ctx.stroke()
    }
    ctx.beginPath(); ctx.ellipse(0, 6, 3.2, 4.2, 0, 0, Math.PI * 2); ctx.stroke()
  } else if (kind === 'focused' || kind === 'annoyed') {
    const tilt = kind === 'annoyed' ? 2.6 : 1.4
    ctx.beginPath()
    ctx.moveTo(-8, browY - tilt); ctx.lineTo(-2, browY + tilt)
    ctx.moveTo(2, browY + tilt); ctx.lineTo(8, browY - tilt)
    ctx.stroke()
    ctx.beginPath(); ctx.arc(-5, eyeY + 1, 1.35, 0, Math.PI * 2); ctx.arc(5, eyeY + 1, 1.35, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath()
    if (kind === 'annoyed') ctx.arc(0, 10, 5, Math.PI + .22, Math.PI * 2 - .22)
    else { ctx.moveTo(-4.5, 7); ctx.lineTo(4.5, 7) }
    ctx.stroke()
  } else if (kind === 'nervous') {
    ctx.beginPath()
    ctx.moveTo(-8, browY + 1); ctx.quadraticCurveTo(-5, browY - 3, -2, browY)
    ctx.moveTo(2, browY); ctx.quadraticCurveTo(5, browY - 3, 8, browY + 1)
    ctx.stroke()
    ctx.beginPath(); ctx.arc(-5, eyeY + 1, 1.5, 0, Math.PI * 2); ctx.arc(5, eyeY + 1, 1.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-5, 7); ctx.quadraticCurveTo(-2.5, 4.5, 0, 7); ctx.quadraticCurveTo(2.5, 9.5, 5, 7); ctx.stroke()
    ctx.fillStyle = '#79c9f3'; ctx.beginPath(); ctx.ellipse(10, 3, 1.7, 3, -.18, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

export class AvatarEmotionSystem {
  constructor({ random = Math.random, limits = {}, onEmotion = null } = {}) {
    this.random = random
    this.limits = { ...EMOTION_LIMITS, ...limits }
    this.onEmotion = typeof onEmotion === 'function' ? onEmotion : null
    this.states = new Map()
  }

  _scheduleAmbient(state, now, multiplier = 1) {
    const span = Math.max(0, this.limits.ambientMaxMs - this.limits.ambientMinMs)
    const delay = (this.limits.ambientMinMs + this.random() * span) * multiplier
    state.nextAmbientAt = now + delay
  }

  _state(entityOrId, now = 0) {
    const id = entityId(entityOrId)
    if (!id) return null
    let state = this.states.get(id)
    if (!state) {
      state = {
        id,
        entity: typeof entityOrId === 'object' ? entityOrId : null,
        current: null,
        lastAt: Number.NEGATIVE_INFINITY,
        nextAmbientAt: 0,
        contextKey: 'idle',
        kindCooldowns: new Map(),
        sourceCooldowns: new Map(),
        history: []
      }
      this._scheduleAmbient(state, now)
      this.states.set(id, state)
    } else if (typeof entityOrId === 'object') state.entity = entityOrId
    return state
  }

  _clearCurrent(state) {
    if (!state) return false
    const entity = state.entity
    if (entity?.meta?.avatarEmotion) delete entity.meta.avatarEmotion
    if (!state.current) return false
    state.current = null
    return true
  }

  _expire(state, now) {
    if (!state) return
    const entity = state.entity
    const reactionUntil = Math.max(
      Number(entity?.meta?.reactionLockUntil) || 0,
      Number(entity?.meta?.reactionUntil) || 0
    )
    if (reactionUntil > now) {
      this._clearCurrent(state)
      state.nextAmbientAt = Math.max(state.nextAmbientAt, reactionUntil + 800)
      return
    }
    if (state.current && now >= state.current.until) this._clearCurrent(state)
  }

  _pickCandidate(state, candidates, now) {
    const available = (candidates || [])
      .filter(item => AVATAR_EMOTIONS[item.kind] && (state.kindCooldowns.get(item.kind) || 0) <= now)
    if (!available.length) return null
    const lastKind = state.history.at(-1)?.kind
    const varied = available.some(item => item.kind !== lastKind)
      ? available.filter(item => item.kind !== lastKind)
      : available
    const total = varied.reduce((sum, item) => sum + Math.max(0, item.weight || 0), 0)
    if (total <= 0) return varied[0] || null
    let roll = this.random() * total
    for (const item of varied) {
      roll -= Math.max(0, item.weight || 0)
      if (roll <= 0) return item
    }
    return varied.at(-1) || null
  }

  express(entity, kind, {
    now = 0,
    source = 'manual',
    durationMs = null,
    priority = null
  } = {}) {
    const style = AVATAR_EMOTIONS[kind]
    if (!entity?.id || !style) return null
    entity.meta ||= {}
    const state = this._state(entity, now)
    this._expire(state, now)

    const reactionUntil = Math.max(Number(entity.meta.reactionLockUntil) || 0, Number(entity.meta.reactionUntil) || 0)
    if (reactionUntil > now) return null

    const nextPriority = priority ?? style.priority
    if (state.current) {
      if (state.current.kind === kind) return null
      if (state.current.priority >= nextPriority && state.current.until - now > 320) return null
    }
    if (now - state.lastAt < this.limits.minGapMs) return null
    if ((state.kindCooldowns.get(kind) || 0) > now) return null
    if ((state.sourceCooldowns.get(source) || 0) > now) return null

    const duration = clamp(durationMs ?? style.durationMs, this.limits.minDurationMs, this.limits.maxDurationMs)
    const emotion = {
      kind,
      emoji: style.emoji,
      source,
      priority: nextPriority,
      startedAt: now,
      until: now + duration
    }
    state.current = emotion
    state.lastAt = now
    state.kindCooldowns.set(kind, now + this.limits.kindCooldownMs)
    state.sourceCooldowns.set(source, now + this.limits.sourceCooldownMs)
    state.history.push({ kind, source, at: now })
    state.history = state.history.slice(-this.limits.historySize)
    this._scheduleAmbient(state, now)
    entity.meta.avatarEmotion = { ...emotion }
    this.onEmotion?.({ type: 'avatar-emotion', agent: entity, emotion: { ...emotion } })
    return { ...emotion }
  }

  _tryRule(entity, rule, { now, source }) {
    if (!rule?.candidates?.length) return null
    const state = this._state(entity, now)
    this._expire(state, now)
    if ((state.sourceCooldowns.get(source) || 0) > now) return null

    // Repeating the only available emotion is possible after its hard cooldown,
    // but much less likely than a varied response.
    const lastKind = state.history.at(-1)?.kind
    const allRepeat = rule.candidates.every(item => item.kind === lastKind)
    const chance = clamp(rule.chance * (allRepeat ? .42 : 1), 0, 1)
    if (this.random() >= chance) return null
    const candidate = this._pickCandidate(state, rule.candidates, now)
    if (!candidate) return null
    const style = AVATAR_EMOTIONS[candidate.kind]
    const jitter = .9 + this.random() * .2
    return this.express(entity, candidate.kind, {
      now,
      source,
      durationMs: style.durationMs * jitter
    })
  }

  cue(entity, cue, context = {}) {
    const now = Number(context.now) || 0
    const rule = emotionRuleForCue(cue, context)
    const detail = activityOf(context) || goalOf(context) || 'general'
    return this._tryRule(entity, rule, { now, source: context.source || `${cue}:${detail}` })
  }

  observe(entity, context = {}) {
    if (!entity?.id) return null
    const now = Number(context.now) || 0
    const state = this._state(entity, now)
    this._expire(state, now)
    const key = contextKey(context)
    if (key !== state.contextKey) {
      state.contextKey = key
      // Event cues handle the immediate transition. Ambient emotion waits long
      // enough that entering an activity cannot double-fire in the same beat.
      state.nextAmbientAt = Math.max(state.nextAmbientAt, now + 2200)
    }
    if (now < state.nextAmbientAt) return null
    this._scheduleAmbient(state, now, key === 'idle' ? 1.7 : 1)
    const rule = ambientRule(context)
    return this._tryRule(entity, rule, { now, source: `ambient:${key}` })
  }

  update({ now = 0, entities = [] } = {}) {
    for (const entity of entities) {
      const state = this.states.get(entity?.id)
      if (!state) continue
      state.entity = entity
      this._expire(state, now)
    }
  }

  current(entityOrId, now = 0) {
    const state = this.states.get(entityId(entityOrId))
    if (!state) return null
    if (typeof entityOrId === 'object') state.entity = entityOrId
    this._expire(state, now)
    return state.current ? { ...state.current } : null
  }

  snapshot(entityOrId, now = 0) {
    const state = this.states.get(entityId(entityOrId))
    if (!state) return null
    this._expire(state, now)
    return {
      current: state.current ? { ...state.current } : null,
      nextAmbientAt: state.nextAmbientAt,
      context: state.contextKey,
      history: state.history.map(item => ({ ...item }))
    }
  }

  clear(entityOrId, { forget = false } = {}) {
    const state = this.states.get(entityId(entityOrId))
    if (!state) return false
    if (typeof entityOrId === 'object') state.entity = entityOrId
    this._clearCurrent(state)
    if (forget) this.states.delete(state.id)
    return true
  }

  forget(entityOrId) {
    return this.clear(entityOrId, { forget: true })
  }

  reset(entities = []) {
    for (const entity of entities) this.clear(entity)
    for (const state of this.states.values()) this._clearCurrent(state)
    this.states.clear()
  }

  draw(ctx, entity, now, {
    spriteHeight = 68,
    drawWidth = 47,
    bob = 0,
    reduceMotion = false,
    faceImage = null
  } = {}) {
    const emotion = this.current(entity, now)
    if (!ctx || !emotion) return false
    const style = AVATAR_EMOTIONS[emotion.kind]
    if (!style) return false
    const reactionUntil = Math.max(Number(entity.meta?.reactionLockUntil) || 0, Number(entity.meta?.reactionUntil) || 0)
    if (reactionUntil > now) return false

    const elapsed = Math.max(0, now - emotion.startedAt)
    const remaining = Math.max(0, emotion.until - now)
    const alpha = Math.min(1, elapsed / 150, remaining / 300)
    const pop = reduceMotion ? 1 : 1 + Math.sin(Math.min(1, elapsed / 220) * Math.PI) * .13
    const float = reduceMotion ? 0 : Math.sin(now / 170 + entity.x * .025) * 1.4
    const side = entity.bubble ? (entity.dir === 'right' ? -1 : 1) : 1
    const x = entity.x + side * (drawWidth / 2 + 13)
    const y = entity.y - spriteHeight + 11 + bob + float
    const hasFace = !!(faceImage?.complete && faceImage.naturalWidth)
    const size = hasFace ? 36 : 27

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(Math.round(x), Math.round(y))
    ctx.scale(pop, pop)

    if (!reduceMotion && ['excited', 'annoyed', 'proud'].includes(emotion.kind)) {
      ctx.strokeStyle = style.color
      ctx.lineWidth = 2
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2 + now / 700
        ctx.beginPath()
        ctx.moveTo(Math.cos(angle) * 17, Math.sin(angle) * 17)
        ctx.lineTo(Math.cos(angle) * 21, Math.sin(angle) * 21)
        ctx.stroke()
      }
    }

    ctx.shadowColor = 'rgba(14,15,24,.28)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 3
    ctx.fillStyle = 'rgba(255,255,255,.97)'
    ctx.strokeStyle = style.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(-size / 2, -size / 2, size, size, 9)
    ctx.fill()
    ctx.stroke()
    ctx.shadowColor = 'transparent'

    ctx.fillStyle = style.color
    ctx.beginPath()
    ctx.moveTo(-side * 7, size / 2 - 1)
    ctx.lineTo(-side * 2, size / 2 + 6)
    ctx.lineTo(side * 1, size / 2 - 1)
    ctx.closePath()
    ctx.fill()

    if (hasFace) {
      ctx.save()
      ctx.beginPath(); ctx.arc(0, 0, size / 2 - 3, 0, Math.PI * 2); ctx.clip()
      ctx.drawImage(faceImage, -size / 2 + 2, -size / 2 + 2, size - 4, size - 4)
      ctx.fillStyle = `${style.color}24`
      ctx.fillRect(-size / 2, -size / 2, size, size)
      ctx.restore()
      drawExpressionFace(ctx, emotion.kind, style.ink)

      ctx.fillStyle = style.color
      ctx.beginPath(); ctx.arc(size / 2 - 2, size / 2 - 2, 7.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '9px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(style.emoji, size / 2 - 2, size / 2 - 1.5)
    } else {
      ctx.fillStyle = style.ink
      ctx.font = '17px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(style.emoji, 0, 1)
    }
    ctx.restore()
    return true
  }
}
