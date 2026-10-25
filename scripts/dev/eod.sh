#!/bin/bash
# 하루 끝 의식 한 줄 (#605, 계획 #583 §11 ⑪). 병합 담당이 사이클 끝에 손으로 하던 것을 한 명령으로 모은다. **읽기 위주**다.
#
# 쓰는 법: scripts/dev/eod.sh [--clean] [--no-bump] [--date YYYY-MM-DD] [--repo <소유자/저장소>] [--root <저장소 루트>]
#   (없음)     보기만 한다. 아무것도 지우거나 쓰지 않는다. 커밋·푸시·PR·댓글·병합도 하지 않는다(gh 는 읽기 호출만).
#   --clean    ③ 의 정리 후보만 `git worktree remove` + `git branch -D` 로 지운다. 후보 조건은 아래.
#   --no-bump  ② 를 건너뛴다(시험 다섯 벌을 돌리므로 분 단위로 걸린다).
#   --date     「오늘」 기준일(기본: 오늘, 로컬 날짜). --repo 기본 $EOD_REPO 또는 kyhsa93/jipgye. --root 기본: 이 스크립트가 든 저장소.
#
# 출력(순서대로):
#   ① 병합  기준일 이후 병합된 PR 목록(`#번호 제목 [브랜치]`).
#   ② 하한  `npm run count:bump -- --dry-run` 의 [패키지] 줄 = 쓰게 될 COUNT 변경(tests→pass 숫자). 이어서 S6 기준선(test/s6-baseline.json)의
#           다시 쓸 diff 를 보여 준다 — 기준선을 한 번 다시 만들어 diff 를 뜬 뒤 **원래 파일로 되돌린다**(dry-run 은 이 단계를 건너뛰어서 따로 한다).
#           이 단계가 그 파일을 임시로 쓰는 유일한 곳이다. 루트 시험이 초록이 아니면 S6 는 건너뛴다.
#   ③ 정리  `.claude/worktrees/` 아래 워크트리 중 PR 이 병합된 것(후보)과 건너뛴 것(이유 한 줄). 후보 = 그 브랜치의 병합된 PR 이 있고, 로컬 브랜치 끝이
#           PR 의 마지막 head 와 같고(병합 뒤 로컬 커밋 없음), 잠기지 않았고(locked = 실행 중 에이전트), 미커밋 변경이 없고, 지금 이 워크트리·기본 저장소가 아니다.
#           기본 저장소(소유자 체크아웃)·그 브랜치·`.claude/worktrees` 밖 워크트리와 브랜치는 어떤 경우에도 지우지 않는다. `--force` 는 쓰지 않는다.
#   ④ 열림  열린 PR 과 검사 상태(통과·실패·대기 개수).
#   ⑤ 요약  상태 요약 파일에 붙일 한 줄.
# 종료 코드: 0 정상, 1 gh 호출 실패(병합 목록·정리 후보를 못 만들었다 — --clean 은 아무것도 지우지 않는다), 2 사용법 오류.
# 환경(시험이 줄인다): NODE24_BIN(JSON 읽는 Node 24, 없으면 PATH 의 node).

CLEAN=0; BUMP=1; DATE_ARG=""; REPO="${EOD_REPO:-kyhsa93/jipgye}"; ROOT=""
USAGE='사용법: scripts/dev/eod.sh [--clean] [--no-bump] [--date YYYY-MM-DD] [--repo <소유자/저장소>] [--root <저장소 루트>]'
usage() { echo "$1" >&2; echo "$USAGE" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) CLEAN=1; shift ;;
    --no-bump) BUMP=0; shift ;;
    --date|--repo|--root) [ $# -ge 2 ] || usage "$1 뒤에 값이 필요하다"
      case "$1" in --date) DATE_ARG="$2" ;; --repo) REPO="$2" ;; --root) ROOT="$2" ;; esac; shift 2 ;;
    -h|--help) echo "$USAGE"; exit 0 ;;
    *) usage "알 수 없는 인자: $1" ;;
  esac
done
case "$DATE_ARG" in ""|[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) usage "--date 는 YYYY-MM-DD 모양이다: $DATE_ARG" ;; esac
DAY="${DATE_ARG:-$(date +%F)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$ROOT" ] || ROOT="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || { echo "eod 실패: 저장소 루트를 열 수 없다." >&2; exit 2; }
NODE="${NODE24_BIN:-node}"
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/jipgye-eod.XXXXXX")" || { echo "eod 실패: 임시 폴더를 만들 수 없다." >&2; exit 2; }
S6_FILE="test/s6-baseline.json"; S6_BACKUP=""
restore_s6() { [ -n "$S6_BACKUP" ] && [ -f "$S6_BACKUP" ] && cp "$S6_BACKUP" "$ROOT/$S6_FILE"; S6_BACKUP=""; }
trap 'restore_s6; rm -rf "$TMPD"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

RC=0
GH_OK=1
# gh 읽기 호출: 실패하면 GH_OK=0 으로 표시하고 빈 JSON 배열을 돌려준다.
ghj() {
  local out
  if out="$(gh "$@" 2>"$TMPD/gh.err")"; then echo "$out"
  else GH_OK=0; RC=1; echo "[]"; echo "eod 경고: gh $* 실패 - $(head -c 200 "$TMPD/gh.err")" >&2; fi
}

echo "== 하루 끝 $DAY ($REPO) =="

# ── ① 오늘 병합된 PR ─────────────────────────────────────────────────────────────
ghj pr list -R "$REPO" --state merged --search "merged:>=$DAY" --limit 100 --json number,title,headRefName > "$TMPD/merged-today.json"
MERGED_N="$("$NODE" -e '
const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const p of l) console.log("  #" + p.number + " " + p.title.slice(0, 70) + " [" + p.headRefName + "]");
console.error(l.length);
' "$TMPD/merged-today.json" 2>"$TMPD/n" )"
N_TODAY="$(cat "$TMPD/n")"
echo "① 오늘 병합 ${N_TODAY:-0}건"
[ -n "$MERGED_N" ] && echo "$MERGED_N"
NUMS="$("$NODE" -e 'const n = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).map((p) => "#" + p.number); console.log(n.slice(0, 10).join(" ") + (n.length > 10 ? " …" : ""))' "$TMPD/merged-today.json")"

# ── ② 시험 하한·S6 기준선 계획 ───────────────────────────────────────────────────
if [ "$BUMP" = 1 ]; then
  echo "② 시험 하한 계획 (npm run count:bump -- --dry-run)"
  ( cd "$ROOT" && npm run count:bump -- --dry-run ) > "$TMPD/bump.log" 2>&1; BRC=$?
  grep -E '^\[[a-z0-9]+\] |^\(--dry-run' "$TMPD/bump.log" | grep -vE '^\[[a-z0-9]+\] (npm|node) ' | sed 's/^/  /'
  [ "$BRC" -ne 0 ] && echo "  (count:bump 종료 $BRC - 거부된 패키지가 있다. 위 줄을 본다)"
  # S6: 루트 시험이 초록(거부 줄 없음)일 때만. 기준선을 다시 만들어 diff 를 뜨고 원래 파일로 되돌린다.
  if [ -f "$ROOT/$S6_FILE" ] && ! grep -qE '^\[root\] .*거부' "$TMPD/bump.log" && grep -qE '^\[root\] ' "$TMPD/bump.log"; then
    S6_BACKUP="$TMPD/s6-baseline.backup"
    cp "$ROOT/$S6_FILE" "$S6_BACKUP"
    # count-bump.mjs 의 S6_UPDATE 와 같은 명령이다(바뀌면 거기와 같이 고친다).
    ( cd "$ROOT" && env -u NODE_TEST_CONTEXT S6_BASELINE_UPDATE=1 "$NODE" --test --test-name-pattern="S6 롤링" test/load-failure.test.mjs ) > "$TMPD/s6.log" 2>&1; SRC=$?
    if [ "$SRC" -eq 0 ]; then
      git -C "$ROOT" diff --no-index --no-color -U0 -- "$S6_BACKUP" "$ROOT/$S6_FILE" > "$TMPD/s6.diff" 2>/dev/null
      if [ -s "$TMPD/s6.diff" ]; then
        echo "  [s6] $S6_FILE: 갱신 예정 - diff(마지막 8줄):"
        grep -E '^[+-][^+-]' "$TMPD/s6.diff" | head -8 | cut -c1-120 | sed 's/^/    /'
      else
        echo "  [s6] $S6_FILE: 그대로"
      fi
    else
      echo "  [s6] 기준선 시험이 초록이 아니라 diff 를 뜨지 못했다(종료 $SRC)"
    fi
    restore_s6
  else
    echo "  [s6] 건너뜀(루트 시험이 초록이 아니거나 기준선 파일 없음)"
  fi
else
  echo "② 시험 하한 계획: --no-bump 로 건너뜀"
fi

# ── ③ 정리 후보 ──────────────────────────────────────────────────────────────────
ghj pr list -R "$REPO" --state merged --limit 300 --json number,headRefName,headRefOid > "$TMPD/merged-all.json"
GH_MERGED_OK=$GH_OK
"$NODE" -e '
const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const p of l) console.log(p.number + "\t" + p.headRefName + "\t" + p.headRefOid);
' "$TMPD/merged-all.json" > "$TMPD/merged.tsv"

COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
MAIN="$(cd "${COMMON%/.git}" 2>/dev/null && pwd -P)"
WT_PREFIX="$MAIN/.claude/worktrees/"
CANDS=(); CAND_BR=(); SKIPS=()
# porcelain 한 덩어리(빈 줄로 구분)씩 읽는다.
wt_path=""; wt_branch=""; wt_locked=0; wt_detached=0
consider() {
  [ -n "$wt_path" ] || return 0
  local p="$wt_path" br="${wt_branch#refs/heads/}" why
  case "$p/" in "$WT_PREFIX"*) ;; *) return 0 ;; esac            # .claude/worktrees 밖(기본 저장소 포함)은 보지도 않는다
  local name="${p#"$WT_PREFIX"}"
  if [ "$p" = "$ROOT" ]; then SKIPS+=("$name: 지금 이 워크트리"); return 0; fi
  if [ "$wt_detached" = 1 ] || [ -z "$wt_branch" ]; then SKIPS+=("$name: 분리된 HEAD(브랜치 없음)"); return 0; fi
  if [ "$wt_locked" = 1 ]; then SKIPS+=("$name [$br]: 잠김(실행 중일 수 있음)"); return 0; fi
  case "$br" in main|master) SKIPS+=("$name [$br]: 기본 브랜치"); return 0 ;; esac
  local tip pr
  tip="$(git -C "$ROOT" rev-parse "refs/heads/$br" 2>/dev/null)"
  pr="$(awk -F'\t' -v b="$br" '$2==b {print $1 "\t" $3}' "$TMPD/merged.tsv" | head -50)"
  if [ -z "$pr" ]; then SKIPS+=("$name [$br]: 병합된 PR 없음"); return 0; fi
  local num="" same=0
  while IFS=$'\t' read -r n oid; do [ "$oid" = "$tip" ] && { num="$n"; same=1; break; }; num="$n"; done <<< "$pr"
  if [ "$same" != 1 ]; then SKIPS+=("$name [$br]: PR #$num 병합됨, 하지만 로컬 끝이 PR head 와 다르다(병합 뒤 커밋?)"); return 0; fi
  if [ -n "$(git -C "$p" status --porcelain 2>/dev/null)" ]; then SKIPS+=("$name [$br]: PR #$num 병합됨, 미커밋 변경 있음"); return 0; fi
  CANDS+=("$p"); CAND_BR+=("$br"); echo "  후보 $name [$br] PR #$num" >> "$TMPD/cands.txt"
}
if [ "$GH_MERGED_OK" = 1 ] && [ -n "$MAIN" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "worktree "*) wt_path="${line#worktree }"; wt_branch=""; wt_locked=0; wt_detached=0 ;;
      "branch "*) wt_branch="${line#branch }" ;;
      detached) wt_detached=1 ;;
      "locked"*) wt_locked=1 ;;
      "") consider; wt_path="" ;;
    esac
  done < <(git -C "$ROOT" worktree list --porcelain; echo)
  echo "③ 정리 후보 ${#CANDS[@]}개 (병합된 PR 의 워크트리+브랜치, .claude/worktrees 아래만)"
  [ -f "$TMPD/cands.txt" ] && cat "$TMPD/cands.txt"
  for s in "${SKIPS[@]}"; do echo "  건너뜀 $s"; done
  if [ "$CLEAN" = 1 ]; then
    REMOVED=0
    for i in "${!CANDS[@]}"; do
      if git -C "$ROOT" worktree remove "${CANDS[$i]}" 2>"$TMPD/rm.err" && git -C "$ROOT" branch -D "${CAND_BR[$i]}" >/dev/null 2>"$TMPD/rm.err"; then
        echo "  지움 ${CANDS[$i]#"$WT_PREFIX"} [${CAND_BR[$i]}]"; REMOVED=$((REMOVED + 1))
      else
        echo "  지우지 못함 ${CANDS[$i]#"$WT_PREFIX"}: $(head -c 160 "$TMPD/rm.err")"
      fi
    done
    echo "  --clean: ${REMOVED}개 지움"
  elif [ "${#CANDS[@]}" -gt 0 ]; then
    echo "  (지우려면 --clean. 지금은 아무것도 지우지 않았다)"
  fi
else
  echo "③ 정리 후보: gh 호출이 실패해 만들지 못했다(--clean 도 아무것도 지우지 않았다)"
fi

# ── ④ 열린 PR ────────────────────────────────────────────────────────────────────
ghj pr list -R "$REPO" --state open --limit 50 --json number,title,statusCheckRollup > "$TMPD/open.json"
OPEN_N="$("$NODE" -e '
const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const FAIL = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
for (const p of l) {
  const c = p.statusCheckRollup ?? [];
  const st = (x) => x.conclusion || x.state || x.status || "";
  const fail = c.filter((x) => FAIL.has(st(x))).length;
  const ok = c.filter((x) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(st(x))).length;
  const wait = c.length - fail - ok;
  console.log("  #" + p.number + " " + p.title.slice(0, 60) + " - 검사 통과 " + ok + " · 실패 " + fail + " · 대기 " + wait);
}
console.error(l.length);
' "$TMPD/open.json" 2>"$TMPD/n2")"
N_OPEN="$(cat "$TMPD/n2")"
echo "④ 열린 PR ${N_OPEN:-0}건"
[ -n "$OPEN_N" ] && echo "$OPEN_N"

# ── ⑤ 요약 한 줄 ─────────────────────────────────────────────────────────────────
echo "⑤ 상태 요약 갱신 줄: $DAY 병합 ${N_TODAY:-0}건${NUMS:+ ($NUMS)} · 열린 PR ${N_OPEN:-0}건 · 정리 후보 ${#CANDS[@]}개"
exit $RC
