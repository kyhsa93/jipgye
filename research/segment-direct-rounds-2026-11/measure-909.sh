#!/bin/bash
# #909 측정 실행: measure-909.sh <등록 sha> <B 데이터 커밋> <B 원본 커밋>   — 모두 40자. PREREG.md 「실행 순서」.
# 이 파일은 등록 sha 로 만든 측정 작업 트리(입력 A 용, 아래 WA) 안의 사본을 부른다. 확인이 하나라도 실패하면 측정을 부르지 않고 끝낸다.
# 종료: 1 멈춤(확인 실패) · 2 네트워크 호출 · 3 키 환경변수 · 4 등록 무효(cto 조건 11).
set -euo pipefail
[ $# -eq 3 ] || { echo "쓰는 법: measure-909.sh <등록 sha> <B 데이터 커밋> <B 원본 커밋>"; exit 1; }
REG=$1; BDATA=$2; BRAW=$3
ADATA=cd20a99bc954797ae12bedeffa48252e8e505a22   # 2026-11-16 Daily run 43793620193 데이터 커밋
ARAW=f692748e4c0434557f382470de883e3646234b39    # 같은 실행의 원본 커밋
SEEN=(8eb314f7fe112801bdc12b3b708558f94bf5ce17 cd20a99bc954797ae12bedeffa48252e8e505a22)  # 이미 본 커밋(신선도 대조)
D=research/segment-direct-rounds-2026-11
# cto 조건 11 무효 검사 목록.
LIST=(scripts/district-change.ts scripts/segment-change.ts scripts/direct-deals.ts scripts/build-direct-deals.ts
      scripts/build-cancellation.ts scripts/build-district-change.ts scripts/floor-gap.ts scripts/complex-price.ts
      scripts/cancel-by-price.ts scripts/realestate-raw.ts)
HERE=$(dirname "$(realpath "$0")")
WA=$(git -C "$HERE" rev-parse --show-toplevel)
MAIN=$(realpath "$(git -C "$WA" rev-parse --path-format=absolute --git-common-dir)/..")
WB=$(realpath -m "$MAIN/../jipgye.worktrees/909-B")
OUT=$HERE/out
G() { timeout -k 10 600 git "$@"; }
NODE() { env -i PATH="$PATH" HOME="$HOME" nice -n 19 node "$@"; }
stop() { echo "멈춤: $*"; exit 1; }

echo "#909 측정 · 등록 $REG · A 데이터 $ADATA · A 원본 $ARAW · B 데이터 $BDATA · B 원본 $BRAW"
echo "시각 $(date -u +%FT%TZ) · node $(node --version) · origin/main $(G -C "$WA" rev-parse origin/main)"
echo "디스크 오류 줄(hv_storvsc 0x28): $(dmesg 2>/dev/null | grep -c 'hv_storvsc.*0x28' || true)"
echo "부하: $(uptime)"
for s in "$REG" "$BDATA" "$BRAW"; do [[ $s =~ ^[0-9a-f]{40}$ ]] || stop "40자 sha 가 아니다: $s"; done

# ---- 등록·무효(cto 조건 11) ----
[ "$(G -C "$WA" rev-parse HEAD)" = "$REG" ] || stop "측정 작업 트리 $WA 의 HEAD 가 등록 sha 가 아니다"
G -C "$WA" merge-base --is-ancestor "$REG" origin/main || stop "등록 sha 가 origin/main 의 조상이 아니다(git fetch 먼저)"
if ! G -C "$WA" diff --quiet "$REG" origin/main -- "${LIST[@]}"; then
  echo "무효: 등록 sha 와 origin/main 사이에 무효 목록 파일이 바뀌었다 — 다시 등록한다"
  G -C "$WA" diff --stat "$REG" origin/main -- "${LIST[@]}"
  exit 4
fi
echo "무효 검사: git diff --quiet $REG origin/main -- <목록 ${#LIST[@]}개> 종료 0"

# ---- 입력 커밋 확인(S5) ----
for c in "$ARAW" "$ADATA" "$BRAW" "$BDATA"; do echo "  ${c:0:8} $(G -C "$WA" log -1 --format='%cI %s' "$c")"; done
G -C "$WA" merge-base --is-ancestor "$ARAW" "$ADATA" || stop "A 원본이 A 데이터의 조상이 아니다"
G -C "$WA" merge-base --is-ancestor "$BRAW" "$BDATA" || stop "B 원본이 B 데이터의 조상이 아니다"
G -C "$WA" merge-base --is-ancestor "$REG" "$BRAW" || stop "B 원본이 등록 sha 뒤가 아니다 — B 는 등록 뒤 첫 정기 Daily 다"
G -C "$WA" merge-base --is-ancestor "$BDATA" origin/main || stop "B 데이터 커밋이 origin/main 에 없다"
EARLIER=$(G -C "$WA" log --format='%H' --grep='데일리 데이터 갱신' "$REG..$BDATA^" | wc -l)
[ "$EARLIER" -eq 0 ] || stop "등록 sha 와 B 사이에 Daily 데이터 커밋이 ${EARLIER}개 더 있다 — B 가 등록 뒤 첫 Daily 가 아니다(PREREG 무효·멈춤 3)"
echo "B 는 등록 뒤 첫 Daily 데이터 커밋이다 (git log --grep='데일리 데이터 갱신' $REG..B^ 0개)"

# ---- 신선도(cto 조건 6, #900 PREREG 2절 형식) ----
echo "입력 신선도(git diff --name-only <이미 본 커밋> <입력 데이터 커밋> -- <폴더> | wc -l):"
for inp in "A $ADATA" "B $BDATA"; do
  set -- $inp
  for base in "${SEEN[@]}"; do
    line="  입력 $1 ${2:0:8} ← ${base:0:8}:"
    for p in raw/sale raw/first-seen/sale raw/recollect raw/rent; do line+=" ${p#raw/} $(G -C "$WA" diff --name-only "$base" "$2" -- "$p" | wc -l)"; done
    echo "$line"
  done
done
SALE=$(G -C "$WA" diff --name-only "$ARAW" "$BRAW" -- raw/sale | wc -l)
echo "git diff --stat $ARAW $BRAW -- raw/sale: ${SALE}파일"
SAMEPUB=$(NODE -e '
  const { execFileSync } = require("node:child_process");
  const show = (c, f) => { const p = JSON.parse(execFileSync("git", ["-C", process.argv[1], "show", `${c}:docs/data/${f}`], { maxBuffer: 1 << 28 })); p.updatedAt = null; return JSON.stringify(p); };
  const same = ["segment-change.json", "direct-deals.json"].every((f) => show(process.argv[2], f) === show(process.argv[3], f));
  console.log(same ? "같음" : "다름");' "$WA" "$ADATA" "$BDATA")
echo "A·B 공개 segment-change.json·direct-deals.json(updatedAt 뺌): $SAMEPUB"
if [ "$SALE" -eq 0 ] && [ "$SAMEPUB" = "같음" ]; then
  LABELS=(A); echo "판정 입력: A 하나 (B=A — raw/sale 0파일, S5)"
elif [ "$SALE" -eq 0 ]; then
  LABELS=(A B); echo "판정 입력: A·B (raw/sale 0파일이지만 공개 파일이 다르다 — PREREG S5 세부 2)"
else
  LABELS=(A B); echo "판정 입력: A·B (raw/sale ${SALE}파일 바뀜)"
fi

# ---- node_modules = lockfile (cto 조건 8) ----
if [ ! -e "$WA/node_modules" ]; then ln -s "$MAIN/node_modules" "$WA/node_modules"; fi
NMROOT=$(dirname "$(realpath "$WA/node_modules")")
( cd "$NMROOT" && npm ls --all >/dev/null 2>&1 ) || stop "npm ls --all 이 node_modules 실제 폴더 $NMROOT 에서 0 이 아니다"
cmp -s "$NMROOT/package-lock.json" "$WA/package-lock.json" || stop "$NMROOT/package-lock.json 과 측정 작업 트리의 package-lock.json 이 다르다"
echo "node_modules: 실제 폴더 $NMROOT 에서 npm ls --all 종료 0 · package-lock.json cmp 같음"

# ---- 입력마다 작업 트리 준비·재현·동등 검사(cto 조건 3·7) ----
rm -rf "$OUT"; mkdir -p "$OUT"
prepare() { # <작업 트리> <데이터 커밋>
  G -C "$1" restore --source="$2" --staged --worktree -- raw docs/data
  G -C "$1" diff --cached --quiet "$2" -- raw || stop "$1 의 raw 가 $2 와 다르다"
  G -C "$1" diff --cached --quiet "$2" -- docs/data || stop "$1 의 docs/data 가 $2 와 다르다"
  [ "$(G -C "$1" rev-parse HEAD)" = "$REG" ] || stop "$1 의 HEAD 가 등록 sha 가 아니다"
  G -C "$1" diff --quiet HEAD -- scripts "$D" || stop "$1 의 scripts 또는 $D 가 등록 sha 와 다르다"
  echo "작업 트리 $1: HEAD = 등록 sha · scripts·$D = 등록 sha · raw·docs/data = ${2:0:8} (git restore, no-overlay)"
}
prepare "$WA" "$ADATA"
NODE "$WA/$D/prep-909.mjs" "$OUT" A
NODE "$WA/$D/verify-909.mjs" "$OUT" A
if [ "${#LABELS[@]}" -eq 2 ]; then
  [ ! -e "$WB" ] || stop "$WB 가 이미 있다 — 지우고 다시 돈다"
  G -C "$MAIN" worktree add --detach "$WB" "$REG"
  ln -s "$NMROOT/node_modules" "$WB/node_modules"
  cmp -s "$NMROOT/package-lock.json" "$WB/package-lock.json" || stop "B 작업 트리 package-lock.json 이 다르다"
  prepare "$WB" "$BDATA"
  NODE "$WB/$D/prep-909.mjs" "$OUT" B
  NODE "$WB/$D/verify-909.mjs" "$OUT" B
fi
for f in "$OUT"/input-909-*.json; do echo "입력 sha256 $(sha256sum "$f" | cut -c1-64) $(basename "$f")"; done

# ---- 재추출: 입력마다 기준 1 + 후보 80 ----
for L in "${LABELS[@]}"; do
  echo "재추출 입력 $L 시작 $(date -u +%T)"
  xargs -P 2 -L 1 sh -c 'env -i PATH="$PATH" HOME="$HOME" nice -n 19 node "$0" "$1" "$2" "$3" "$4"' "$HERE/run-909.mjs" "$OUT" "$L" < "$HERE/jobs-909.txt" \
    || stop "재추출 입력 $L 실패"
  echo "재추출 입력 $L 끝 $(date -u +%T)"
done

# ---- 빌드 시간(S3): 위가 끝난 뒤 다른 계산 없이, 입력 A ----
echo "부하: $(uptime)"
NODE "$WA/$D/time-909.mjs" "$OUT" A 3

# ---- 지표·문턱·선택 ----
NODE "$WA/$D/analyze-909.mjs" "$OUT" "${LABELS[@]}"
