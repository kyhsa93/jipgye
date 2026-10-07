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

# 원격이 앞서 있으면(다른 run·수동 머지가 먼저 main에 푸시) 낡은 기준에서 만든 산출물을
# 최신 위에 얹지 않는다. 예전에는 `pull --rebase -X theirs`로 내 커밋이 충돌을 이겨
# 12개 산출물이 서로 어긋났다(#92, #94). 이제는
#  - 산출물(docs, 경로 인자 없음): 원격이 앞서 있으면 실패시킨다. 다음 스케줄이 최신
#    main 위에서 다시 수집·생성한다.
#  - 원본(raw, 경로 인자 있음): 재수집할 수 없는 입력이라(#62) 충돌 없이 얹히는 경우에만
#    -X 없는 rebase로 얹는다. 같은 파일을 건드려 충돌하면 중단하고 실패시킨다.
for i in 1 2 3 4 5; do
  if git push; then
    exit 0
  fi

  git fetch origin "$branch" || { sleep $((i * 5)); continue; }
  if git merge-base --is-ancestor "origin/$branch" HEAD; then
    # 원격이 앞서 있지 않다: 일시적 push 실패이므로 기다렸다 다시 시도한다.
    echo "push 실패($i) - 원격이 앞서 있지 않다, 재시도"
    sleep $((i * 5))
    continue
  fi

  if [ $# -eq 0 ]; then
    echo "push 거절: 원격이 앞서 있다. 낡은 산출물로 덮어쓰지 않고 실패한다(다음 실행이 최신 위에서 다시 생성)" >&2
    exit 1
  fi

  echo "push 거절($i) - 원격이 앞서 있다. raw는 충돌 없을 때만 얹는다"
  if ! git rebase --autostash "origin/$branch"; then
    git rebase --abort 2>/dev/null || true
    echo "rebase 충돌: 원격 내용을 덮어쓰지 않고 실패한다" >&2
    exit 1
  fi
done

echo "push 재시도 모두 실패"
exit 1
