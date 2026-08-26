// DOTCADE — 오락실 평가 기준 6축 (레이더 차트 공용 정의)
export const CRITERIA = [
  { key: 'fun', label: '재미', desc: '핵심 루프가 즐겁고 계속 하고 싶은가' },
  { key: 'controls', label: '조작감', desc: '입력 반응성과 손맛' },
  { key: 'balance', label: '밸런스', desc: '난이도 곡선이 공정하고 적절한가' },
  { key: 'graphics', label: '그래픽', desc: '원경·중경·전경의 깊이, 원근 스케일·조명·그림자, HUD 위계와 화면별 UI 완성도' },
  { key: 'immersion', label: '몰입도', desc: '집중하게 만들고 "한 판 더"를 부르는가' },
  { key: 'originality', label: '독창성', desc: '아이디어와 변주의 참신함' }
]
export const CKEYS = CRITERIA.map(c => c.key)

// LLM 응답의 ratings 정리: 알려진 축만, 1~10 정수로 클램프 (4축 미만이면 무효)
export const sanitizeRatings = r => {
  if (!r || typeof r !== 'object') return null
  const out = {}
  for (const { key } of CRITERIA) {
    const v = Math.round(Number(r[key]))
    if (Number.isFinite(v)) out[key] = Math.max(1, Math.min(10, v))
  }
  return Object.keys(out).length >= 4 ? out : null
}

// 리포트 배열의 축별 평균 → {fun: 7.2, ...}
export const avgRatings = list => {
  const out = {}
  for (const { key } of CRITERIA) {
    const vals = list.map(r => Number(r?.[key])).filter(v => Number.isFinite(v))
    if (vals.length) out[key] = +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)
  }
  return Object.keys(out).length ? out : null
}

// 최강/최약 축 → { top: [label, v], low: [label, v] }
export const strongWeak = ratings => {
  const es = CRITERIA.filter(c => Number.isFinite(Number(ratings?.[c.key]))).map(c => [c.label, Number(ratings[c.key])])
  if (es.length < 2) return null
  const top = es.reduce((a, b) => (b[1] > a[1] ? b : a))
  const low = es.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { top, low }
}
