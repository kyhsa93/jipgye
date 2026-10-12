#!/bin/sh
# 반복용: 시안을 다시 짓고 재고(375·320·1280) 훑어볼 스크린샷을 스크래치에 찍는다. sh tools/try.sh <시안…>
M="$(cd "$(dirname "$0")/.." && pwd)"; S="$TRY_DIR"; cd "$M"
sh tools/build.sh "$@"
for v in "$@"; do
  ( node tools/probe.mjs --dir out/$v/docs --out measure/$v.json --widths ${WIDTHS:-320,375,1280} > "$S/$v.probe.log" 2>&1;
    node tools/shots.mjs --dir out/$v/docs --out "$S/$v" --pages ${PAGES:-index.html,budget-7eok.html,rates.html,price-outlook.html} --modes ${MODES:-auto-light} --widths ${SHOTW:-375,1280} > "$S/$v.shots.log" 2>&1; echo done > "$S/$v.done" ) &
done
wait
