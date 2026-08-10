// DOTCADE — mock LLM provider (Gemini 도달 불가/오프라인 데모용)
// 실제 프로바이더와 동일한 인터페이스: generate / stream / embed
// 프론트가 넘기는 hint(작업 종류)와 personaMeta로 그럴듯한 한국어 응답을 합성한다.

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length]
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h }

function keywords(text) {
  const stop = new Set(['게임', '만들', '어요', '해서', '하는', '그리고', '있는', '주세요', '해줘', '합니다'])
  return (String(text).match(/[가-힣a-zA-Z]{2,}/g) || []).filter(w => !stop.has(w)).slice(0, 6)
}

// ---------- mock game template (파라미터화된 캐처 게임) ----------
export function mockGameCode({ title = '별똥별 받기', theme = '#ffd24a', bad = '#ff5a7a', item = '★' } = {}) {
  return `// ${title} — DOTCADE mock 생성 게임 (LLM 모의 모드)
window.game = {
  meta: {
    title: ${JSON.stringify(title)},
    desc: '떨어지는 아이템을 받고 폭탄은 피하세요! (모의 모드 생성)',
    controls: ['ArrowLeft', 'ArrowRight'],
    viewport: { w: 360, h: 480 }
  },
  _raf: 0,
  start(canvas, api) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const rng = api.rng
    let px = W / 2, keys = {}, items = [], score = 0, lives = 3, t = 0, over = false, shake = 0
    const kd = e => { keys[e.code] = true }
    const ku = e => { keys[e.code] = false }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    this._cleanup = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
    const spawn = () => items.push({ x: 16 + rng() * (W - 32), y: -12, v: 1.6 + rng() * 2.2 + t / 1800, bad: rng() < 0.28 })
    const loop = () => {
      if (over) return
      t++
      if (t % Math.max(18, 40 - (t >> 8)) === 0) spawn()
      if (keys.ArrowLeft) px -= 4.4
      if (keys.ArrowRight) px += 4.4
      px = Math.max(18, Math.min(W - 18, px))
      for (const it of items) it.y += it.v
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.y > H - 46 && it.y < H - 14 && Math.abs(it.x - px) < 26) {
          if (it.bad) { lives--; shake = 8 } else { score += 10; api.reportScore(score) }
          items.splice(i, 1)
        } else if (it.y > H + 16) items.splice(i, 1)
      }
      if (lives <= 0) { over = true; this._cleanup(); api.gameOver(score); }
      const sx = shake > 0 ? (rng() - 0.5) * shake : 0; if (shake > 0) shake--
      ctx.save(); ctx.translate(sx, 0)
      ctx.fillStyle = '#141628'; ctx.fillRect(-8, 0, W + 16, H)
      ctx.fillStyle = '#1e2140'
      for (let i = 0; i < 14; i++) ctx.fillRect(((i * 97 + t) % (W + 40)) - 20, (i * 53) % H, 3, 3)
      for (const it of items) {
        ctx.fillStyle = it.bad ? ${JSON.stringify(bad)} : ${JSON.stringify(theme)}
        it.bad ? ctx.fillRect(it.x - 7, it.y - 7, 14, 14) : (ctx.font = '16px monospace', ctx.fillText(${JSON.stringify(item)}, it.x - 8, it.y + 6))
      }
      ctx.fillStyle = '#7de0a0'; ctx.fillRect(px - 18, H - 34, 36, 14)
      ctx.fillStyle = '#5bb37f'; ctx.fillRect(px - 12, H - 42, 24, 10)
      ctx.fillStyle = '#fff'; ctx.font = '13px monospace'
      ctx.fillText('SCORE ' + score, 10, 20); ctx.fillText('♥'.repeat(Math.max(0, lives)), W - 60, 20)
      ctx.restore()
      this._raf = requestAnimationFrame(loop)
    }
    loop()
  },
  stop() { cancelAnimationFrame(this._raf); this._cleanup && this._cleanup() }
}`
}

// ---------- per-hint mock text ----------
function mockText({ hint = 'chat', system = '', user = '', personaMeta = {} }) {
  const seed = hash(user + system)
  const kws = keywords(user)
  const kw = kws[0] || '게임'
  const name = personaMeta.name || (system.match(/이름[:은]?\s*([가-힣]{2,4})/) || [])[1] || '팀원'

  switch (hint) {
    case 'research':
      return `[${name}의 조사 메모]\n- '${kw}' 관련 최근 트렌드: 짧은 세션(30~60초)과 즉각적 피드백이 핵심.\n- 유사 도트 게임 사례: 단순 조작(1~2키) + 점진적 난이도 상승 조합이 평이 좋음.\n- 과거 우리 게임 피드백 참고: 조작감·타격감 관련 지적이 반복됨 → 이번엔 초기 반응속도에 신경 쓸 것.\n- 제안 키워드: ${kws.slice(0, 3).join(', ') || '아케이드, 하이스코어'}`
    case 'debate':
      return pick([
        `'${kw}' 컨셉 좋다고 생각해요. 다만 조작은 두 개 키 이내로 줄여야 오락실 손님들이 바로 붙을 수 있어요. 첫 3초 안에 규칙이 이해되게 갑시다.`,
        `저는 난이도 곡선이 걱정돼요. 초반 10초는 실패가 거의 없게 하고, 이후부터 가속을 붙이는 방식을 제안합니다. 점수는 콤보 보너스로 차별화하고요.`,
        `비주얼은 3색 팔레트로 제한하는 게 도트 감성에 맞아요. ${kw} 모티프를 픽셀 심볼로 단순화하면 화면이 훨씬 정리될 겁니다.`,
        `스코프 조심해요. 이번 버전은 핵심 루프 하나만: 피하고-먹고-점수. 파워업은 다음 버전 백로그로 넘기죠.`,
        `하이스코어 도전 욕구가 생기려면 죽는 순간이 억울하면 안 돼요. 히트박스는 보이는 것보다 살짝 작게 잡읍시다.`
      ], seed + (personaMeta.idx || 0))
    case 'concept':
      return `핵심 한 줄: "${kw}"를 소재로 한 원버튼/투버튼 하이스코어 아케이드.\n루프: 조작→위험 회피/아이템 획득→점수 상승→가속.\n차별점: 콤보 배수와 마지막 순간 회피 보너스.`
    case 'prd':
      return `# PRD — ${kw} 게임\n\n## 목표\n30초~2분 세션의 하이스코어 도트 아케이드.\n\n## 핵심 루프\n1. 좌우(또는 점프) 조작으로 위험 회피\n2. 아이템 획득 시 +10점, 연속 획득 콤보 ×2\n3. 시간에 따라 낙하/이동 속도 가속\n\n## 조작\nArrowLeft / ArrowRight (모바일: 터치 좌우)\n\n## 실패 조건\n라이프 3 소진 시 게임 오버 → 최종 점수\n\n## 성공 기준\n- 첫 플레이 10초 내 규칙 이해\n- 평균 세션 45초 이상\n- 조작 입력 지연 체감 없음`
    case 'design':
      return `# 아트/UX 스펙\n\n## 팔레트\n배경 #141628 / 주인공 #7de0a0 / 아이템 #ffd24a / 위험 #ff5a7a / UI #ffffff\n\n## 화면\n360×480 세로. 상단 HUD(점수·라이프), 중앙 플레이필드, 배경엔 저채도 별 파티클.\n\n## 연출\n- 피격 시 화면 셰이크 6프레임\n- 아이템 획득 시 1프레임 플래시\n- 게임오버: 점수 크게, 재시작 안내`
    case 'arch':
      return `# 기술 설계\n\n- 단일 rAF 루프, 상태: items[], player{px}, score, lives, t\n- 충돌: AABB (플레이어 36×14 vs 아이템 14×14)\n- 난이도: 스폰 간격 40f→18f 선형 감소, 낙하속도 t/1800 가속\n- 게임팩 계약 준수: api.reportScore 즉시 호출, gameOver 1회 보장, api.rng 사용\n- 입력: keydown/keyup 플래그 방식(홀드 지원), stop()에서 리스너 해제`
    case 'review':
      return pick([
        `PRD 확인했습니다. 콤보 규칙만 명확히 하면 바로 구현 가능해 보여요. 승인 의견입니다.`,
        `히트박스 축소(시각 대비 80%)만 아키텍처에 반영해 주세요. 나머지는 동의합니다.`,
        `모바일 터치 대응은 하네스가 처리하니 게임 코드는 키보드만 신경 쓰면 됩니다. 진행하죠.`
      ], seed)
    case 'qa':
      return `QA 리포트: 스모크 테스트 통과. 캔버스 렌더 확인, 점수 증가 확인, 게임오버 이벤트 정상. 발견 이슈 없음.`
    case 'repair':
      return '```js\n' + mockGameCode({ title: kw + ' 게임' }) + '\n```'
    case 'code':
      return '```js\n' + mockGameCode({
        title: (kws.slice(0, 2).join(' ') || '별똥별 받기'),
        theme: pick(['#ffd24a', '#7dc7ff', '#ff9d5c', '#b78cff'], seed),
        item: pick(['★', '◆', '●', '♥'], seed)
      }) + '\n```'
    case 'changelog':
      return `- ${kw} 컨셉의 신규 게임 릴리즈\n- 핵심 루프(회피/획득/콤보) 구현\n- 자동 QA 스모크 테스트 통과`
    case 'feedback': {
      const strict = personaMeta.strict ?? 5
      const base = 8.5 - strict * 0.35 + ((seed % 100) / 100) * 2 - 1
      const score = Math.max(2, Math.min(10, Math.round(base)))
      const s = Math.abs(seed)
      const ax = off => Math.max(1, Math.min(10, Math.round(base + off)))
      return JSON.stringify({
        score,
        ratings: {
          fun: ax(((s >> 1) % 3) - 1),
          controls: ax(((s >> 2) % 4) - 2),
          balance: ax(((s >> 3) % 3) - 1),
          graphics: ax(((s >> 4) % 4) - 1),
          immersion: ax(((s >> 5) % 3) - 2),
          originality: ax(((s >> 6) % 5) - 2)
        },
        oneLiner: pick([
          '조작이 바로 손에 익어서 좋았어요', '난이도가 좀 아쉽지만 손맛은 있네요',
          '한 판만 더 하고 싶어지는 게임', '그래픽 감성은 좋은데 변화가 더 필요해요',
          '점수 올리는 재미가 확실합니다', '초반이 심심해요, 뒤로 갈수록 재밌음'
        ], seed + strict),
        detail: {
          fun: pick(['루프가 단순한데 중독성이 있음', '반복 플레이 동기가 조금 약함', '가속 붙는 순간부터 진짜 재밌어짐'], seed),
          difficulty: pick(['체감 난이도 적절', '초반 너무 쉬움', '후반 급격히 어려워짐'], seed + 1),
          controls: pick(['입력 지연 없음, 쾌적', '키 반응은 좋은데 관성이 아쉬움', '조작 직관적'], seed + 2),
          graphics: pick(['도트 감성 좋음', '팔레트 통일감 있음', '이펙트가 더 있으면 좋겠음'], seed + 3)
        },
        bugs: (seed % 7 === 0) ? ['가끔 아이템이 벽 끝에 붙어 나옴'] : [],
        suggestions: [pick(['콤보 시스템 강화', '파워업 아이템 추가', '랭킹 표시', '스테이지 변화'], seed + 4)]
      })
    }
    case 'summary':
      return `# 오락실 반응 종합 리포트\n\n**총평**: 손님들의 평균 반응은 긍정적. 조작감과 단순한 루프가 강점, 후반 콘텐츠 다양성이 약점.\n\n## 강점\n- 즉시 이해되는 규칙, 낮은 진입장벽\n- 하이스코어 도전 동기\n\n## 약점\n- 플레이 변화 폭 부족 (파워업/이벤트 부재)\n- 일부 연령대에서 난이도 곡선 불만\n\n## 다음 버전 우선순위\n1. 콤보/파워업 시스템\n2. 후반 페이즈 변화(배경·속도·패턴)\n3. 히트박스 미세 조정`
    default: // chat
      return pick([
        `네 팀장님, ${kw} 건은 제가 정리해서 공유드릴게요. 회의로 진행해 보실래요?`,
        `지금 ${kw} 관련 아이디어 몇 개 생각해 둔 게 있어요. 회의 안건으로 올려주시면 바로 풀어보겠습니다.`,
        `오늘 컨디션 좋습니다! 새 게임 만들 준비 됐어요.`,
        `최근 오락실 피드백 보니까 조작감 얘기가 많더라고요. 다음 작품에 반영하면 좋겠어요.`
      ], seed)
  }
}

export const mockProvider = {
  name: 'mock',
  async generate(opts) {
    await new Promise(r => setTimeout(r, 150 + Math.random() * 350))
    return { text: mockText(opts), sources: opts.search ? [{ title: '(모의) 아케이드 트렌드 2026', uri: 'https://example.com/arcade-trends' }] : [] }
  },
  async stream(opts, onDelta) {
    const text = mockText(opts)
    const step = Math.max(4, Math.floor(text.length / 40))
    for (let i = 0; i < text.length; i += step) {
      onDelta(text.slice(i, i + step))
      await new Promise(r => setTimeout(r, 24))
    }
    return { text, sources: [] }
  },
  async embed(texts) {
    return texts.map(t => {
      const v = new Array(256).fill(0)
      for (const w of String(t).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || []) {
        v[Math.abs(hash(w)) % 256] += 1
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
      return v.map(x => x / n)
    })
  }
}
