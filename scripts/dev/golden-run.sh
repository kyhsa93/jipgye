#!/bin/bash
# 골든 `--render` 불변 비교 실행기 (#548). 세션 스크래치패드의 golden-run.sh 를 저장소로 옮긴 것.
#
# 쓰는 법: scripts/dev/golden-run.sh [--pattern P1] [--refs "#410·#413"] [--worktree <저장소 루트>] [--shared-cache] <이름> [<판정댓글URL>]
#   엔지니어(URL 없음): 1차 실행만 한다. 하드 실패·S6 바이트 원문을 PR 본문에 그대로 붙인다. expect 파일은 쓰지 않는다(판정 뒤 메인 세션 몫).
#   메인 세션(URL 있음): 1차 결과로 expect 를 만들고(scripts/dev/golden-expect.mjs, 이유 문구는 .claude/patterns.md 의 --pattern 절) --expect 로 재검증한다.
#                        S6 예산(+400 B/장) 초과나 새 하드 실패 id 면 「전체 판정」을 찍고 멈춘다(종료 2).
# 환경:
#   NODE24_BIN        Node 24 바이너리 경로(타입 스트리핑이 켜진 것). 없으면 PATH 의 node 를 쓴다. 둘 다 "strip" 이 아니면 종료 1.
#   GOLDEN_OUT_DIR    결과 파일(gold-<이름>.json·.txt, expect-<이름>.json) 폴더. 기본 <os.tmpdir()>/jipgye-golden-out
#   GOLDEN_MIN_FREE_GB  디스크 문턱(기본 1)
#   GOLDEN_CACHE_DIR  골든의 작업 폴더(snap-*·SHA 캐시). 주면 그대로 쓰고 끝나도 지우지 않는다(주인이 그 폴더다). 기본은 실행마다 새로 만든 전용 폴더.
#   GOLDEN_SHARED_CACHE=1  --shared-cache 와 같다. 아래 「기준 캐시」.
#   GOLDEN_SHARED_CACHE_DIR  공유 기준 캐시 위치. 기본 $JIPGYE_SHARED(없으면 ~/workspace/jipgye.worktrees/_shared)/golden-cache
# 작업 폴더(#605): 실행마다 <os.tmpdir()>/jipgye-golden-run-<머리 SHA 8자>-<pid>.XXXXXX 를 새로 만들고 끝나면(정상·오류·INT/TERM/HUP) 그 폴더만 지운다.
#   예전에는 모두가 <os.tmpdir()>/jipgye-golden 하나를 나눠 쓰고 끝날 때 통째로 지워서, 다른 에이전트의 실행이 도중에 폴더를 잃고 rc=2 로 죽었다.
#   죽은 실행이 남긴 jipgye-golden-run-* 는 24시간 뒤 다음 실행이 시작할 때 지운다. os.tmpdir() 은 TMPDIR 를 따른다.
# 기준 캐시(opt-in): --shared-cache 면 기준(base) 렌더의 출발점(git archive 사본)을 <공유>/sha-<기준 전체 SHA> 에 두고 SHA 가 같으면 다음 실행부터 다시 쓴다.
#   키는 전체 SHA 라 다른 SHA 의 캐시를 쓸 수 없다. 만드는 쪽은 임시 이름에 다 만들고 rename 으로 확정하므로 동시 실행에도 안전하다(먼저 확정한 쪽이 이긴다).
#   같은 폴더에 그 SHA 의 렌더 결과(docs/, render-<SHA>-<입력 지문>)도 둔다 — 같은 SHA·같은 BUILD_NOW·단계면 다음 실행은 기준 렌더를 건너뛴다(tools/golden/lib/render.ts).
#   후보(head) 의 --src 스냅숏은 전용 폴더에 둔다. 공유 캐시에는 SHA 로 고정된 커밋 사본·결과만 들어간다(개수 상한 GOLDEN_CACHE_MAX_SHA·GOLDEN_CACHE_MAX_RENDER 로 정리).

PATTERN=""; REFS=""; W=""; POS=(); SHARED_CACHE="${GOLDEN_SHARED_CACHE:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --shared-cache) SHARED_CACHE=1; shift ;;
    --pattern) PATTERN="$2"; shift 2 ;;
    --refs) REFS="$2"; shift 2 ;;
    --worktree) W="$2"; shift 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
N="${POS[0]}"; URL="${POS[1]}"
if [ -z "$N" ] || [ "${#POS[@]}" -gt 2 ]; then
  echo '사용법: scripts/dev/golden-run.sh [--pattern P1] [--refs "#410·#413"] [--worktree <저장소 루트>] [--shared-cache] <이름> [<판정댓글URL>]' >&2; exit 2
fi
if [ -n "$URL" ] && [ -z "$PATTERN" ]; then echo "골든 실패: 판정댓글URL 을 주면 --pattern 도 줘야 한다(이유 문구를 그 패턴 절에서 읽는다)." >&2; exit 2; fi

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$W" ] || W="$(cd "$HERE/../.." && pwd)"
NODE="${NODE24_BIN:-node}"
if [ "$("$NODE" -p 'process.features.typescript')" != "strip" ]; then
  echo "골든 실패[Node]: 타입 스트리핑이 켜진 Node 24 가 필요하다. NODE24_BIN 으로 Node 24 바이너리 경로를 주거나 PATH 앞에 둔다(찾은 것: $("$NODE" -v 2>&1))." >&2; exit 1
fi
TMP="$("$NODE" -p 'require("os").tmpdir()')"
OUT="${GOLDEN_OUT_DIR:-$TMP/jipgye-golden-out}"; mkdir -p "$OUT"

# 작업 폴더: 주어진 GOLDEN_CACHE_DIR 이 없으면 이 실행 전용으로 만든다. 24시간 넘은 옛 전용 폴더(죽은 실행의 것)는 먼저 치운다.
OWN_CACHE=0
if [ -z "$GOLDEN_CACHE_DIR" ]; then
  find "$TMP" -maxdepth 1 -type d -name 'jipgye-golden-run-*' -mmin +1440 -exec rm -rf {} + 2>/dev/null
  HEADSHA="$(git -C "$W" rev-parse --short=8 HEAD 2>/dev/null || echo nohead)"
  GOLDEN_CACHE_DIR="$(mktemp -d "$TMP/jipgye-golden-run-$HEADSHA-$$.XXXXXX")" || { echo "골든 실패: 작업 폴더를 만들 수 없다($TMP)." >&2; exit 1; }
  OWN_CACHE=1
fi
export GOLDEN_CACHE_DIR
if [ "$SHARED_CACHE" = 1 ]; then
  GOLDEN_SHA_CACHE_DIR="${GOLDEN_SHARED_CACHE_DIR:-${JIPGYE_SHARED:-$HOME/workspace/jipgye.worktrees/_shared}/golden-cache}"
  mkdir -p "$GOLDEN_SHA_CACHE_DIR" || { echo "골든 실패: 공유 캐시 폴더를 만들 수 없다($GOLDEN_SHA_CACHE_DIR)." >&2; exit 1; }
  export GOLDEN_SHA_CACHE_DIR
  BASE_FULL="$(git -C "$W" rev-parse "$(git -C "$W" merge-base origin/main HEAD 2>/dev/null)" 2>/dev/null)"
  if [ -n "$BASE_FULL" ] && [ -e "$GOLDEN_SHA_CACHE_DIR/sha-$BASE_FULL/.done" ]; then CACHE_NOTE="적중"; else CACHE_NOTE="없음(이번에 만든다)"; fi
  echo "골든 기준 캐시: sha-${BASE_FULL:-?} $CACHE_NOTE ($GOLDEN_SHA_CACHE_DIR)"
fi
cleanup() { [ "$OWN_CACHE" = 1 ] && rm -rf "$GOLDEN_CACHE_DIR"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

cd "$W/tools/golden" || exit 1
rm -f "$OUT/gold-$N.json"
GOLDEN_MIN_FREE_GB="${GOLDEN_MIN_FREE_GB:-1}" "$NODE" bin/invariants.ts --render --repo ../.. --json "$OUT/gold-$N.json" > "$OUT/gold-$N.txt" 2>&1; rc=$?
echo "골든 1차 rc=$rc (원문: $OUT/gold-$N.txt)"
COMPARED=1
if grep -qE '불변 비교' "$OUT/gold-$N.txt"; then
  grep -E '불변 비교' "$OUT/gold-$N.txt" | head -1
else
  COMPARED=0
  echo "(「불변 비교」 줄이 없다 — 비교 전에 멈춘 것이다. 출력 끝 5줄:)"
  tail -5 "$OUT/gold-$N.txt"
fi

if [ -n "$URL" ]; then
  EXPECT_ARGS=(--pattern "$PATTERN")
  [ -n "$REFS" ] && EXPECT_ARGS+=(--refs "$REFS")
  [ "$COMPARED" = 1 ] || { echo "골든 실패: 1차 비교가 돌지 못해 expect 를 만들지 않는다." >&2; exit 1; }
  "$NODE" "$HERE/golden-expect.mjs" "$OUT/gold-$N.json" "$URL" "$OUT/expect-$N.json" "${EXPECT_ARGS[@]}" || exit $?
  GOLDEN_MIN_FREE_GB="${GOLDEN_MIN_FREE_GB:-1}" "$NODE" bin/invariants.ts --render --repo ../.. --expect "$OUT/expect-$N.json" > "$OUT/gold-$N-b.txt" 2>&1; rc2=$?
  echo "골든 2차 rc=$rc2"
  grep -E '불변 비교|쓰이지|지운 항목' "$OUT/gold-$N-b.txt" | head -3
  exit $rc2
fi
# URL 없음: 하드 실패로 rc 1 인 것은 정상(예외 목록 전 상태)이다 - 비교가 아예 돌지 못한 것만 실패로 돌려준다.
[ "$COMPARED" = 1 ] || exit 1
exit 0
