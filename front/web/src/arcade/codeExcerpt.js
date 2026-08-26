// 평가 LLM이 코드 앞부분의 상태 선언만 보고 그래픽을 추측하지 않도록,
// meta와 실제 depth/UI renderer를 함께 뽑는 작은 구조 보존 발췌기다.
export function evaluationCodeExcerpt(code, maxChars = 7600) {
  const source = String(code || '')
  if (source.length <= maxChars) return source

  const ranges = [[0, Math.min(1800, source.length)]]
  const marker = /\b(?:function\s+|(?:const|let|var)\s+)(drawFarLayer|drawMidLayer|drawNearLayer|drawWorld|drawTitle|drawGameplay|drawBattle|drawResult|drawGameOver|drawOverlayScreen|drawParty|drawCodex|drawCollection|drawLoadout|drawHelp|drawPanel)\b/g
  for (const match of source.matchAll(marker)) {
    ranges.push([Math.max(0, match.index - 120), Math.min(source.length, match.index + 880)])
  }
  ranges.push([Math.max(0, source.length - 900), source.length])
  ranges.sort((a, b) => a[0] - b[0])

  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1] + 80) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }

  let excerpt = ''
  for (const [start, end] of merged) {
    const section = `${excerpt ? '\n// ... 렌더 외 코드 생략 ...\n' : ''}${source.slice(start, end)}`
    if (excerpt.length + section.length > maxChars) {
      excerpt += section.slice(0, Math.max(0, maxChars - excerpt.length))
      break
    }
    excerpt += section
  }
  return `${excerpt}\n// ... (평가용 구조 발췌 · 총 ${source.split('\n').length}줄)`
}
