#!/bin/sh
# 전체 실행: 시안을 다시 짓고(1층·2층), 재고(probe·대비·invariants·렌더 비교), 시트를 찍는다.
#   sh tools/run-all.sh            (base a b c 넷을 나란히 돌린다)
M="$(cd "$(dirname "$0")/.." && pwd)"; cd "$M"
set -e
# VARIANTS="c" SKIP_BASE=1 처럼 주면 그 시안만 다시 짓고 재고 찍는다(다른 시안의 산출물은 건드리지 않는다).
VARIANTS="${VARIANTS:-a b c}"
sh tools/build.sh $VARIANTS
node tools/build-layout.mjs $VARIANTS
mkdir -p measure logs sheets
set +e
REP="index.html,budget-7eok.html,rates.html"
shots() { # $1 변형 이름, $2 폴더
  v="$1"; d="$2"
  rm -rf "sheets/$v"; mkdir -p "sheets/$v"
  node tools/shots.mjs --dir "$d" --out "sheets/$v/sheet" --pages "$REP" --widths 375,1280 > "logs/shots-$v-sheet.log" 2>&1
  node tools/shots.mjs --dir "$d" --out "sheets/$v/low-sample" --pages price-outlook.html --modes auto-light,auto-dark --widths 375,1280 --probe .low-sample > "logs/shots-$v-low.log" 2>&1
  node tools/shots.mjs --dir "$d" --out "sheets/$v/en" --pages index.html --modes auto-light --widths 375,1280 --lang en > "logs/shots-$v-en.log" 2>&1
  node tools/shots.mjs --dir "$d" --out "sheets/$v/method" --pages method.html --modes auto-light --widths 375,1280 > "logs/shots-$v-method.log" 2>&1
  if [ -d "out/$v-layout/docs" ]; then
    node tools/shots.mjs --dir "out/$v-layout/docs" --out "sheets/$v/layout" --pages index.html --modes auto-light,auto-dark --widths 375,1280 > "logs/shots-$v-layout.log" 2>&1
  fi
}
measure() { # $1 변형
  v="$1"
  node tools/probe.mjs --dir "out/$v/docs" --out "measure/$v.json" --langs ko,en --widths 320,375,1280 --pages index.html,budget-7eok.html,rates.html,price-outlook.html,method.html > "logs/probe-$v.log" 2>&1
  node tools/probe.mjs --dir "out/$v-layout/docs" --out "measure/$v-layout.json" --langs ko,en --widths 320,375,1280 --pages index.html > "logs/probe-$v-layout.log" 2>&1
  node tools/contrast.mjs --dir "out/$v/docs" --out "measure/contrast-$v.json" > "logs/contrast-$v.log" 2>&1
  node tools/innertext.mjs --base base/docs --dir "out/$v/docs" --out "measure/innertext-$v.json" > "logs/innertext-$v.log" 2>&1
  node tools/innertext.mjs --base base/docs --dir "out/$v-layout/docs" --pages index.html --out "measure/innertext-$v-layout.json" > "logs/innertext-$v-layout.log" 2>&1
  node render-tools/bin/rendered.mjs base/docs "out/$v/docs" --widths 320,375,1280 --json "measure/rendered-$v.json" > "logs/rendered-$v.log" 2>&1
  ( cd tools-src/tools/golden && node bin/invariants.mjs "$M/base/docs" "$M/out/$v/docs" --json "$M/measure/invariants-$v.json" > "$M/logs/invariants-$v.log" 2>&1; echo "exit $?" >> "$M/logs/invariants-$v.log"
    node bin/invariants.mjs "$M/base/docs" "$M/out/$v-layout/docs" --json "$M/measure/invariants-$v-layout.json" --max-items 50 > "$M/logs/invariants-$v-layout.log" 2>&1; echo "exit $?" >> "$M/logs/invariants-$v-layout.log" )
}
[ -n "$SKIP_BASE" ] || ( node tools/probe.mjs --dir base/docs --out measure/base.json --langs ko,en --widths 320,375,1280 --pages index.html,budget-7eok.html,rates.html,price-outlook.html,method.html > logs/probe-base.log 2>&1
  node tools/contrast.mjs --dir base/docs --out measure/contrast-base.json > logs/contrast-base.log 2>&1
  shots base base/docs; echo ok > logs/done-base ) &
for v in $VARIANTS; do
  ( measure $v; shots $v "out/$v/docs"; echo ok > "logs/done-$v" ) &
done
wait
echo "끝 $(date +%H:%M:%S)"
