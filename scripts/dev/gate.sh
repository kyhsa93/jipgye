#!/bin/bash
# 한 줄 로컬 관문 (#601). CI 가 병합 뒤에야 잡던 것(렌더·시험 세 벌·훅 클래스 목록)을 PR 전에 한 번에 돌린다. 파일을 고치지 않는다.
#
# 쓰는 법: scripts/dev/gate.sh [--golden <이름>] [--root <저장소 루트>]
#   --golden <이름>  골든 `--render` 불변 비교(scripts/dev/golden-run.sh <이름>)를 맨 끝에 더 돌린다. 느려서 기본은 뺀다.
#   --root           점검할 저장소 루트(기본: 이 스크립트가 든 저장소). 시험이 쓴다.
# 환경: NODE24_BIN  Node 24 바이너리(타입 스트리핑이 켜진 것). 없으면 PATH 의 node.
#
# 단계(순서대로, 이 이름이 요약 줄 앞머리다):
#   doctor  scripts/dev/doctor.sh 가 있으면 먼저. 실패하면 환경이 깨진 것이라 나머지를 돌리지 않는다.
#   render  node scripts/render-pipeline.ts --out=build/site  (React 렌더. 폴백 없음 - 실패하거나 폴백 표시가 나오면 실패. 실패하면 build/site 를 읽는 test·site·health 는 건너뛴다)
#   tsc     tools/typescript: node_modules/.bin/tsc -p tsconfig.json  (CI test.yml 의 「tsc --noEmit」 스텝 `npx tsc -p tsconfig.json` 과 같은 명령 - npx 는 이 .bin/tsc 를 찾아 부를 뿐이다. 도구가 없으면 SKIP + doctor 안내, 있으면 반드시 돈다. render 와 무관해서 render 가 실패해도 돈다)
#   test    루트: node scripts/run-tests.mjs          (래칫 포함 - test/COUNT)
#   site    루트: node scripts/run-tests.mjs --site   (배포 게이트 부분집합 - test/COUNT-site)
#   health  tools/health: node ../../scripts/run-tests.mjs  (CI 에서는 비차단이지만 여기서는 결과를 그대로 알린다)
#   golden  tools/golden: node ../../scripts/run-tests.mjs  (고정 fixture 시험)
#   hooks   tools/golden: node bin/invariants.ts --hooks-check --repo ../..  (훅 클래스 목록 hook-classes.json 이 소스와 맞는지)
#   golden-run  --golden 을 줬을 때만: scripts/dev/golden-run.sh <이름>  (종료 0 이면 비교가 돈 것 - 하드 실패 id 는 그 출력 원문을 PR 에 붙인다)
#
# 출력(stdout): 요약 ≤10줄 - 단계마다 PASS/FAIL/SKIP 한 줄(시험 단계는 `tests N pass N`)과 마지막 결과 한 줄.
#   실패가 있으면 그 아래에 **첫 실패 단계의 마지막 20줄**과 전체 로그 위치를 붙인다. 단계별 전체 로그는 임시 폴더에 두고, 통과하면 지운다.
# 종료 코드: 0 전부 통과, 1 하나라도 실패, 2 사용법 오류.
# 쓰는 곳: 저장소 안에서는 build/(gitignore) 아래 렌더 출력과 시험이 늘 쓰던 임시 파일뿐이다. 소스·데이터·COUNT 는 건드리지 않는다.

GOLDEN=""; ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --golden) [ $# -ge 2 ] && [ -n "$2" ] || { echo "사용법: --golden 뒤에 이름이 필요하다" >&2; exit 2; }; GOLDEN="$2"; shift 2 ;;
    --root) [ $# -ge 2 ] || { echo "사용법: --root 뒤에 값이 필요하다" >&2; exit 2; }; ROOT="$2"; shift 2 ;;
    *) echo '사용법: scripts/dev/gate.sh [--golden <이름>] [--root <저장소 루트>]' >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$ROOT" ] || ROOT="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "gate 실패: 저장소 루트를 열 수 없다." >&2; exit 2; }
NODE="${NODE24_BIN:-node}"

LOG="$(mktemp -d "${TMPDIR:-/tmp}/jipgye-gate.XXXXXX")" || { echo "gate 실패: 임시 폴더를 만들 수 없다." >&2; exit 2; }
trap 'case "${KEEP:-0}" in 1) ;; *) rm -rf "$LOG" ;; esac' EXIT

NAMES=(); RES=(); DETAIL=(); FIRST_FAIL=""
note() { NAMES+=("$1"); RES+=("$2"); DETAIL+=("$3"); [ "$2" = FAIL ] && [ -z "$FIRST_FAIL" ] && FIRST_FAIL="$1"; return 0; }

# 시험 로그에서 `tests N pass N` 만 뽑는다(없으면 빈 문자열). run-tests 합계 줄은 `ℹ tests N`·`ℹ pass N` 모양이다.
counts() {
  local t p
  t="$(sed -n 's/^[^0-9a-zA-Z]*tests \([0-9][0-9]*\).*/\1/p' "$1" | tail -1)"
  p="$(sed -n 's/^[^0-9a-zA-Z]*pass \([0-9][0-9]*\).*/\1/p' "$1" | tail -1)"
  [ -n "$t" ] && echo "tests $t pass ${p:-?}"
}

# stage <이름> <실행 폴더(루트 기준)> <명령...>  - 로그는 $LOG/<이름>.log. 결과를 note 로 남긴다.
stage() {
  local name="$1" dir="$2"; shift 2
  local start=$SECONDS rc extra
  echo "gate: $name ..." >&2
  ( cd "$ROOT/$dir" && "$@" ) > "$LOG/$name.log" 2>&1; rc=$?
  extra="$(counts "$LOG/$name.log")"
  [ -n "$extra" ] && extra="$extra "
  if [ $rc -eq 0 ]; then note "$name" PASS "$extra($((SECONDS - start))s)"; else note "$name" FAIL "${extra}종료 $rc ($((SECONDS - start))s)"; fi
  return $rc
}
skip() { note "$1" SKIP "$2"; }

# ── doctor(있으면) ───────────────────────────────────────────────────────────────────
DOCTOR_OK=1
if [ -f "$ROOT/scripts/dev/doctor.sh" ]; then
  stage doctor . bash scripts/dev/doctor.sh --root "$ROOT" || DOCTOR_OK=0
else
  skip doctor "(doctor.sh 없음)"
fi

if [ "$DOCTOR_OK" = 0 ]; then
  for n in render tsc test site health golden hooks; do skip "$n" "(doctor 실패로 건너뜀)"; done
  [ -n "$GOLDEN" ] && skip golden-run "(doctor 실패로 건너뜀)"
else
  # ── render: 실패하거나 폴백 표시(fallback=true)가 나오면 실패 ───────────────────────
  RENDER_OK=1
  stage render . "$NODE" scripts/render-pipeline.ts --out=build/site || RENDER_OK=0
  if [ "$RENDER_OK" = 1 ] && grep -qE 'fallback=true|legacy 로 (폴백|다시)' "$LOG/render.log"; then
    RES[$((${#RES[@]} - 1))]=FAIL; DETAIL[$((${#DETAIL[@]} - 1))]="폴백 표시가 나왔다"; FIRST_FAIL="${FIRST_FAIL:-render}"; RENDER_OK=0
  fi

  # ── tsc: CI 와 같은 검사. 도구(tools/typescript/node_modules/.bin/tsc)가 없을 때만 SKIP - 있으면 건너뛰지 않는다 ─────────
  if [ -e "$ROOT/tools/typescript/node_modules/.bin/tsc" ]; then
    stage tsc tools/typescript "$NODE" node_modules/.bin/tsc -p tsconfig.json
  else
    skip tsc "(TypeScript 도구 없음 - scripts/dev/doctor.sh --link 로 tools/typescript/node_modules 를 잇는다)"
  fi

  if [ "$RENDER_OK" = 1 ]; then
    stage test . "$NODE" scripts/run-tests.mjs
    stage site . "$NODE" scripts/run-tests.mjs --site
    stage health tools/health "$NODE" ../../scripts/run-tests.mjs
  else
    for n in test site health; do skip "$n" "(render 실패로 건너뜀)"; done
  fi
  stage golden tools/golden "$NODE" ../../scripts/run-tests.mjs
  stage hooks tools/golden "$NODE" bin/invariants.ts --hooks-check --repo ../..

  if [ -n "$GOLDEN" ]; then
    if [ "$RENDER_OK" = 1 ]; then
      stage golden-run . bash scripts/dev/golden-run.sh "$GOLDEN"
      gl="$(grep -m1 '불변 비교' "$LOG/golden-run.log" 2>/dev/null | cut -c1-70)"
      [ -n "$gl" ] && DETAIL[$((${#DETAIL[@]} - 1))]="${DETAIL[$((${#DETAIL[@]} - 1))]} $gl"
    else
      skip golden-run "(render 실패로 건너뜀)"
    fi
  fi
fi

# ── 요약 ─────────────────────────────────────────────────────────────────────────────
FAILS=0
for i in "${!NAMES[@]}"; do
  printf '%-4s %-10s %s\n' "${RES[$i]}" "${NAMES[$i]}" "${DETAIL[$i]}"
  [ "${RES[$i]}" = FAIL ] && FAILS=$((FAILS + 1))
done
if [ "$FAILS" -gt 0 ]; then
  echo "gate 실패: ${FAILS}단계 (첫 실패: $FIRST_FAIL)"
  echo "--- $FIRST_FAIL 마지막 20줄 ---"
  tail -n 20 "$LOG/$FIRST_FAIL.log"
  KEEP=1; echo "--- 전체 로그: $LOG/$FIRST_FAIL.log (다른 단계 로그도 같은 폴더) ---"
  exit 1
fi
echo "gate 통과"
exit 0
