#!/bin/bash
# #900 측정 실행: run-900.sh <측정 작업 트리> <outdir>   — PREREG.md 「실행 순서」 4단계. 작업 트리는 3단계까지 끝난 것(코드 05a4469e, raw·docs/data = cd20a99b).
# 확인이 하나라도 실패하면 측정 스크립트를 부르지 않고 종료 1. 키 환경변수는 env -i 로 비운다.
set -euo pipefail
WT=$(realpath "$1"); OUT=$(realpath -m "$2"); HERE=$(dirname "$(realpath "$0")")
CODE=05a4469e0f90e5021efee3b436521a7802b86f74
DATA=cd20a99bc954797ae12bedeffa48252e8e505a22
R0=f692748e4c0434557f382470de883e3646234b39
ROUND1=f3def1ee5a04531829057018b613323252a9e435
G() { git -C "$WT" "$@"; }

echo "측정 작업 트리 HEAD $(G rev-parse HEAD) · 코드 $CODE · 데이터 $DATA · R0 $R0"
[ "$(G rev-parse HEAD)" = "$CODE" ] || { echo "멈춤 1: 작업 트리 HEAD 가 $CODE 가 아니다"; exit 1; }
G diff --quiet "$CODE" -- scripts || { echo "멈춤 1: scripts 가 $CODE 와 다르다"; exit 1; }
G diff --cached --quiet "$DATA" -- raw || { echo "멈춤 2: raw 가 $DATA 와 다르다"; exit 1; }
G diff --cached --quiet "$DATA" -- docs/data || { echo "멈춤 2: docs/data 가 $DATA 와 다르다"; exit 1; }
[ -z "$(G diff --stat "$ROUND1" "$DATA" -- raw/recollect)" ] || { echo "멈춤 3: raw/recollect 가 #861 1회차($ROUND1)와 다르다"; exit 1; }
echo "확인: scripts = 코드 · raw·docs/data = 데이터 커밋 · raw/recollect = 1회차 (git diff --stat $ROUND1 $DATA -- raw/recollect 0줄)"

# 측정 전 입력 신선도(완료 조건 1, 기록 항목): 이미 본 커밋 → 입력 커밋, 빌더가 읽는 raw 하위 폴더별 바뀐 파일 수.
echo "입력 신선도(git diff --name-only <이미 본 커밋> $DATA -- <raw 폴더> | wc -l):"
for base in 8eb314f7fe112801bdc12b3b708558f94bf5ce17 "$ROUND1" "$R0"; do
  line="  ${base:0:8} →"
  for p in raw/sale raw/rent raw/recollect raw/ecos raw/indicators raw/first-seen; do
    line+=" ${p#raw/} $(G diff --name-only "$base" "$DATA" -- "$p" | wc -l)"
  done
  echo "$line"
done
echo "부하: $(uptime)"

cd "$HERE"
env -i PATH="$PATH" HOME="$HOME" nice -n 19 node "$HERE/ga-900.mjs" "$WT" "$OUT"
env -i PATH="$PATH" HOME="$HOME" nice -n 19 node "$HERE/na-900.mjs" "$WT" "$OUT"
