// DOTCADE — 기본 게임 3종 시드 (첫 부팅 시 git 레포 생성)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db.js'
import { repos } from './repos.js'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'games-src')

const DEFAULTS = [
  {
    id: 'pixel-runner', emoji: '🏃', color: '#3ec6a8', genre: '러너',
    title: '픽셀 러너', desc: '달리는 도트 러너! 선인장을 뛰어넘고 새를 피해 최대한 멀리.',
    controls: ['Space', 'ArrowUp', 'ArrowDown'],
    prd: `# PRD — 픽셀 러너\n\n## 목표\n구글 공룡 게임 오마주. 한 손 조작으로 즐기는 무한 러너.\n\n## 핵심 루프\n달리기(자동) → 장애물 회피(점프×2/슬라이드) → 거리 점수 → 가속\n\n## 조작\nSpace/↑ 점프(더블점프), ↓ 슬라이드\n\n## 난이도\n속도 4.2→11 선형 가속, 스폰 간격 속도 비례 감소, 낮/밤 사이클\n\n## 성공 기준\n첫 판 3초 내 조작 이해, 평균 세션 40초+`,
    design: `# 아트/UX — 픽셀 러너\n\n- 480×320 가로. 파스텔 하늘/사막 팔레트, 밤 사이클 시 남색 전환\n- 주인공: 민트 로봇(20×26), 2프레임 다리 애니\n- 장애물: 선인장(1~2단), 보라 새(2프레임 날개)\n- 피드백: 점프 먼지 파티클, 게임오버 오버레이`,
    arch: `# 기술 설계 — 픽셀 러너\n\n- rAF 단일 루프, 엔티티 배열(obstacles/clouds/particles)\n- AABB 충돌(관용 4px), 더블점프 카운터, 슬라이드 히트박스 축소\n- api.rng 시드 난수, 점수=프레임/3, 5프레임마다 reportScore`
  },
  {
    id: 'meteor-dodge', emoji: '🚀', color: '#7dc7ff', genre: '회피',
    title: '메테오 닷지', desc: '운석 소나기 속에서 살아남아 별을 모으는 우주 회피 게임.',
    controls: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    prd: `# PRD — 메테오 닷지\n\n## 목표\n4방향 회피 + 수집의 긴장/보상 루프.\n\n## 핵심 루프\n생존 시간 점수(+1/6f) → 별 수집(+25) → 운석 밀도/속도 가속\n\n## 조작\n방향키 4방향 이동\n\n## 실패\n라이프 3, 피격 시 무적 80프레임 + 셰이크\n\n## 성공 기준\n평균 세션 45초+, 별 수집이 리스크 테이킹 유도`,
    design: `# 아트/UX — 메테오 닷지\n\n- 360×480 세로. 우주 남색 배경 + 2층 패럴랙스 별\n- 우주선: 하늘색 도트십, 엔진 불꽃 2프레임\n- 운석: 회전 사각 3톤 셰이딩, 별: 45° 회전 트윙클\n- 피격: 파티클 붐 + 화면 셰이크 + 깜빡임 무적`,
    arch: `# 기술 설계 — 메테오 닷지\n\n- 원형 충돌(hypot), 무적 타이머, 파티클 풀\n- 난이도: diff=min(1,t/3600) → 스폰 간격/속도 보간\n- 별 스폰 90f 주기, api.rng 시드 난수`
  },
  {
    id: 'snake-classic', emoji: '🐍', color: '#7de0a0', genre: '퍼즐',
    title: '스네이크 클래식', desc: '고전 스네이크의 도트 리메이크. 골든 애플을 노리세요!',
    controls: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    prd: `# PRD — 스네이크 클래식\n\n## 목표\n검증된 고전 루프 + 골든 애플 리스크 보상.\n\n## 핵심 루프\n사과 +10(속도 증가) → 골든 애플 +50(시한부) → 길이 증가 리스크\n\n## 조작\n방향키(입력 큐 3, 역방향 방지)\n\n## 실패\n벽/몸통 충돌\n\n## 성공 기준\n조작 선입력이 씹히지 않을 것(입력 큐), 속도 상승 체감`,
    design: `# 아트/UX — 스네이크 클래식\n\n- 400×440, 20×20 그리드 체커보드\n- 뱀: 머리 민트 + 몸통 그라데이션, 눈이 진행 방향 표시\n- 골든 애플: 트윙클 + 남은 시간 숫자\n- 획득 플래시 오버레이`,
    arch: `# 기술 설계 — 스네이크 클래식\n\n- 고정 스텝(140ms→70ms) + rAF 렌더 분리(acc 누적)\n- 입력 큐(최대 3) + 역방향 필터\n- 스폰 위치 몸통 제외 리롤, api.rng 시드 난수`
  }
]

export async function seedDefaults() {
  let seeded = 0
  for (const g of DEFAULTS) {
    if (db.game(g.id)) continue
    const code = fs.readFileSync(path.join(SRC, g.id, 'game.js'), 'utf8')
    const now = new Date().toISOString()
    const files = {
      'game.js': code,
      'meta.json': JSON.stringify({ id: g.id, title: g.title, desc: g.desc, genre: g.genre, controls: g.controls, emoji: g.emoji, color: g.color }, null, 2),
      'README.md': `# ${g.emoji} ${g.title}\n\n${g.desc}\n\n- 장르: ${g.genre}\n- 조작: ${g.controls.join(', ')}\n- 제작: DOTCADE 스튜디오 (기본 게임)\n\n## 실행\nDOTCADE 라이브러리에서 ▶ 플레이 또는 \`/play/${g.id}\` 공유 링크.\n`,
      'docs/prd.md': g.prd,
      'docs/design.md': g.design,
      'docs/architecture.md': g.arch,
      'CHANGELOG.md': `# Changelog\n\n## v1.0.0 (${now.slice(0, 10)})\n- 최초 릴리즈 (DOTCADE 기본 게임)\n`
    }
    await repos.create(g.id, files, `${g.title} v1.0.0 최초 릴리즈`, 'v1.0.0')
    db.data.games.push({
      id: g.id, title: g.title, desc: g.desc, genre: g.genre, emoji: g.emoji, color: g.color,
      controls: g.controls, version: 'v1.0.0',
      versions: [{ v: 'v1.0.0', date: now, message: '최초 릴리즈 (기본 게임)' }],
      source: 'default', createdAt: now, updatedAt: now, feedback: {}, meetings: []
    })
    seeded++
  }
  if (seeded) db.save()
  return seeded
}
