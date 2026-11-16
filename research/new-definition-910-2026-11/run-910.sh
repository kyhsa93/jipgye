#!/bin/bash
# 실행: run-910.sh <worktree> <outdir>  — build-realestate(B1·B2·B5·rents) 뒤 measure-910(A1~A3·B6)
set -euo pipefail
WT=$(realpath "$1"); OUT=$2; HERE=$(dirname "$(realpath "$0")")
mkdir -p "$OUT/re" "$OUT/rents"
git -C "$WT" show cd20a99bc954797ae12bedeffa48252e8e505a22:docs/data/realestate.json > "$OUT/re/realestate.json"
git -C "$WT" show cd20a99bc954797ae12bedeffa48252e8e505a22:docs/data/realestate-history.json > "$OUT/re/realestate-history.json"
cd "$WT"
REALESTATE_NOW=2026-11-16T02:42:23Z REALESTATE_DATA_DIR="$OUT/re" DEAL_FILES_DIR="$OUT/rents" nice -n 19 node scripts/build-realestate.ts
nice -n 19 node "$HERE/measure-910.mjs" "$WT" "$OUT"
