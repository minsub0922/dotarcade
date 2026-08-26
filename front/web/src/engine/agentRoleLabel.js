const DEFAULT_ROLE_COLOR = '#8a93c6'

const clean = value => typeof value === 'string' ? value.trim() : ''

export function getAgentRoleLabel(entity) {
  const text = clean(entity?.meta?.role)
  if (!text) return null
  return {
    text,
    color: clean(entity?.color) || DEFAULT_ROLE_COLOR
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius)
  else ctx.rect(x, y, width, height)
}

/** Draws a compact, team-colored role chip above an avatar's visible head. */
export function drawAgentRoleLabel(ctx, entity, { drawHeight = 79, bob = 0 } = {}) {
  const role = getAgentRoleLabel(entity)
  if (!ctx || !role || !Number.isFinite(entity?.x) || !Number.isFinite(entity?.y)) return null

  ctx.save()
  ctx.font = `800 11px "Segoe UI", "Apple SD Gothic Neo", sans-serif`
  const height = 20
  const width = Math.max(36, ctx.measureText(role.text).width + 16)
  const x = entity.x - width / 2
  const y = entity.y - Math.max(0, drawHeight) - height - 5 + bob

  roundedRect(ctx, x - 1, y - 1, width + 2, height + 2, 9)
  ctx.fillStyle = 'rgba(21,22,29,.9)'
  ctx.fill()
  roundedRect(ctx, x, y, width, height, 8)
  ctx.fillStyle = role.color
  ctx.fill()

  ctx.fillStyle = '#161820'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(role.text, entity.x, y + height / 2 + .5)
  ctx.restore()

  return { ...role, x, y, width, height }
}
