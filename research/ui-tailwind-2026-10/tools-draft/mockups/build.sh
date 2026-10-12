#!/bin/sh
# 시안 폴더를 만든다: 기준 docs 사본 + (style.css = 기준 style.css + common.css + <시안>.css). HTML·JS는 건드리지 않는다.
#   sh tools/build.sh a|b|c        → out/<시안>/docs (1층)
#   2층은 tools/build-layout.mjs 가 out/<시안>-layout/docs 를 만든다.
set -e
M="$(cd "$(dirname "$0")/.." && pwd)"
for v in "$@"; do
  rm -rf "$M/out/$v"
  mkdir -p "$M/out/$v"
  cp -Rc "$M/base/docs" "$M/out/$v/docs" 2>/dev/null || cp -R "$M/base/docs" "$M/out/$v/docs"
  cat "$M/base/docs/style.css" "$M/css/common.css" "$M/css/$v.css" > "$M/out/$v/docs/style.css"
  echo "$v: style.css $(wc -c < "$M/out/$v/docs/style.css" | tr -d ' ') 바이트 (기준 $(wc -c < "$M/base/docs/style.css" | tr -d ' '))"
done
