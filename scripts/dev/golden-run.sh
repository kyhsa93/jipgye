#!/bin/bash
# 골든 `--render` 불변 비교 실행기 (#548). 세션 스크래치패드의 golden-run.sh 를 저장소로 옮긴 것.
#
# 쓰는 법: scripts/dev/golden-run.sh [--pattern P1] [--refs "#410·#413"] [--worktree <저장소 루트>] <이름> [<판정댓글URL>]
#   엔지니어(URL 없음): 1차 실행만 한다. 하드 실패·S6 바이트 원문을 PR 본문에 그대로 붙인다. expect 파일은 쓰지 않는다(판정 뒤 메인 세션 몫).
#   메인 세션(URL 있음): 1차 결과로 expect 를 만들고(scripts/dev/golden-expect.mjs, 이유 문구는 .claude/patterns.md 의 --pattern 절) --expect 로 재검증한다.
#                        S6 예산(+400 B/장) 초과나 새 하드 실패 id 면 「전체 판정」을 찍고 멈춘다(종료 2).
# 환경:
#   NODE24_BIN        Node 24 바이너리 경로(타입 스트리핑이 켜진 것). 없으면 PATH 의 node 를 쓴다. 둘 다 "strip" 이 아니면 종료 1.
#   GOLDEN_OUT_DIR    결과 파일(gold-<이름>.json·.txt, expect-<이름>.json) 폴더. 기본 <os.tmpdir()>/jipgye-golden-out
#   GOLDEN_MIN_FREE_GB  디스크 문턱(기본 1)
# 끝나면 골든의 임시 사본 <os.tmpdir()>/jipgye-golden 을 지운다(디스크). os.tmpdir() 은 TMPDIR 를 따른다.

PATTERN=""; REFS=""; W=""; POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pattern) PATTERN="$2"; shift 2 ;;
    --refs) REFS="$2"; shift 2 ;;
    --worktree) W="$2"; shift 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
N="${POS[0]}"; URL="${POS[1]}"
if [ -z "$N" ] || [ "${#POS[@]}" -gt 2 ]; then
  echo '사용법: scripts/dev/golden-run.sh [--pattern P1] [--refs "#410·#413"] [--worktree <저장소 루트>] <이름> [<판정댓글URL>]' >&2; exit 2
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
cleanup() { rm -rf "$TMP/jipgye-golden"; }
trap cleanup EXIT

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
