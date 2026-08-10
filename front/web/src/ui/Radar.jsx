import React from 'react'
import { CRITERIA } from '../data/criteria.js'

// 6축 레이더 차트 (순수 SVG, 의존성 없음)
// ratings: {fun:7.2,...} (1~10) · compare: 보조 폴리곤(점선 — 누적 평균 등)
export default function Radar({
  ratings, compare = null, size = 96, color = '#ffd24a', compareColor = '#7dc7ff',
  labels = true, values = false, title = ''
}) {
  if (!ratings) return null
  const n = CRITERIA.length
  const pad = labels ? (values ? 30 : 20) : 8
  const c = size / 2
  const R = Math.max(10, c - pad)
  const ang = i => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i, v) => [c + Math.cos(ang(i)) * R * (v / 10), c + Math.sin(ang(i)) * R * (v / 10)]
  const poly = obj => CRITERIA.map(({ key }, i) => pt(i, Math.max(0, Math.min(10, Number(obj[key]) || 0))).join(',')).join(' ')
  const val = k => (Number.isFinite(Number(ratings[k])) ? Number(ratings[k]) : null)

  return (
    <svg className="radar" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" style={{ overflow: 'visible' }}>
      {title && <title>{title}</title>}
      {/* 그리드 링 + 스포크 */}
      {[2.5, 5, 7.5, 10].map(rv => (
        <polygon key={rv} points={CRITERIA.map((_, i) => pt(i, rv).join(',')).join(' ')}
          fill={rv === 10 ? 'rgba(122,132,196,.06)' : 'none'} stroke="rgba(122,132,196,.28)" strokeWidth="1" />
      ))}
      {CRITERIA.map((_, i) => {
        const [x, y] = pt(i, 10)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(122,132,196,.2)" strokeWidth="1" />
      })}
      {/* 비교(누적) 폴리곤 — 점선 */}
      {compare && <polygon points={poly(compare)} fill={compareColor + '22'} stroke={compareColor} strokeWidth="1.4" strokeDasharray="3 2" strokeLinejoin="round" />}
      {/* 메인 폴리곤 */}
      <polygon points={poly(ratings)} fill={color + '30'} stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      {CRITERIA.map(({ key }, i) => {
        const v = val(key)
        if (v == null) return null
        const [x, y] = pt(i, v)
        return <circle key={key} cx={x} cy={y} r={size >= 150 ? 2.6 : 2} fill={color} />
      })}
      {/* 축 라벨 */}
      {labels && CRITERIA.map(({ key, label }, i) => {
        const [x, y] = pt(i, 10)
        const lx = c + (x - c) * 1.22 + (values ? (x - c) * 0.08 : 0)
        const ly = c + (y - c) * 1.22 + (y === c ? 0 : y > c ? 3 : -1)
        const anchor = Math.abs(lx - c) < R * 0.35 ? 'middle' : lx > c ? 'start' : 'end'
        return (
          <text key={key} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
            fontSize={size >= 150 ? 11 : 8.5} fill="#8a93c6" fontFamily="inherit">
            {label}{values && val(key) != null ? ` ${val(key)}` : ''}
          </text>
        )
      })}
    </svg>
  )
}
