import React from 'react'

// DOTCADE — 초경량 마크다운 렌더러
// 외부 의존성 없음, dangerouslySetInnerHTML 미사용(전부 React 노드 → 주입 안전)
// 지원: #~#### 제목 · **굵게** · *기울임* · ~~취소선~~ · `코드` · ``` 코드블록 · 목록(-,*,1.) · > 인용 · 표 · --- · 링크

const withKeys = nodes => nodes.map((n, i) => (React.isValidElement(n) ? React.cloneElement(n, { key: i }) : n))

function inline(s) {
  if (!s) return []
  let m
  if ((m = s.match(/`([^`\n]+)`/)))
    return [...inline(s.slice(0, m.index)), <code>{m[1]}</code>, ...inline(s.slice(m.index + m[0].length))]
  if ((m = s.match(/\*\*([^*]+)\*\*/)))
    return [...inline(s.slice(0, m.index)), <b>{withKeys(inline(m[1]))}</b>, ...inline(s.slice(m.index + m[0].length))]
  if ((m = s.match(/~~([^~\n]+)~~/)))
    return [...inline(s.slice(0, m.index)), <s>{withKeys(inline(m[1]))}</s>, ...inline(s.slice(m.index + m[0].length))]
  if ((m = s.match(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/)))
    return [...inline(s.slice(0, m.index)), <a href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>, ...inline(s.slice(m.index + m[0].length))]
  if ((m = s.match(/(^|[\s("'가-힣>])\*([^*\n]+)\*/))) {
    const pre = s.slice(0, m.index) + m[1]
    return [...inline(pre), <i>{withKeys(inline(m[2]))}</i>, ...inline(s.slice(m.index + m[0].length))]
  }
  if ((m = s.match(/https?:\/\/[^\s<)"']+/)))
    return [...inline(s.slice(0, m.index)), <a href={m[0]} target="_blank" rel="noreferrer">{m[0]}</a>, ...inline(s.slice(m.index + m[0].length))]
  return [s]
}

const isTableRow = l => /^\s*\|.*\|\s*$/.test(l)
const isTableSep = l => /^\s*\|[\s:|-]+\|\s*$/.test(l)
const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export default function Markdown({ text, className = '' }) {
  const lines = String(text ?? '').split('\n')
  const out = []
  let i = 0, k = 0
  const push = el => out.push(React.cloneElement(el, { key: k++ }))

  while (i < lines.length) {
    const L = lines[i]

    if (/^\s*```/.test(L)) {                                  // 코드블록
      const buf = []; i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++
      push(<pre className="code mdr-code">{buf.join('\n')}</pre>)
      continue
    }
    if (isTableRow(L) && isTableRow(lines[i + 1] || '')) {    // 표
      const rows = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++])
      const body = rows.filter(r => !isTableSep(r))
      const [head, ...rest] = body
      push(
        <table className="mdr-table">
          <thead><tr>{cells(head).map((c, ci) => <th key={ci}>{withKeys(inline(c))}</th>)}</tr></thead>
          <tbody>{rest.map((r, ri) => <tr key={ri}>{cells(r).map((c, ci) => <td key={ci}>{withKeys(inline(c))}</td>)}</tr>)}</tbody>
        </table>
      )
      continue
    }
    let m
    if ((m = L.match(/^\s*(#{1,4})\s+(.*)/))) {               // 제목
      const lv = m[1].length
      const Tag = ['h2', 'h3', 'h4', 'h4'][lv - 1]
      push(<Tag className={`mdr-h mdr-h${lv}`}>{withKeys(inline(m[2]))}</Tag>)
      i++; continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { push(<hr className="mdr-hr" />); i++; continue }
    if (/^\s*>\s?/.test(L)) {                                 // 인용
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      push(<blockquote className="mdr-quote">{withKeys(inline(buf.join('\n')))}</blockquote>)
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(L)) {                   // 목록
      const items = []
      const ordered = /^\s*\d/.test(L)
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      const Tag = ordered ? 'ol' : 'ul'
      push(<Tag className="mdr-list">{items.map((it, ii) => <li key={ii}>{withKeys(inline(it))}</li>)}</Tag>)
      continue
    }
    if (!L.trim()) { i++; continue }                          // 빈 줄
    push(<div className="mdr-p">{withKeys(inline(L))}</div>)  // 일반 문단
    i++
  }
  return <div className={`mdr ${className}`}>{out}</div>
}
