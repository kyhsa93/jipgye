# jipgye 엔지니어 공통 브리프 (작업별 브리프는 이 파일을 경로로 가리키고 차이만 적는다)

- 첫 줄: `.claude/agents/engineer.md` 를 읽는다. 이슈는 `gh issue view N -R kyhsa93/jipgye --comments`. 승인된 패턴이 있으면 `.claude/patterns.md` 의 해당 절을 읽고 PR 본문에 패턴 ID 를 적는다.
- 작업 위치: 격리 워크트리, 시작 전 `git fetch origin` 후 origin/main 기준.
- Node 24: 타입 스트리핑이 켜진 Node 24 가 PATH 앞에 있어야 한다(`node -p 'process.features.typescript'` → `strip`). 다른 곳에 있으면 `export PATH=<Node 24 의 bin 폴더>:$PATH`. 골든 도구는 `NODE24_BIN=<Node 24 바이너리 경로>` 로도 받는다(없으면 PATH 의 node).
- 의존성: `node_modules` 는 공유 사본이 있으면 `ln -s <공유 node_modules> node_modules`(없으면 `npm ci`). `tools/golden` 은 `cd tools/golden && npm ci`(또는 다른 워크트리의 `tools/golden/node_modules` 심볼릭 링크).
- 레이아웃(컷오버 B4 이후): main 에 생성 HTML 없음(docs/ 에는 손으로 고치는 틀 14장+정적 자산+docs/data), 사이트는 배포 때 `render-pipeline.ts --out=build/site`. 시험이 생성 장을 읽을 때는 `test/helpers/site-root.mjs` 의 SITE. `npm test` 는 pretest 로 build/site 를 만든다. `npm run test:site`(= build/site 를 읽는 시험 부분집합)가 배포 게이트.
- 통과해야 할 것: `npm test`, `npm run test:site`, `npm run health`(작업이 건드린 패키지의 `tools/*` `npm test` 포함).
- **시험 하한(COUNT)은 건드리지 않는다**(내릴 때만 예외 — 본문에 사유, #315 범위 4). 올리는 것은 병합 담당이 하루 끝에 `npm run count:bump` 로 한 번 한다(#548). COUNT 파일은 고정 머리 ≤6줄 + 숫자 둘이고 설명 블록을 쓰지 않는다 — 설명은 PR 본문.
- 골든 PR 증빙: `scripts/dev/golden-run.sh [--pattern P1] <이름>`(URL 없이). 결과의 하드 실패 id·S6 바이트를 **원문 그대로** 보고에 붙인다. 1차 출력에 「불변 비교」 줄이 없으면 도구가 `tail -5` 를 찍는다 — 그것도 그대로. expect 파일은 쓰지 않는다(판정 뒤 메인 세션이 `scripts/dev/golden-run.sh --pattern P1 <이름> <판정댓글URL>` 로 만든다). 실행 뒤 도구가 `<os.tmpdir()>/jipgye-golden`(임시 사본)을 지운다.
- 커밋: 한국어, `Refs #N`, Co-Authored-By / Claude-Session / "Generated with Claude Code" 줄 금지. push·PR 금지(메인 세션 몫).
- 멈추고 보고할 것: 바이트 한도(장당 +400 B) 초과, `docs/load-state.js` 변경, 새 S6 예외(인라인 바이트 외), 새 하드 실패 id, 허용 목록 밖 파일, 소유자·cto 결정이 필요한 것.

## 최종 보고 양식 (≤10줄, PR 본문에 그대로)

1. 브랜치 · head SHA
2. 패턴 ID (해당 없으면 `없음`)
3. 일탈 (없음, 또는 목록 — 파일과 이유)
4. 장별 최대 바이트 (장 이름 +N B)
5. 시험: `npm test` tests→pass · `test:site` · health (예: 2039→2039)
6. 골든 하드 실패 id · S6 바이트 원문 그대로
7. 건드린 데이터·워크플로·수집기 (없음)
8. 판단 요청 (없으면 `없음`)

## 판정 에이전트가 읽는 순서

PR 본문 → `gh pr diff --stat` → 일탈 목록의 파일 diff 만. stat 에 `.claude/patterns.md` 의 허용 목록 밖 파일이 보이면 패턴 위임을 접고 **전체 판정**으로 간다. CI 가 초록이고 엔지니어의 골든 원문이 첨부돼 있으면 CI·골든을 다시 돌리지 않는다 — cto 는 표본 한 장만 직접 재현한다. 재검토는 마지막 판정 SHA 이후 바뀐 줄만 본다. 판정 댓글은 ≤8줄(SHA · 해당 패턴 · 일탈 판정 · 서명 — cto+po+cmo 서명 3줄을 한 댓글에).
