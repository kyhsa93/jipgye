#!/usr/bin/env bash
set -euo pipefail

message="${1:?커밋 메시지가 필요합니다}"
shift

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# 경로를 주면 그 경로만 커밋한다. 데일리 워크플로는 실거래 원본(raw)을 받자마자
# 따로 먼저 커밋한다 - 뒤의 단계가 실패해도 그날 받은 원본은 남게(#62).
if [ $# -gt 0 ]; then
  if [ -z "$(git status --porcelain -- "$@")" ]; then
    echo "변경사항 없음($*), 커밋 생략"
    exit 0
  fi
  for p in "$@"; do
    if [ -e "$p" ]; then
      git add "$p"
    fi
  done
else
  if [ -z "$(git status --porcelain -- docs raw)" ]; then
    echo "변경사항 없음, 커밋 생략"
    exit 0
  fi

  git add docs
  if [ -d raw ]; then
    git add raw
  fi
fi
git commit -m "$message"

branch="$(git rev-parse --abbrev-ref HEAD)"

for i in 1 2 3 4 5; do
  if git push; then
    exit 0
  fi

  echo "push 실패($i) - 원격 변경을 받아 다시 얹는다"
  git rebase --abort 2>/dev/null || true

  if ! git pull --rebase -X theirs origin "$branch"; then
    echo "rebase 충돌을 풀지 못했습니다. 되돌리고 다시 시도합니다"
    git rebase --abort 2>/dev/null || true
  fi

  sleep $((i * 5))
done

echo "push 재시도 모두 실패"
exit 1
