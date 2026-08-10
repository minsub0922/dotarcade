# 🕹️ DOTCADE Back

멀티에이전트 게임 스튜디오 & 오락실 운영 시뮬레이션의 **백엔드** (Express).
Gemini 프록시(스트리밍·웹검색 grounding·임베딩·모델 폴백·백오프·세마포어), 게임별 **실제 git 레포**(커밋·태그·diff), JSON DB, RAG, `/play/<게임id>` 공유 플레이어를 담당합니다.

프론트 레포: `../front` (dotcade-front, Vite+React — :5173)

## 실행

```bash
npm install
npm start            # http://localhost:5175 (API 전용)
```

- 루트 `.env`에 `GEMINI_API_KEY` 설정 (키가 없거나 오프라인이면 자동으로 **mock 모드** 전환 — 전체 기능 오프라인 데모 가능).
- **웹 검색**: `.env`의 `TAVILY_API_KEYS`(쉼표로 여러 개) — 무료 키를 **로테이션**(라운드로빈 + 실패 시 다음 키 + 쿼터 초과 쿨다운 + 무효 키 자동 제외)으로 사용해 에이전트 리서치에 제공. `POST /api/search {query}`, 키 상태 `GET /api/search/state`, 전 키 점검 `GET /api/search/health`.
- 포트: `.env`의 `PORT`(기본 5175). 프론트(:5173)가 `/api`·`/play`를 이쪽으로 프록시합니다.
- 데이터 초기화: 서버 종료 후 `server/data/` 삭제 (기본 게임 3종은 재시드).
- E2E: `tools/e2e/` (Playwright) — front(:5173)+back(:5175) 동시 구동 후 실행.

## 구조

```
server/index.js     Express 엔트리 — API 라우팅·/play 플레이어·정적 서빙(단독 모드)
server/lib/         gemini(프록시·폴백) · repos(게임 git 레포) · db(JSON) · rag · seed · mock
server/games-src/   기본 게임 3종 — 픽셀 러너·메테오 닷지·스네이크 클래식
docs/               제품 브리프 · PRD · 아키텍처 · 에픽/스토리 · README-monolith(분리 전 원본)
_bmad/, .claude/    BMAD Method v6 설치본 (프로젝트 자체를 BMAD로 제작)
```
