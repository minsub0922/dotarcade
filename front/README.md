# 🕹️ DOTCADE Front

> **게임 스튜디오 운영 + 오락실 배포 시뮬레이션** — 플레이어는 도트 게임 스튜디오의 팀장이 되어, LLM 멀티에이전트 팀원들과 BMAD 방식의 회의로 *실제로 동작하는* 도트 미니게임을 만들고, 오락실에 배포해 20명의 가상 손님 에이전트로부터 피드백과 점수를 받습니다.

이 레포는 **프론트엔드**(Vite + React 18 + zustand)입니다.
백엔드: [`../back`](../back/) (Express — `:5175`)

## ✨ 무엇을 하는 앱인가

1. **회의 = 제작** — 팀장(나)이 안건을 내면 5명의 AI 팀원(PM·시니어/주니어 개발자·디자이너·작가)이 BMAD Method 단계를 따라 토론하고, 회의가 끝나면 **동작하는 게임팩(단일 파일 JS 캔버스 게임)** 이 산출됩니다.
2. **배포 = 검증** — 완성된 게임을 오락실 맵에 배포하면 나이·직업·성향이 다른 **20명의 가상 손님**이 실제로 게임을 실행·플레이하고 점수와 피드백을 남깁니다.
3. **반복 = 성장** — 피드백 → 업그레이드 회의 → 버전 업(git 커밋·태그) → 재배포 루프.

## 🚀 실행

```bash
npm install          # 개발·빌드 시에만 필요
npm run dev          # 개발 모드: http://localhost:5173 (/api·/play → :5175 프록시)
npm run build        # web/dist 프로덕션 번들 생성
npm start            # 배포 모드: serve.js — web/dist 서빙 + /api·/play 프록시
```

- **백엔드가 먼저 떠 있어야** API·공유 플레이(`/play/<게임id>`)가 동작합니다. `back/`에서 `npm start` (`:5175`).
- 배포 서버(`serve.js`)는 Node 내장 모듈만 사용하므로 `node_modules` 없이도 동작합니다 (단, 빌드된 `web/dist` 필요).
- 환경변수: `FRONT_PORT`(기본 `5173`), `BACK_ORIGIN`(기본 `http://localhost:5175`).

## 🧩 주요 시스템

### 캔버스 월드 엔진 (`web/src/engine/`)
- 도트 타일맵 2종(스튜디오 오피스·오락실) 위에서 캐릭터들이 돌아다니는 2D 월드.
- `pathfind.js` — A* 경로탐색, `world.js` — 캐릭터 FSM(대기·이동·대화·플레이), 말풍선 렌더링.

### 회의 오케스트레이터 (`web/src/meeting/`)
`engine.js`가 BMAD Method 10단계를 순서대로 진행하며, 각 단계마다 담당 에이전트가 LLM 스트리밍으로 발화합니다:

| 단계 | BMAD 매핑 |
|---|---|
| 킥오프 | 안건 공유 |
| 리서치 | Analyst — 개별 조사 (Tavily 웹검색 + RAG) |
| 컨셉 토론 | 브레인스토밍 · 멀티에이전트 디베이트 |
| PRD 작성 | PM — create-prd |
| 아트/UX 스펙 | UX — ux-spec |
| 아키텍처 | Architect — create-architecture |
| 리뷰 & 승인 | PO — implementation readiness |
| 구현 | Dev — dev-story (게임 코드 생성) |
| QA | TEA — 자동 스모크 테스트 (실패 시 자동 수리 루프) |
| 릴리즈 | retrospective + release (버전 커밋·태그) |

- `prompts.js` — 단계별 프롬프트·페르소나 시스템 프롬프트.
- 산출물(PRD·아키텍처·디자인 문서·게임 코드)은 백엔드의 **게임별 실제 git 레포**에 커밋됩니다.

### 게임팩 샌드박스 하네스 (`web/src/game/`, `web/public/harness.js`)
- 게임팩은 **단일 파일 JS 캔버스 게임**으로, `sandbox` iframe(`allow-scripts`) 안에서 실행됩니다.
- `harness.js` — `postMessage` 토큰 기반 통신: 키 입력 주입(`sendKey`), 정지(`stop`), 게임 이벤트(점수·게임오버) 수신.
- `qa.js` — 문법 검사(`syntaxCheck`) + 봇 입력으로 9초간 자동 플레이하는 스모크 테스트(`runSmokeTest`). QA 실패 시 에러를 프롬프트에 넣어 수리 회의를 돌립니다.

### 오락실 시뮬레이션 (`web/src/arcade/sim.js`)
- 20명 손님 페르소나(초등학생부터 은퇴 바둑 애호가까지, `data/personas.js`)가 각자 `strict`(깐깐함)·`patience`(플레이 시간)·`aggr`(공격성) 파라미터로 게임을 **실제 실행**하며 봇 플레이.
- 플레이 결과 + 페르소나 성향 → LLM 피드백·별점 → 게임별 종합 리포트.

### UI 패널 (`web/src/ui/`)
HUD · 채팅(팀원 1:1 대화) · 회의 시작/진행 패널 · 오락실 패널 · 게임 라이브러리(버전 히스토리·diff·공유 링크) · 플레이 모달 · 리포트 모달 · 설정 · 토스트.

### 상태 관리 (`web/src/state/store.js`)
zustand 단일 스토어 — 월드·회의·오락실·라이브러리 상태.

## 📁 구조

```
web/
  src/
    engine/     캔버스 월드 — world.js(FSM·렌더)·pathfind.js(A*)
    meeting/    회의 오케스트레이터 — engine.js(10단계 진행)·prompts.js
    game/       게임팩 하네스 — harness.js(iframe 마운트)·qa.js(스모크 테스트)
    arcade/     오락실 시뮬 — sim.js(20명 손님 봇 플레이)
    ui/         패널 컴포넌트 — HUD·Chat·Meeting·Arcade·Library·Play·Report·Settings
    state/      zustand 스토어
    data/       페르소나 정의 — 팀원 5명 + 손님 20명
    api.js      백엔드 API 클라이언트 (스트리밍 포함)
  public/       도트 에셋 — 맵 2종·캐릭터 스프라이트 26종·harness.js(srcdoc 빌더)
serve.js        무의존성 배포 서버 — 정적 서빙 + /api·/play 프록시
tools/          에셋 생성 스크립트 (Python3 + Pillow) — gen_maps.py·gen_sprites.py
```

## 🔗 백엔드 연동

프론트는 다음을 백엔드(`:5175`)에 의존합니다:
- `POST /api/llm/stream|generate|embed` — Gemini 프록시 (키 없으면 mock 모드로 자동 전환되어 오프라인 데모 가능)
- `POST /api/search` — Tavily 웹검색 (리서치 단계)
- `POST /api/rag/*` — 회의 산출물 RAG
- `GET/POST /api/games*` — 게임 CRUD·버전(커밋·태그)·diff·파일·번들
- `GET /play/:id` — 외부 공유용 단독 플레이어 페이지

## 🛠️ 기술 스택

React 18 · zustand 4 · Vite 5 — 런타임 의존성은 이 3개가 전부입니다. 캔버스 렌더링·A*·FSM·샌드박스 하네스는 모두 직접 구현.
