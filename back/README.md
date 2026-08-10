# 🕹️ DOTCADE Back

> **게임 스튜디오 운영 + 오락실 배포 시뮬레이션** — LLM 멀티에이전트 팀이 BMAD 방식 회의로 *실제로 동작하는* 도트 미니게임을 만들고, 오락실에 배포해 20명의 가상 손님에게 평가받는 앱의 **백엔드**입니다.

이 레포는 **백엔드**(Express, 의존성은 `express`+`dotenv` 단 2개)입니다.
프론트: [`../front`](../front/) (Vite + React — `:5173`)

## 담당 영역

- **Gemini 프록시** — 스트리밍(SSE)·임베딩·모델 폴백(smart→fast)·429 백오프·세마포어(동시성 제한). 키가 없거나 오프라인이면 자동으로 **mock 모드** 전환 → 전체 기능 오프라인 데모 가능.
- **Tavily 웹검색** — 무료 키 여러 개를 **로테이션**(라운드로빈 + 실패 시 다음 키 + 쿼터 초과 쿨다운 + 무효 키 자동 제외)으로 사용해 에이전트 리서치 단계에 제공.
- **게임별 실제 git 레포** — 게임 하나당 `server/data/games/<id>/`에 진짜 git 레포를 만들어 회의 산출물(PRD·아키텍처·디자인 문서·게임 코드·README·CHANGELOG)을 **커밋·태그**로 버전 관리. 로그·diff API 제공.
- **JSON DB** — 게임·회의록·채팅 히스토리 영속화 (`server/data/db.json`).
- **RAG** — 회의 산출물을 임베딩해 벡터 저장(`vectors.json`), 다음 회의의 리서치 단계에서 검색.
- **`/play/<게임id>` 공유 플레이어** — 게임팩을 샌드박스 iframe으로 감싼 단독 플레이 페이지. 링크만으로 외부 공유 가능.
- **기본 게임 3종 시드** — 픽셀 러너·메테오 닷지·스네이크 클래식 (첫 구동 시 자동 시드).

## 🚀 실행

```bash
npm install
npm start            # http://localhost:5175
npm run dev          # --watch 모드
```

프론트(`:5173`)가 `/api`·`/play`를 이쪽으로 프록시합니다. 프론트를 빌드해 두면(`web/dist`) 백엔드 단독으로도 정적 서빙합니다.

### 환경변수 (레포 루트의 단일 `.env` — `cp .env.example .env`)

백엔드는 `BACK_*` 접두사 키만 읽습니다 (프론트는 `FRONT_*` — 서로 겹치지 않음).

| 변수 | 기본값 | 설명 |
|---|---|---|
| `BACK_PORT` | `5175` | API 서버 포트 |
| `BACK_GEMINI_API_KEY` | — | 없으면 자동 mock 모드 (오프라인 데모) |
| `BACK_GEMINI_MODEL_SMART` | `gemini-3.6-flash` | 구현·아키텍처 등 고품질 단계용 모델 |
| `BACK_GEMINI_MODEL_FAST` | `gemini-3.5-flash-lite` | 발화·피드백 등 경량 단계용 모델 |
| `BACK_GEMINI_MODEL_EMBED` | `gemini-embedding-2` | RAG 임베딩 모델 |
| `BACK_MAX_LLM_CONCURRENCY` | `4` | LLM 동시 호출 세마포어 크기 |
| `BACK_LLM_MODE` | `auto` | `live`·`mock` 강제 지정 가능 |
| `BACK_TAVILY_API_KEYS` | — | 쉼표 구분 여러 개 — 로테이션 사용 |

- **데이터 초기화**: 서버 종료 후 `server/data/` 삭제 → 재구동 시 기본 게임 3종 재시드.
- **E2E**: `tools/e2e/` (Playwright) — front(`:5173`) + back(`:5175`) 동시 구동 후 실행.

## 📡 API

### LLM (Gemini 프록시)
| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/config` | 현재 LLM 모드(real/mock)·모델 정보 |
| `POST` | `/api/config/redetect` | 키/네트워크 재감지 |
| `POST` | `/api/llm/generate` | 단발 생성 |
| `POST` | `/api/llm/stream` | 스트리밍 생성 (회의 발화용) |
| `POST` | `/api/llm/embed` | 임베딩 |

### 웹검색 (Tavily)
| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/search` | `{query}` — 리서치용 검색 |
| `GET` | `/api/search/state` | 키 로테이션 상태 |
| `GET` | `/api/search/health` | 전체 키 유효성 점검 |

### RAG
| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/rag/upsert` | 문서 임베딩·저장 |
| `POST` | `/api/rag/query` | 유사 문서 검색 |

### 게임 (git 레포 기반)
| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/games` | 게임 목록 |
| `GET` | `/api/games/:id` | 게임 상세 (현재 코드 포함) |
| `POST` | `/api/games` | 새 게임 생성 → git 레포 init + 첫 커밋·태그 |
| `POST` | `/api/games/:id/versions` | 새 버전 — 코드·문서 커밋 + 버전 태그 |
| `GET` | `/api/games/:id/files` | 레포 파일 목록·내용 |
| `GET` | `/api/games/:id/log` | git 커밋 로그 |
| `GET` | `/api/games/:id/diff` | 버전 간 diff |
| `GET` | `/api/games/:id/bundle` | 단독 실행용 HTML 번들 |
| `POST` | `/api/games/:id/feedback` | 오락실 손님 피드백 저장 |
| `DELETE` | `/api/games/:id` | 게임 삭제 |

### 회의·채팅
| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET/POST` | `/api/meetings` | 회의록 조회·저장 |
| `GET/POST` | `/api/chats/:agent` | 팀원별 1:1 채팅 히스토리 |

### 공유 플레이
| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/play/:id` | 샌드박스 iframe 단독 플레이어 페이지 (외부 공유용) |

## 📁 구조

```
server/
  index.js        Express 엔트리 — API 라우팅·/play 플레이어·정적 서빙(단독 모드)
  lib/
    gemini.js     Gemini 프록시 — 스트리밍·폴백·백오프·세마포어·mock 전환
    tavily.js     웹검색 — 키 로테이션(라운드로빈·쿨다운·무효키 제외)
    repos.js      게임별 git 레포 — init·commit·tag·log·diff
    db.js         JSON DB (games·meetings·chats)
    rag.js        임베딩 벡터 저장·코사인 검색
    seed.js       기본 게임 3종 시드
    mock.js       오프라인 mock LLM 응답
  games-src/      기본 게임 3종 원본 — 픽셀 러너·메테오 닷지·스네이크 클래식
  data/           런타임 데이터 (gitignore) — db.json·vectors.json·games/<id>/(git 레포)
docs/             제품 브리프 · PRD · 아키텍처 · 에픽/스토리 · README-monolith(분리 전 원본)
tools/e2e/        Playwright E2E 스크립트
_bmad/, .claude/  BMAD Method v6 설치본 (이 프로젝트 자체를 BMAD로 제작)
```

## 게임팩 계약

에이전트가 생성하는 게임은 **단일 파일 JS 캔버스 게임**으로, 프론트의 샌드박스 iframe(`allow-scripts`) 안에서 실행됩니다. `postMessage` 토큰 기반으로 키 입력 주입·정지·점수/게임오버 이벤트를 주고받아, 자동 QA 스모크 테스트와 20명 손님 봇 플레이가 가능합니다.
