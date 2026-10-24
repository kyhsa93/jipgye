#!/usr/bin/env bash
set -euo pipefail

message="${1:?커밋 메시지가 필요합니다}"
shift

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# 경로를 주면 그 경로만 커밋한다. 데일리 워크플로는 실거래 원본(raw)을 받자마자
# 따로 먼저 커밋한다 - 뒤의 단계가 실패해도 그날 받은 원본은 남게(#62).
#
# 경로를 안 주면 데이터 경로 둘(docs/data·raw)만 커밋한다(#510, 구조 B-4). 예전에는 `git add docs` 였다 - 렌더가 docs/*.html 을 제자리에서 고쳐
# 그것까지 같이 커밋했다. 이제 main 은 생성 HTML 을 안 들고 있고(사이트는 deploy.yml 이 build/site 로 만든다), 수집 워크플로가 만지는 것은
# 데이터뿐이어야 한다: 기능 PR 과 같은 파일을 건드리는 데이터 커밋이 없어야 병합이 시계와 무관해진다. docs/ 의 손으로 고치는 틀·정적 자산은
# 수집이 만들지 않으니 이 목록에 없다 - 수집 job 안에서 그것이 바뀌었다면 버그이고, 커밋에 실리지 않고 버려진다.
DATA_PATHS=(docs/data raw)

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
  if [ -z "$(git status --porcelain -- "${DATA_PATHS[@]}")" ]; then
    echo "변경사항 없음, 커밋 생략"
    exit 0
  fi

  for p in "${DATA_PATHS[@]}"; do
    if [ -e "$p" ]; then
      git add "$p"
    fi
  done
fi
git commit -m "$message"

branch="$(git rev-parse --abbrev-ref HEAD)"

# 원격이 앞서 있으면(다른 run·수동 머지가 먼저 main에 푸시) 낡은 기준에서 만든 산출물을
# 최신 위에 얹지 않는다. 예전에는 `pull --rebase -X theirs`로 내 커밋이 충돌을 이겨
# 12개 산출물이 서로 어긋났다(#92, #94). 이제는
#  - 산출물(docs/data·raw, 경로 인자 없음): 원격의 새 커밋이 데이터 경로(docs/data·raw)를 바꿨으면 실패시킨다 - 내 산출물은 그 앞의 데이터에서 만든 것이라
#    얹으면 어긋난다. 다음 스케줄이 최신 main 위에서 다시 수집·생성한다. 새 커밋이 데이터 경로를 안 건드렸으면(기능 PR 병합: 코드·틀·시험·워크플로)
#    -X 없는 rebase 로 얹는다: 생성 HTML 이 main 에서 빠진 뒤(#510)로 기능 병합과 데이터 커밋은 파일이 겹치지 않으므로, 수집이 도는 10여 분 사이의
#    병합이 그날 수집분(뉴스·시장·금리 이력은 다시 받을 수 없다)을 버리게 하지 않는다. 충돌하면 raw 와 같이 중단하고 실패시킨다.
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
    base="$(git merge-base HEAD "origin/$branch")"
    if [ -n "$(git diff --name-only "$base" "origin/$branch" -- "${DATA_PATHS[@]}")" ]; then
      echo "push 거절: 원격이 앞서 있고 그 새 커밋이 데이터 경로(${DATA_PATHS[*]})를 바꿨다. 낡은 산출물로 덮어쓰지 않고 실패한다(다음 실행이 최신 위에서 다시 생성)" >&2
      exit 1
    fi
    echo "push 거절($i) - 원격이 앞서 있지만 그 새 커밋이 데이터 경로를 안 건드렸다. 충돌 없을 때만 얹는다"
  else
    echo "push 거절($i) - 원격이 앞서 있다. raw는 충돌 없을 때만 얹는다"
  fi
  if ! git rebase --autostash "origin/$branch"; then
    git rebase --abort 2>/dev/null || true
    echo "rebase 충돌: 원격 내용을 덮어쓰지 않고 실패한다" >&2
    exit 1
  fi
done

echo "push 재시도 모두 실패"
exit 1
