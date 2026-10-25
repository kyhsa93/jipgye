# jipgye 엔지니어 공통 브리프 (작업별 브리프는 이 파일을 경로로 가리키고 차이만 적는다)

- 첫 줄: `.claude/agents/engineer.md` 를 읽는다. 이슈는 `gh issue view N -R kyhsa93/jipgye --comments`. 승인된 패턴이 있으면 `.claude/patterns.md` 의 해당 절을 읽고 PR 본문에 패턴 ID 를 적는다.
- 작업 위치: 격리 워크트리, 시작 전 `git fetch origin` 후 origin/main 기준.
- Node 24: 타입 스트리핑이 켜진 Node 24 가 PATH 앞에 있어야 한다(`node -p 'process.features.typescript'` → `strip`). 다른 곳에 있으면 `export PATH=<Node 24 의 bin 폴더>:$PATH`. 골든 도구는 `NODE24_BIN=<Node 24 바이너리 경로>` 로도 받는다(없으면 PATH 의 node).
- 의존성(첫 단계): `export PATH=~/workspace/jipgye.worktrees/_shared/bin:~/workspace/jipgye.worktrees/_shared/node24/bin:$PATH; scripts/dev/doctor.sh --link`(#608 — Node 24·react-dom·`node_modules`·`tools/golden/node_modules`·`tools/typescript/node_modules`(tsc) 점검, 없으면 공유 사본으로 링크). doctor 가 실패할 때만 `npm ci`. **`npm run test:site`·`health` 앞에는 항상 `node scripts/render-pipeline.ts --out=build/site`**(build/site 가 낡으면 헛통과·헛실패한다; `npm test` 는 pretest 가 한다).
- 레이아웃(컷오버 B4 이후): main 에 생성 HTML 없음(docs/ 에는 손으로 고치는 틀 14장+정적 자산+docs/data), 사이트는 배포 때 `render-pipeline.ts --out=build/site`. 시험이 생성 장을 읽을 때는 `test/helpers/site-root.mjs` 의 SITE. `npm test` 는 pretest 로 build/site 를 만든다. `npm run test:site`(= build/site 를 읽는 시험 부분집합)가 배포 게이트.
- 통과해야 할 것: `npm test`, `npm run test:site`, `npm run health`(작업이 건드린 패키지의 `tools/*` `npm test` 포함).
- 로컬 관문(골든·훅 목록 대조·COUNT·바이트 표): `scripts/dev/gate.sh` — #601 이 병합되면(**있을 때**) PR 전에 한 번 돌리고 원문을 보고에 붙인다. 없으면 위 명령과 골든 증빙으로 대신한다.
- tsc 도 로컬에서 gate.sh 로 돌린다(CI 와 같은 명령 — tools/typescript 에서 `tsc -p tsconfig.json`; 도구는 `doctor.sh --link` 가 잇는다). 「tsc 가 로컬에 없다」며 건너뛰지 않는다 — gate 의 tsc 줄이 SKIP 이면 doctor 를 먼저 고친다.
- **시험 하한(COUNT)은 건드리지 않는다**(내릴 때만 예외 — 본문에 사유, #315 범위 4). 올리는 것은 병합 담당이 하루 끝에 `npm run count:bump` 로 한 번 한다(#548). COUNT 파일은 고정 머리 ≤6줄 + 숫자 둘이고 설명 블록을 쓰지 않는다 — 설명은 PR 본문.
- 골든 PR 증빙: `scripts/dev/golden-run.sh [--pattern P1] <이름>`(URL 없이). 결과의 하드 실패 id·S6 바이트를 **원문 그대로** 보고에 붙인다. 1차 출력에 「불변 비교」 줄이 없으면 도구가 `tail -5` 를 찍는다 — 그것도 그대로. expect 파일은 쓰지 않는다(판정 뒤 메인 세션이 `scripts/dev/golden-run.sh --pattern P1 <이름> <판정댓글URL>` 로 만든다). 도구는 실행마다 `<os.tmpdir()>/jipgye-golden-run-<head8>-<pid>.XXXXXX` 를 따로 만들고 끝나면(종료·INT·TERM) 그 폴더만 지운다(옛 공유 `<tmpdir>/jipgye-golden` 은 더는 지우지 않는다 — 병렬 에이전트가 서로 지우던 사고, #626). 기준 렌더를 작업 사이에 재사용하려면 opt-in `--shared-cache`(`_shared/golden-cache`).
- 커밋: 한국어, `Refs #N`, Co-Authored-By / Claude-Session / "Generated with Claude Code" 줄 금지. push·PR 금지(메인 세션 몫).
- 멈추고 보고할 것: 바이트 한도(장당 +400 B) 초과, `docs/load-state.js` 변경, 새 S6 예외(인라인 바이트 외), 새 하드 실패 id, 허용 목록 밖 파일, 소유자·cto 결정이 필요한 것.

## 결정 사전 위임표 (cto 서명 완료 — 위 줄, #603)

판정(pm·cto)이 **착수 전** 이슈의 「위임 범위」 칸에 한도를 적는다. 칸이 있고 범위 안이면 멈추지 않고 PR 본문 「일탈」에 적는다. 칸이 없으면 아래 「위임」 열은 없는 것으로 보고 위 「멈추고 보고할 것」을 따른다.

| 항목 | 위임(보고만) | 멈춤 |
|---|---|---|
| 글자·문구 수치 한도 | 이슈 한도 +20% 까지, 의도한 변경 목록과 일치할 때 | +20% 초과, 빈 공간·내용 이동으로 수치만 맞추는 것 |
| 인라인 JS 순증 | 없음(P1 +400 B/장 그대로) | 초과 즉시 |
| CSS 순증 | 이슈 한도 +2.5KB 까지, 합계 ≤4KB(둘 중 작은 쪽) | 4KB 초과, 새 외부 의존 |
| 손으로 쓴 diff 줄 | 이슈 한도 +25% 까지, 단 ≤250줄(둘 중 작은 쪽) | 초과, 데이터 파일 제외 계산이 모호할 때 |
| 골든 하드 실패 | 이슈 본문이 의도로 적은 항목과 글자 그대로 일치하면 expect **후보**로 보고(expect 는 판정 뒤 메인 세션이 만든다) | 목록 밖 id 1건이라도, 새 S6 예외 종류 |
| 파일 범위 | 같은 폴더의 시험 파일·헬퍼·픽스처 추가 | 워크플로·수집기·`docs/load-state.js`·scripts 데이터 생성부 |
| `tools/golden/hook-classes.json` | 소스가 **늘어서** 어긋나면 `--hooks-write` 로 다시 만들고 보고 | 줄어서 어긋남(왜 줄었는지부터), `HOOKCOUNT` 하한 인하 |
| 시험 하한(`test/COUNT*`) | 올리지 않는다(#548). 내림은 같은 PR 본문 사유 + 전체 판정(패턴·위임 밖) | 사유 없는 인하, 다른 PR 에서 내림 |
| 측정 재실행 | 같은 조건 3회까지 | 4회째부터 5줄 요약 후 새 에이전트 |
| 에이전트 재개 | 같은 PR delta 1회(SendMessage) | 2회째부터 5줄 요약을 넘기고 새로 띄움 |

돈·법무·신원·소유자 로그인/설정·기계 조작·이력 정리·새 공개 노출은 어떤 칸으로도 위임하지 않는다. 위임은 engineer 가 멈출지만 정하며, 워크플로·수집기·데이터 경로·D 등급 병합은 cto+cpo 판정 그대로다.

서명(cto): 2026-10-25 · PR #614 판정 댓글 https://github.com/kyhsa93/jipgye/pull/614#issuecomment-6396568822

## 판정은 PR 하나에 한 댓글 (P1 밖 모든 PR, #603)

판정 에이전트 하나가 cto·cpo·po·cmo 중 **그 PR 에 필요한 이들**의 서명 줄을 **한 댓글**에 쓴다(단일 역할 판정을 따로 띄우지 않는다). D 등급·제품 범위 변경·워크플로·수집기·데이터 경로 접촉이면 cto+cpo 둘 다 서명한다. 재판정은 마지막 판정 SHA 이후 바뀐 줄만 보고, 통과면 한 줄(`<SHA> 통과, 서명`)이다. 길이 ≤8줄은 그대로.

## 모델 등급·에이전트 재사용 (메인 세션이 띄울 때, #603)

- **sonnet**: 판정(패턴 해당·delta·재판정)·측정 재실행·장부(pm 기록·종결)·문서·좁은 구현. **opus(상속)**: 설계·모호한 판단·D 등급 첫 판정·새 메커니즘.
- 앞선 맥락이 필요하면 `fork`, 아니면 새 에이전트에 브리프는 이슈·이 파일 **링크**로 짧게. 같은 PR 의 delta 는 `SendMessage` 로 이어 가되 1회, 그 뒤는 요약 5줄로 새로 띄운다.

## 작은 PR 묶기·브리프 틀 (#604)

- **묶기**: 같은 패턴·같은 파일군의 S 크기 이슈 2~4개는 PR 하나로(**상한 4** — 실패하면 되돌림 범위가 커진다). 본문에 `Refs #a #b …` 를 모두 적고 이슈별 완료 조건을 따로 확인한다. 패턴이 다르거나 D 등급이 끼면 묶지 않는다.
- **브리프**: 작업 종류별(구현·판정·장부·측정) ≤20줄 — 이슈 번호·이 파일 경로·차이만 적고 본문은 붙이지 않는다. 보고는 아래 양식 ≤10줄, pm·ceo 에게 올리는 보고는 ≤12줄.
- **재개**: 위 「에이전트 재개」 칸 그대로 — 같은 PR 의 delta 1회, 2회째부터 5줄 요약으로 새로 띄운다.

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
