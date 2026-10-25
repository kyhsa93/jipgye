#!/bin/bash
# 개발 환경 사전 점검 + 「워크트리 준비」 도우미 (#600). 엔지니어가 워크트리를 열자마자 가장 먼저 돌린다.
#
# 쓰는 법: scripts/dev/doctor.sh [--link] [--root <저장소 루트>] [--shared <공유 폴더>]
#   (없음)   점검만 한다. 실패마다 한 줄 이유를 stderr 에 찍고 종료 1, 모두 통과하면 ≤8줄을 찍고 종료 0.
#   --link   node_modules·tools/golden/node_modules 심볼릭 링크가 없거나(끊긴 링크 포함) 하나도 없으면 공유 폴더 것으로 만든다.
#            멱등이다 - 이미 있는 실제 폴더·살아 있는 링크는 건드리지 않는다. 저장소 루트 안의 그 두 경로 밖은 쓰지 않는다.
#   --root   점검할 저장소 루트(기본: 이 스크립트가 든 저장소). 시험이 쓴다.
#   --shared 공유 도구 폴더(기본: $JIPGYE_SHARED 또는 ~/workspace/jipgye.worktrees/_shared).
# 환경: NODE24_BIN  Node 24 바이너리 경로. 없으면 PATH 의 node, 그것도 아니면 <공유 폴더>/node24/bin/node 를 찾는다.
#
# 무엇을 보나: ① Node 의 process.features.typescript 가 "strip"(Node 24 타입 스트리핑) ② node_modules·tools/golden/node_modules 가 살아 있는 폴더
#   ③ 저장소 루트에서 react-dom 이 풀린다(없으면 렌더가 막힌다 - PR #585 로 조용한 legacy 폴백은 없고 종료 1) ④ tools/golden 에서 parse5 가 풀린다
#   ⑤ scripts/dev/golden-run.sh·golden-expect.mjs 가 있다.
# 이 도구는 설치하지 않는다(npm ci 도 머신 설정도 건드리지 않는다). 공유 폴더 만드는 법은 아래 「공유 폴더」 참고.
#
# 공유 폴더(한 번만 만든다, 사용자 폴더 안): <공유>/node_modules (루트 npm ci 결과), <공유>/tools/golden/node_modules (tools/golden npm ci 결과),
#   <공유>/node24/bin/node (타입 스트리핑이 켜진 Node 24 바이너리), <공유>/bin/npm (Node 24 로 Node 22 의 npm-cli.js 를 부르는 래퍼 - 고장 난 npm 우회).

LINK=0; ROOT=""; SHARED="${JIPGYE_SHARED:-$HOME/workspace/jipgye.worktrees/_shared}"
while [ $# -gt 0 ]; do
  case "$1" in
    --link) LINK=1; shift ;;
    --root) [ $# -ge 2 ] || { echo "사용법: --root 뒤에 값이 필요하다" >&2; exit 2; }; ROOT="$2"; shift 2 ;;
    --shared) [ $# -ge 2 ] || { echo "사용법: --shared 뒤에 값이 필요하다" >&2; exit 2; }; SHARED="$2"; shift 2 ;;
    *) echo '사용법: scripts/dev/doctor.sh [--link] [--root <저장소 루트>] [--shared <공유 폴더>]' >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$ROOT" ] || ROOT="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "doctor 실패[루트]: 저장소 루트를 열 수 없다." >&2; exit 1; }

FAILS=()
fail() { FAILS+=("$1"); }
LINKED=()

# --link: <루트>/<상대 경로> 가 살아 있는 폴더가 아니면 <공유>/<같은 상대 경로> 로 심볼릭 링크를 만든다.
# 실제 폴더나 파일이 이미 있으면 건드리지 않는다. 끊긴 링크만 지우고 다시 건다. 쓰는 곳은 항상 <루트>/<두 상대 경로 중 하나> 뿐이다.
link_one() {
  local rel="$1" dest="$ROOT/$1" src="$SHARED/$1"
  [ -d "$dest" ] && return 0
  if [ -e "$dest" ]; then return 0; fi                    # 폴더가 아닌 무언가가 있다 - 건드리지 않는다(아래 점검이 실패로 알린다)
  if [ ! -d "$src" ]; then return 0; fi                   # 공유 쪽이 없으면 만들 게 없다(아래 점검이 실패로 알린다)
  [ -L "$dest" ] && rm -f "$dest"                         # 끊긴 링크(저장소 안)만 지운다
  mkdir -p "$(dirname "$dest")" && ln -s "$src" "$dest" && LINKED+=("$rel")
}
if [ "$LINK" = 1 ]; then
  if [ ! -f "$ROOT/package.json" ] || ! grep -q '"name": "jipgye"' "$ROOT/package.json"; then
    echo "doctor 실패[루트]: $ROOT 는 jipgye 저장소 루트가 아니라서 --link 를 하지 않는다." >&2; exit 1
  fi
  link_one node_modules
  link_one tools/golden/node_modules
fi

# ① Node: NODE24_BIN → PATH 의 node → 공유 폴더의 node24. 처음으로 "strip" 인 것을 쓴다.
NODE=""; FOUND=""
for cand in "${NODE24_BIN:-}" "$(command -v node 2>/dev/null)" "$SHARED/node24/bin/node"; do
  [ -n "$cand" ] && [ -x "$cand" ] || continue
  feat="$("$cand" -p 'process.features.typescript' 2>/dev/null)"
  [ -n "$FOUND" ] || FOUND="$cand=${feat:-?}"
  if [ "$feat" = "strip" ]; then NODE="$cand"; break; fi
done
if [ -z "$NODE" ]; then
  fail "Node: process.features.typescript 가 strip 이 아니다(찾은 것: ${FOUND:-node 없음}) - NODE24_BIN 을 Node 24 바이너리로 주거나 PATH 앞에 둔다"
fi

# ② node_modules 두 곳: 살아 있는 폴더(심볼릭 링크면 가리키는 곳이 있어야 한다).
for rel in node_modules tools/golden/node_modules; do
  p="$ROOT/$rel"
  if [ -d "$p" ]; then :
  elif [ -L "$p" ]; then fail "$rel: 심볼릭 링크가 끊겼다($(readlink "$p")) - scripts/dev/doctor.sh --link"
  else fail "$rel: 없다 - scripts/dev/doctor.sh --link (공유 폴더: $SHARED)"
  fi
done

# ③④ react-dom(루트)·parse5(tools/golden) 가 그 폴더에서 풀린다. Node 가 없거나 폴더가 없으면 건너뛴다(①·②가 이미 실패).
resolves() { # <시작 폴더> <패키지>
  "$NODE" -e 'require("node:module").createRequire(process.argv[1] + "/x.js").resolve(process.argv[2])' "$1" "$2" >/dev/null 2>&1
}
if [ -n "$NODE" ]; then
  [ -d "$ROOT/node_modules" ] && ! resolves "$ROOT" react-dom/server && fail "react-dom: 저장소 루트에서 풀리지 않는다 - 렌더가 종료 1 로 멈춘다. node_modules 를 공유본으로 잇거나(--link) 루트에서 npm ci"
  [ -d "$ROOT/tools/golden/node_modules" ] && ! resolves "$ROOT/tools/golden" parse5 && fail "parse5: tools/golden 에서 풀리지 않는다 - 골든 도구가 못 돈다. tools/golden/node_modules 를 잇거나(--link) tools/golden 에서 npm ci"
fi

# ⑤ 골든 실행기·예외 도구
[ -f "$ROOT/scripts/dev/golden-run.sh" ] || fail "scripts/dev/golden-run.sh: 없다"
[ -f "$ROOT/scripts/dev/golden-run.sh" ] && [ ! -x "$ROOT/scripts/dev/golden-run.sh" ] && fail "scripts/dev/golden-run.sh: 실행 권한이 없다(chmod +x)"
[ -f "$ROOT/scripts/dev/golden-expect.mjs" ] || fail "scripts/dev/golden-expect.mjs: 없다"

if [ "${#FAILS[@]}" -gt 0 ]; then
  for f in "${FAILS[@]}"; do echo "doctor 실패: $f" >&2; done
  exit 1
fi

echo "doctor 통과: $ROOT"
echo "  node      $("$NODE" -v) (typescript=strip) $NODE"
echo "  루트      node_modules -> $(cd "$ROOT/node_modules" && pwd -P)"
echo "  골든      tools/golden/node_modules -> $(cd "$ROOT/tools/golden/node_modules" && pwd -P)"
echo "  react-dom $("$NODE" -p 'require(process.argv[1]+"/node_modules/react-dom/package.json").version' "$ROOT" 2>/dev/null) 풀림, parse5 풀림"
echo "  도구      golden-run.sh · golden-expect.mjs 있음"
[ "${#LINKED[@]}" -gt 0 ] && echo "  --link    새로 연결: ${LINKED[*]}"
exit 0
