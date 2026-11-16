#!/bin/bash
# 병합 큐 스크립트 (#602). 메인 세션이 scratchpad 에 두고 쓰던 mergepr.sh 를 저장소로 옮기고 굳힌 것이다.
#
# 쓰는 법:
#   scripts/dev/merge.sh <pr> --head <전체 SHA 40자> --subject <스쿼시 제목> [--body <본문> | --body-file <파일>] --note <병합 직전 댓글에 붙일 한 줄> [--dry-run] [--repo <소유자/저장소>]
#   (플래그 없이 위치 인자로도 받는다: merge.sh <pr> <head> <제목> <본문> <메모>)
#
# 하는 일, 순서대로(하나라도 어기면 멈추고 종료 1 - 병합하지 않는다):
#   1. 입력 점검: PR 번호·40자 SHA·제목이 있어야 한다. 제목·본문·메모에 Co-Authored-By / Claude-Session / "Generated with ... Claude" 줄이 있으면 거부한다(이 도구는 그런 줄을 쓰지 않는다).
#   2. 부류 판정: `gh api --paginate repos/<저장소>/pulls/<pr>/files` 의 파일 경로(이름 바뀐 파일은 옛 경로도)로 정한다. 데이터·워크플로·수집기 경로를 하나라도 건드리면 「데이터 부류」, 아니면 「안전 부류」(틀·CSS·시험·문서).
#      목록의 파일 수가 `gh pr view --json changedFiles` 와 다르면 중단한다(이 엔드포인트는 3000파일에서 잘린다 - 다 못 읽은 목록으로 안전 부류를 내지 않는다).
#      데이터 부류 경로: scripts/fetch-*·scripts/build-*·scripts/news-context*·scripts/push-docs.sh·scripts/update-all.mjs·.github/workflows/·.gitignore·package.json·docs/data/·raw/
#   3. 검사 대기: 검사 이름 `test` 와 `render` 가 둘 다 SUCCESS 가 될 때까지 기다린다. **어떤 검사든 FAILURE(ERROR·TIMED_OUT 포함)면 즉시 중단**한다. 기다리는 동안에도 head 가 기대한 SHA 에서 움직이면 즉시 중단한다.
#   4. 진행 중 실행 대기(busy 규칙): **데이터 부류에만** 적용한다 - PR 이벤트가 아닌 실행(수집·요약·배포)이 모두 끝나길 기다린다. 안전 부류는 기다리지 않는다(무관한 Daily·Summarize 를 기다리는 낭비 제거).
#   5. head 재확인: PR head 가 기대한 SHA 와 다르면 중단(검사도 한 번 더 본다).
#      이어서 최신성(#926): `gh api repos/<저장소>/compare/main...<SHA>` 의 behind_by 가 0 이 아니면 중단한다 - PR CI 가 지금 main 을 품은 채 돌지 않았다는 뜻이다
#      (#919·#923 은 파일이 겹치지 않고 같은 base 위 PR CI 를 각각 통과했지만 연달아 병합되자 main Test 가 빨개졌다, #924). 읽기에 실패해도(rc≠0 또는 숫자가 아닌 출력) 중단한다.
#      처방은 ENGINEER-COMMON 「병합」 절: gh pr update-branch → 새 PR CI → 재검증 → 새 head 로 다시 부른다. 데이터 커밋 때문에 뒤진 경우도 예외가 없다.
#   6. 병합 직전 댓글을 남기고, `gh pr merge --squash --admin --match-head-commit <SHA>` 로 스쿼시 병합한다. `Base branch was modified` 는 최대 3번(시도 사이 대기 MERGE_RETRY_SLEEP 초)까지 다시 하되,
#      다시 하기 전마다 behind_by 를 또 읽는다 - 그 오류는 main 이 막 움직였다는 뜻이고 --match-head-commit 은 head 만 고정한다. 그새 뒤졌으면 MERGED 없이 종료 1.
#      남는 틈: 마지막 behind_by 확인과 병합 호출 사이 몇 초 안에 main 이 움직이면 오류 없이 새 main 위에 병합될 수 있다 - 그건 7단계 push Test 가 사후에 잡는다.
#   7. `MERGED <sha>` 를 찍고, 병합 커밋에서 `Test` 와 `Deploy site` 실행이 끝나길 기다려 결론을 찍는다(`Test: success` 식). 둘 중 하나가 success 가 아니거나 시간 안에 안 끝나면 종료 4(병합은 된 상태).
#      Test 는 push 이벤트 run 만 본다(#926 - 같은 커밋에 붙은 workflow_dispatch·workflow_run Test 성공이 push Test 실패를 가리지 않게). Deploy site 는 이벤트를 가리지 않고 가장 새 run 을 본다.
#
# --dry-run: 읽기 호출만 한다. 부류·검사 상태·head 일치·최신성(`[dry-run] 최신성: behind_by=N (main 기준)`)·남길 댓글·병합 명령·병합 뒤 대기를 찍고 아무것도 쓰지 않는다(댓글·병합 없음, 기다리지도 않는다).
#            중단 사유(실패 검사·head 이동·behind_by>0·compare 읽기 실패)가 이미 있으면 종료 1, 없으면 0(검사가 아직 진행 중이면 「병합 전 대기」로 표시).
#
# 종료 코드: 0 병합 완료(그리고 Test·Deploy site 성공)/dry-run 통과, 1 중단(병합 안 함), 2 사용법 오류, 4 병합됨 + 병합 뒤 Test·Deploy 가 success 아님.
# 환경(시험이 줄인다): MERGE_REPO(기본 kyhsa93/jipgye) · MERGE_CHECK_POLLS(120)·MERGE_CHECK_SLEEP(20) · MERGE_BUSY_POLLS(120)·MERGE_BUSY_SLEEP(30)
#   · MERGE_RETRY_SLEEP(8) · MERGE_POST_POLLS(180)·MERGE_POST_SLEEP(15) · NODE24_BIN(JSON 읽는 Node, 없으면 PATH 의 node → 공유 폴더의 node24)
# 이 도구는 파일을 고치지 않는다. 병합 뒤 워크트리·브랜치 정리와 count:bump 는 하지 않는다(병합 담당이 따로 한다).

REPO="${MERGE_REPO:-kyhsa93/jipgye}"
CHECK_POLLS="${MERGE_CHECK_POLLS:-120}"; CHECK_SLEEP="${MERGE_CHECK_SLEEP:-20}"
BUSY_POLLS="${MERGE_BUSY_POLLS:-120}"; BUSY_SLEEP="${MERGE_BUSY_SLEEP:-30}"
RETRY_SLEEP="${MERGE_RETRY_SLEEP:-8}"
POST_POLLS="${MERGE_POST_POLLS:-180}"; POST_SLEEP="${MERGE_POST_SLEEP:-15}"
SHARED="${JIPGYE_SHARED:-$HOME/workspace/jipgye.worktrees/_shared}"

USAGE='사용법: scripts/dev/merge.sh <pr> --head <전체 SHA> --subject <제목> [--body <본문>|--body-file <파일>] --note <메모> [--dry-run] [--repo <소유자/저장소>]'
die() { echo "merge 중단: $*" >&2; exit 1; }
usage() { echo "$1" >&2; echo "$USAGE" >&2; exit 2; }

PR=""; HEAD=""; SUBJ=""; BODY=""; NOTE=""; DRY=0; POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --head|--subject|--body|--body-file|--note|--repo)
      [ $# -ge 2 ] || usage "$1 뒤에 값이 필요하다"
      case "$1" in
        --head) HEAD="$2" ;; --subject) SUBJ="$2" ;; --body) BODY="$2" ;; --note) NOTE="$2" ;; --repo) REPO="$2" ;;
        --body-file) [ -f "$2" ] || usage "--body-file 을 읽을 수 없다: $2"; BODY="$(cat "$2")" ;;
      esac
      shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) echo "$USAGE"; exit 0 ;;
    --*) usage "알 수 없는 플래그: $1" ;;
    *) POS+=("$1"); shift ;;
  esac
done
# 위치 인자: pr [head [제목 [본문 [메모]]]] - 플래그로 이미 준 값은 덮지 않는다.
[ "${#POS[@]}" -le 5 ] || usage "위치 인자가 너무 많다"
[ "${#POS[@]}" -ge 1 ] && PR="${POS[0]}"
[ "${#POS[@]}" -ge 2 ] && [ -z "$HEAD" ] && HEAD="${POS[1]}"
[ "${#POS[@]}" -ge 3 ] && [ -z "$SUBJ" ] && SUBJ="${POS[2]}"
[ "${#POS[@]}" -ge 4 ] && [ -z "$BODY" ] && BODY="${POS[3]}"
[ "${#POS[@]}" -ge 5 ] && [ -z "$NOTE" ] && NOTE="${POS[4]}"

case "$PR" in ''|*[!0-9]*) usage "PR 번호(숫자)가 필요하다" ;; esac
printf '%s' "$HEAD" | grep -qE '^[0-9a-f]{40}$' || usage "--head 는 소문자 16진 40자 전체 SHA 여야 한다"
[ -n "$SUBJ" ] || usage "--subject(스쿼시 제목)가 필요하다"
[ -n "$NOTE" ] || usage "--note(병합 직전 댓글에 붙일 한 줄)가 필요하다"
if printf '%s\n%s\n%s\n' "$SUBJ" "$BODY" "$NOTE" | grep -qiE 'co-authored-by|claude-session|generated with.*claude'; then
  die "제목·본문·메모에 Co-Authored-By / Claude-Session / Generated with Claude 줄이 있다 - 지우고 다시 부른다."
fi
command -v gh >/dev/null 2>&1 || die "gh 를 찾을 수 없다."

# JSON 을 읽는 Node: NODE24_BIN → PATH 의 node → 공유 폴더의 node24.
NODE=""
for cand in "${NODE24_BIN:-}" "$(command -v node 2>/dev/null)" "$SHARED/node24/bin/node"; do
  [ -n "$cand" ] && [ -x "$cand" ] && { NODE="$cand"; break; }
done
[ -n "$NODE" ] || die "Node 를 찾을 수 없다(NODE24_BIN 을 주거나 PATH 에 둔다)."

say() { echo "merge: $*"; }

# ── 부류 ────────────────────────────────────────────────────────────────────────────
DATA_RE='^(scripts/(fetch-[^/]*|build-[^/]*|news-context[^/]*|push-docs\.sh|update-all\.mjs)|\.github/workflows/.*|\.gitignore|package\.json|docs/data/.*|raw/.*)$'
# `gh pr diff --name-only` 는 diff 미디어 타입으로 받아 300파일을 넘으면 406(too_large)으로 거절된다(#887, PR #885 329파일).
# 그래서 파일 API 를 페이지마다 읽는다. 이름 바뀐 파일의 옛 경로(previous_filename)도 판정에 넣는다 - raw/ 에서 나가는 이동도 데이터 부류다.
# 줄마다 꼬리표를 붙인다(F 새 경로, P 옛 경로): 옛 경로 줄을 빼고 세야 changedFiles 와 맞는다(PR #496 이름 변경 1건 - 7줄, changedFiles 6).
LISTED="$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" --jq '.[] | "F " + .filename, (.previous_filename // empty | "P " + .)' 2>&1)" \
  || die "PR #$PR 의 파일 목록을 못 읽었다: $(printf '%s' "$LISTED" | tail -1)"
FILES="$(printf '%s\n' "$LISTED" | sed -n 's/^[FP] //p')"
[ -n "$FILES" ] || die "PR #$PR 의 파일 목록이 비었다."
NLISTED="$(printf '%s\n' "$LISTED" | grep -c '^F ')"
CHANGED="$(gh pr view "$PR" -R "$REPO" --json changedFiles --jq .changedFiles 2>&1)" || die "PR #$PR 의 changedFiles 를 못 읽었다: $(printf '%s' "$CHANGED" | tail -1)"
[ "$NLISTED" = "$CHANGED" ] || die "PR #$PR 파일 목록 $NLISTED개가 changedFiles $CHANGED개와 다르다(목록이 잘렸을 수 있다) - 부류를 정할 수 없어 병합하지 않는다."
DATA_HITS="$(printf '%s\n' "$FILES" | grep -E "$DATA_RE" | head -3 | tr '\n' ' ')"
if [ -n "$DATA_HITS" ]; then CLASS=data; else CLASS=safe; fi
say "PR #$PR 부류=$([ $CLASS = data ] && echo "데이터(busy 규칙 적용; 닿은 경로: ${DATA_HITS% })" || echo "안전(busy 규칙 생략)") 파일 ${NLISTED}개"

# ── 검사 상태 ────────────────────────────────────────────────────────────────────────
# 한 번 읽어 「<판정> <head>」 한 줄로 낸다. 판정: OK(test·render 둘 다 SUCCESS) | PENDING | FAIL:<이름들>(FAILURE·ERROR·TIMED_OUT·STARTUP_FAILURE 가 하나라도).
CHECK_JS='
let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const j = JSON.parse(s || "{}");
  const roll = j.statusCheckRollup || [];
  const nm = (e) => e.name || e.context || "?";
  const cc = (e) => String(e.conclusion || e.state || "").toUpperCase();
  const bad = roll.filter((e) => ["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE"].includes(cc(e))).map(nm);
  const ok = (n) => roll.some((e) => nm(e) === n && cc(e) === "SUCCESS");
  const verdict = bad.length ? "FAIL:" + [...new Set(bad)].join(",") : ok("test") && ok("render") ? "OK" : "PENDING";
  console.log(verdict + " " + (j.headRefOid || "?"));
});'
read_checks() { # → VERDICT, CUR (읽기 실패면 둘 다 ERR)
  local out
  out="$(gh pr view "$PR" -R "$REPO" --json headRefOid,statusCheckRollup 2>/dev/null | "$NODE" -e "$CHECK_JS" 2>/dev/null)" || out=""
  if [ -z "$out" ]; then VERDICT=ERR; CUR=?; else VERDICT="${out%% *}"; CUR="${out##* }"; fi
}
abort_if_bad() { # 실패 검사·head 이동이면 중단
  # 같은 head 의 옛 FAILURE run 은 rerun·close/reopen 으로 롤업에서 지워지지 않는다(새 run 이 하나 더 붙을 뿐, #918 38dae3ed 2026-11-16) - 그래서 안내는 update-branch 다.
  case "$VERDICT" in FAIL:*) die "실패한 검사가 있다(${VERDICT#FAIL:}) - 병합하지 않는다. 같은 head 의 옛 실패 run 이면 ENGINEER-COMMON 「병합」 절대로 gh pr update-branch $PR." ;; esac
  [ "$CUR" = "?" ] || [ "$CUR" = "$HEAD" ] || die "PR head 가 움직였다: $CUR (기대 $HEAD) - 병합하지 않는다."
}

# ── 최신성(#926) ─────────────────────────────────────────────────────────────────────
# PR head 가 main 보다 몇 커밋 뒤인지(behind_by). 기준 브랜치는 `main` 글자다 - 모든 PR 이 main 을 겨눈다. ?per_page=1 은 응답의 커밋 목록만 줄인다(값은 같다).
# 404 면 gh 가 rc 1 을 내면서 에러 JSON 을 표준출력에도 찍는다(2026-11-16 실측) - 그래서 rc 와 숫자 형식을 둘 다 본다. 둘 중 하나라도 어긋나면 읽지 못한 것으로 보고 멈춘다.
read_behind() { # → BEHIND (숫자). 읽지 못하면 중단.
  local out rc
  out="$(gh api "repos/$REPO/compare/main...$HEAD?per_page=1" --jq .behind_by 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] || die "compare 를 읽지 못했다(종료 $rc): $(printf '%s' "$out" | tail -1) - 최신성을 모르니 병합하지 않는다."
  [[ "$out" =~ ^[0-9]+$ ]] || die "compare 를 읽지 못했다(behind_by 가 숫자가 아니다: '$out') - 최신성을 모르니 병합하지 않는다."
  BEHIND="$out"
}
abort_if_behind() {
  [ "$BEHIND" = 0 ] || die "PR #$PR 이 main보다 ${BEHIND}커밋 뒤 - 가지를 최신 main 으로 올리고(gh pr update-branch $PR) CI 를 다시 돌린 뒤 다시 부른다(ENGINEER-COMMON 「병합」 절)."
}

COMMENT_TAIL="$NOTE"
NOW_UTC() { date -u +%FT%TZ; }
MERGE_CMD="gh pr merge $PR -R $REPO --squash --admin --match-head-commit $HEAD --subject <제목> --body <본문>"

if [ "$DRY" = 1 ]; then
  read_checks
  say "[dry-run] head 기대 $HEAD / 현재 $CUR"
  abort_if_bad
  case "$VERDICT" in
    OK) say "[dry-run] 검사: test·render SUCCESS" ;;
    PENDING) say "[dry-run] 검사: test·render 아직 SUCCESS 아님 - 실제로는 최대 $((CHECK_POLLS * CHECK_SLEEP))초 기다린다" ;;
    *) say "[dry-run] 검사 상태를 읽지 못했다" ;;
  esac
  read_behind
  say "[dry-run] 최신성: behind_by=$BEHIND (main 기준)"
  abort_if_behind
  if [ $CLASS = data ]; then say "[dry-run] busy 규칙: PR 이벤트가 아닌 실행이 0 이 될 때까지 기다린다"; else say "[dry-run] busy 규칙: 안전 부류라 기다리지 않는다"; fi
  say "[dry-run] 남길 댓글: 병합 직전 점검(<UTC>): test·render SUCCESS · $COMMENT_TAIL"
  say "[dry-run] 병합: $MERGE_CMD (Base branch was modified 면 최대 3번)  제목=$SUBJ"
  say "[dry-run] 병합 뒤: MERGED <sha> 를 찍고 병합 커밋의 Test·Deploy site 결론을 기다린다. 아무것도 쓰지 않았다."
  exit 0
fi

# ── 3. 검사 대기 ──────────────────────────────────────────────────────────────────────
i=0; GREEN=0
while [ "$i" -lt "$CHECK_POLLS" ]; do
  read_checks; abort_if_bad
  [ "$VERDICT" = OK ] && { GREEN=1; break; }
  i=$((i + 1)); sleep "$CHECK_SLEEP"
done
[ "$GREEN" = 1 ] || die "test·render 가 제한 시간 안에 SUCCESS 가 되지 않았다(마지막 판정: $VERDICT)."
say "검사: test·render SUCCESS"

# ── 4. busy 규칙(데이터 부류만) ───────────────────────────────────────────────────────
BUSY_JS='
let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const runs = JSON.parse(s || "[]");
  console.log(runs.filter((r) => r.status !== "completed" && r.event !== "pull_request").length);
});'
busy_count() { gh run list -R "$REPO" --limit 20 --json status,event 2>/dev/null | "$NODE" -e "$BUSY_JS" 2>/dev/null || echo "?"; }
if [ $CLASS = data ]; then
  i=0; K=?
  while [ "$i" -lt "$BUSY_POLLS" ]; do
    K="$(busy_count)"; [ "$K" = 0 ] && break
    i=$((i + 1)); sleep "$BUSY_SLEEP"
  done
  [ "$K" = 0 ] || die "데이터 부류인데 진행 중인 실행이 남아 있다(수: $K) - busy 규칙."
  BUSY_NOTE="push/schedule/workflow_run 실행 중 0"
else
  BUSY_NOTE="busy 규칙 생략(안전 부류)"
fi

# ── 5. head 재확인 ────────────────────────────────────────────────────────────────────
read_checks; abort_if_bad
[ "$VERDICT" = OK ] || die "병합 직전 재확인에서 test·render 가 SUCCESS 가 아니다(판정: $VERDICT)."
read_behind; abort_if_behind   # 병합 직전 댓글보다 먼저 - 멈추면 댓글도 남기지 않는다

# ── 6. 댓글 + 병합 ────────────────────────────────────────────────────────────────────
gh pr comment "$PR" -R "$REPO" --body "병합 직전 점검($(NOW_UTC)): test·render SUCCESS · $BUSY_NOTE · $COMMENT_TAIL" >/dev/null || die "병합 직전 댓글을 남기지 못했다."
MERGED_OK=0
for t in 1 2 3; do
  # 재시도 전마다 다시 읽는다: Base branch was modified 는 main 이 막 움직였다는 뜻이다. 다시 보지 않으면 시험하지 않은 새 main 위에 병합된다(#924 와 같은 부류).
  [ "$t" -gt 1 ] && { read_behind; abort_if_behind; }
  out="$(gh pr merge "$PR" -R "$REPO" --squash --admin --match-head-commit "$HEAD" --subject "$SUBJ" --body "$BODY" 2>&1)"; rc=$?
  if printf '%s' "$out" | grep -qi 'base branch was modified'; then
    say "Base branch was modified - 재시도 $t/3"
    [ "$t" -lt 3 ] && sleep "$RETRY_SLEEP"
    continue
  fi
  if [ "$rc" -ne 0 ]; then echo "$out" | tail -3 >&2; die "병합 실패(종료 $rc)."; fi
  MERGED_OK=1; break
done
[ "$MERGED_OK" = 1 ] || die "Base branch was modified 가 3번 이어졌다 - 병합하지 않았다."

# 병합 커밋 SHA 를 읽는다(상태 반영이 늦을 수 있어 몇 번 본다).
SHA=""
for _ in 1 2 3 4 5 6 7 8; do
  SHA="$(gh pr view "$PR" -R "$REPO" --json state,mergeCommit 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s||"{}");if(j.state==="MERGED"&&j.mergeCommit&&j.mergeCommit.oid)console.log(j.mergeCommit.oid)})' 2>/dev/null)"
  [ -n "$SHA" ] && break
  sleep "$RETRY_SLEEP"
done
[ -n "$SHA" ] || die "병합 명령은 성공했으나 병합 커밋을 읽지 못했다 - PR #$PR 상태를 직접 확인한다."
echo "MERGED $SHA"

# ── 7. 병합 커밋의 Test·Deploy site ───────────────────────────────────────────────────
POST_JS='
let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const runs = JSON.parse(s || "[]");
  // Test 는 push run 만(#926): test.yml 에 workflow_dispatch 가 있고(#927 뒤엔 workflow_run 도) 같은 headSha 에 붙은 다른 이벤트의 성공 run 이 더 새면 push Test 실패를 가린다.
  // Deploy site 는 이벤트를 가리지 않는다: 어느 이벤트든 main HEAD 를 체크아웃해 같은 사이트를 만들고, concurrency pages 는 대기 중인 run 을 가장 새 것 하나만 남긴다 -
  // push 로 좁히면 더 새 run 에 밀려 취소된 push 배포가 거짓 종료 4 가 된다.
  const one = (n, ev) => { const r = runs.find((x) => x.workflowName === n && (!ev || x.event === ev)); return r ? (r.status === "completed" ? String(r.conclusion || "unknown").toLowerCase() : "pending") : "pending"; };
  console.log(one("Test", "push") + " " + one("Deploy site"));
});'
T=pending; D=pending; i=0
while [ "$i" -lt "$POST_POLLS" ]; do
  r="$(gh run list -R "$REPO" --commit "$SHA" --limit 30 --json workflowName,event,status,conclusion 2>/dev/null | "$NODE" -e "$POST_JS" 2>/dev/null)"
  [ -n "$r" ] && { T="${r% *}"; D="${r#* }"; }
  [ "$T" != pending ] && [ "$D" != pending ] && break
  i=$((i + 1)); sleep "$POST_SLEEP"
done
echo "Test: $T"
echo "Deploy site: $D"
[ "$T" = success ] && [ "$D" = success ] && exit 0
exit 4
