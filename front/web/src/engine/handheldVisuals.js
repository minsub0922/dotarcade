export const POCKET_STATION = {
  id: 'office-pocket',
  map: 'office',
  kind: 'handheldStation',
  label: 'DOTCADE POCKET 충전 스테이션',
  tile: [9, 16],
  interactive: true,
  color: '#a9d873',
  dir: 'down'
}

export const isPocketStation = object => object?.kind === 'handheldStation' || object?.id === POCKET_STATION.id

export function drawPocketStation(ctx, station, time = 0, reduceMotion = false) {
  const pulse = reduceMotion ? .55 : .48 + Math.sin(time / 330) * .12
  ctx.save()
  ctx.translate(station.x, station.y)

  ctx.fillStyle = 'rgba(20,24,23,.28)'
  ctx.beginPath(); ctx.ellipse(0, 3, 27, 8, 0, 0, Math.PI * 2); ctx.fill()

  ctx.shadowColor = `rgba(159,236,106,${pulse})`
  ctx.shadowBlur = 13
  ctx.fillStyle = '#313b38'
  ctx.beginPath(); ctx.roundRect(-25, -13, 50, 16, 5); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#53615a'; ctx.fillRect(-20, -10, 40, 7)
  ctx.fillStyle = '#222b29'; ctx.fillRect(-15, -47, 30, 37)
  ctx.fillStyle = '#87957e'; ctx.fillRect(-13, -45, 26, 33)

  // Docked Game Boy-like unit.
  ctx.fillStyle = '#c7d1b5'
  ctx.beginPath(); ctx.roundRect(-14, -70, 28, 37, 5); ctx.fill()
  ctx.fillStyle = '#303a38'
  ctx.beginPath(); ctx.roundRect(-10, -66, 20, 14, 3); ctx.fill()
  ctx.fillStyle = `rgba(164,240,113,${.72 + pulse * .25})`; ctx.fillRect(-7, -63, 14, 8)
  ctx.fillStyle = '#435043'; ctx.fillRect(-9, -47, 8, 3); ctx.fillRect(-6, -50, 3, 9)
  ctx.fillStyle = '#a64668'; ctx.beginPath(); ctx.arc(7, -44, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#edf7dc'; ctx.fillRect(-10, -35, 20, 2)

  // Charging cable and status LEDs.
  ctx.strokeStyle = '#3c4944'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(11, -33); ctx.quadraticCurveTo(23, -30, 20, -17); ctx.stroke()
  ctx.fillStyle = '#9bed65'; ctx.beginPath(); ctx.arc(-15, -5, 2.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#7fe8d1'; ctx.beginPath(); ctx.arc(-7, -5, 2.5, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = '#202826'
  ctx.beginPath(); ctx.roundRect(-24, 5, 48, 14, 5); ctx.fill()
  ctx.fillStyle = '#d8edbd'; ctx.font = '800 7px ui-monospace, monospace'; ctx.textAlign = 'center'
  ctx.fillText('DOTCADE POCKET', 0, 15); ctx.textAlign = 'left'
  ctx.restore()
}

export function drawAgentHandheld(ctx, entity, {
  drawW = 44, drawH = 70, bob = 0, time = 0, reduceMotion = false,
  visualOffset = null
} = {}) {
  if (!entity?.meta?.handheld?.active) return
  const side = entity.dir === 'left' ? -1 : entity.dir === 'right' ? 1 : 0
  const motion = visualOffset || {}
  const x = side * Math.max(3, drawW * .12)
  const y = -drawH * .36 + bob
  const tap = reduceMotion ? 0 : Math.sin(time / 95 + entity.x * .01) * 1.1
  const screenPulse = reduceMotion ? .78 : .7 + Math.sin(time / 260 + entity.y) * .15

  ctx.save()
  // Apply the same foot-anchored transform as the avatar. This keeps the
  // handheld attached through recoil, squash/stretch and recovery poses.
  ctx.translate(
    Math.round(entity.x + (motion.x || 0)),
    Math.round(entity.y + (motion.y || 0))
  )
  ctx.rotate(motion.rotation || 0)
  ctx.transform(1, 0, motion.shearX || 0, 1, 0, 0)
  ctx.scale(motion.scaleX ?? 1, motion.scaleY ?? 1)
  ctx.translate(Math.round(x), Math.round(y))
  ctx.rotate(side * .07)

  // Bent forearms make it read as an object being actively held.
  ctx.strokeStyle = 'rgba(235,190,157,.96)'; ctx.lineWidth = 4; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(-drawW * .25, -4); ctx.lineTo(-10, 5 + tap); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(drawW * .25, -4); ctx.lineTo(10, 5 - tap); ctx.stroke()

  ctx.shadowColor = 'rgba(96,224,145,.35)'; ctx.shadowBlur = 8
  ctx.fillStyle = '#c1ccb0'
  ctx.beginPath(); ctx.roundRect(-10, -10, 20, 27, 4); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#293433'
  ctx.beginPath(); ctx.roundRect(-7, -7, 14, 10, 2); ctx.fill()
  ctx.fillStyle = `rgba(145,239,113,${screenPulse})`; ctx.fillRect(-5, -5, 10, 6)
  ctx.fillStyle = '#3b473e'; ctx.fillRect(-7, 7, 7, 2); ctx.fillRect(-5, 5, 2, 7)
  ctx.fillStyle = '#a94768'; ctx.beginPath(); ctx.arc(6, 9, 2.2, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#e9f5d6'; ctx.fillRect(-6, 14, 12, 1)

  // Tiny active-play spark above the screen.
  ctx.fillStyle = '#bdf482'; ctx.globalAlpha = .65 + screenPulse * .25
  ctx.fillRect(-1, -15 - Math.abs(tap), 2, 3)
  ctx.restore()
}
