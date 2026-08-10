# Architecture — DOTCADE

> BMAD Method · Phase 3 (Architect) 산출물

## 스택
- **서버**: Node 20+ / Express. 역할: Gemini 프록시(키는 .env), git 레포 관리, JSON DB, RAG 벡터 스토어, `/play/:id` 공개 플레이어, 프론트 정적 서빙(prod)
- **프론트**: Vite + React + zustand. 캔버스 월드 엔진(React 밖 rAF 루프) + React UI 패널
- **LLM**: Gemini v1beta REST. smart=`gemini-3.6-flash`(코드/문서), fast=`gemini-3.5-flash-lite`(토론/피드백/대화), 임베딩=`gemini-embedding-2`. 모델 폴백 체인 + 429/503 백오프 + 서버측 동시성 세마포어. 도달 불가 시 mock 프로바이더로 자동 전환

## 디렉터리
```
dotcade/
├─ .env                     # GEMINI_API_KEY 등 (git 제외)
├─ package.json             # 단일 패키지 (server+web)
├─ server/
│  ├─ index.js              # Express 부팅, 라우팅, 정적 서빙
│  ├─ lib/gemini.js         # 프록시·폴백·세마포어·mock 스위치
│  ├─ lib/mock.js           # 모의 LLM (페르소나 응답·게임 템플릿·해시 임베딩)
│  ├─ lib/db.js             # data/db.json 로드/디바운스 저장
│  ├─ lib/repos.js          # 게임별 git 레포 생성·커밋·태그·show·diff
│  ├─ lib/rag.js            # data/vectors.json 임베딩 업서트/코사인 검색
│  ├─ lib/seed.js           # 기본 게임 3종 시드
│  └─ games-src/            # 기본 게임 소스+문서
└─ web/
   ├─ public/assets/        # 스프라이트 26종, 맵 2종, maps.json
   └─ src/
      ├─ engine/            # world(rAF·충돌·카메라스케일), pathfind(A*), agents(FSM)
      ├─ meeting/           # engine(BMAD 단계 상태기계), prompts(페르소나·계약)
      ├─ game/              # harness(iframe srcdoc·봇), qa(스모크·수리 루프)
      ├─ arcade/            # sim(20명 파이프라인 오케스트레이션)
      ├─ ui/                # HUD·Chat·Meeting·Library·Play·Arcade·Settings·CodeViewer
      ├─ data/personas.js   # 팀 5 + 손님 20 페르소나
      └─ state/store.js     # zustand
```

## 핵심 결정
1. **게임팩 계약**: 생성 코드의 유일한 인터페이스. 하네스가 봇 입력·점수·에러를 표준화 → QA와 오락실 시뮬이 같은 하네스 재사용
2. **git이 곧 버전 시스템**: 게임팩당 레포 1개, 버전당 커밋+태그. 코드뷰어/버전로그/diff는 git 명령 출력 그대로 사용
3. **회의는 프론트가 오케스트레이션**: 단계 상태기계가 서버 프록시로 LLM 호출 → 실시간 말풍선/트랜스크립트, 승인 게이트에 유저 개입 가능. 리서치는 에이전트별 **비공유** 컨텍스트(RAG 질의·웹검색 grounding 개별 수행), 토론은 공유 트랜스크립트
4. **오락실 시뮬 파이프라인**: 봇플레이(iframe, 동시 4) → 텔레메트리+코드 발췌 → 페르소나 피드백(JSON 스키마 강제) → 조기종료·타임캡(10분) → 종합 리포트. LLM 동시성은 서버 세마포어가 조절
5. **mock 모드**: 부팅 시 Gemini 도달성 검사 → live/mock 결정, /api/config로 노출. mock도 동일 코드 경로(SSE 스트리밍 포함)를 흐른다

## API 표면 (요약)
```
GET  /api/config                     # {llm:'live'|'mock', models, ready}
POST /api/llm/generate|stream|embed  # Gemini 프록시 (search·json 스키마 지원)
GET  /api/games                      # 목록
POST /api/games                      # 생성(파일들→git init+tag)
POST /api/games/:id/versions         # 새 버전(커밋+태그)
GET  /api/games/:id                  # 메타+버전로그
GET  /api/games/:id/files?ref=       # 파일 트리+내용 (git show)
GET  /api/games/:id/diff?from=&to=   # git diff 텍스트
GET  /api/games/:id/bundle?v=        # {meta, code} — 플레이어/공유용
POST /api/games/:id/feedback         # 오락실 리포트 저장
GET|POST /api/chats/:agentId         # 1:1 대화 이력
POST /api/meetings  PATCH /api/meetings/:id  # 회의 기록
POST /api/rag/upsert  POST /api/rag/query    # RAG
GET  /play/:id                       # 공개 공유 플레이어 (React 밖 단독 HTML)
```

## 게임팩 계약 (생성 코드 규약)
```js
window.game = {
  meta: { title, desc, controls: ['ArrowLeft','ArrowRight','Space'], viewport: {w:360,h:480} },
  start(canvas, api) { /* rAF 루프, api.reportScore(n) 수시 호출, 종료 시 api.gameOver(n) */ },
  stop() {}
}
// api = { reportScore(n), gameOver(n), rng() }  — Math.random 대신 api.rng
// 금지: fetch/import/localStorage/외부 리소스. 화면은 캔버스 픽셀아트.
```
