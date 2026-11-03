#!/bin/bash
# 입력 커밋을 꺼내 m8_future.py·m8c_crossfit.py 를 다시 돌리고 커밋해 둔 출력과 비교한다. 외부 호출 0, 저장소에 쓰지 않는다.
# 재현: SNAP=<빈 디렉터리> bash research/future-value-test-2026-11/reproduce.sh
set -euo pipefail
: "${SNAP:?SNAP 에 빈 디렉터리를 지정}"
INPUT=cef5ab55435e9d3528d06100bf07387b3464c0a4
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SNAP
mkdir -p "$SNAP"
(cd "$here" && sha256sum -c <(head -1 PREREG.sha256))
git -C "$here/../.." archive "$INPUT" raw docs/data scripts | tar -x -C "$SNAP"
python3 -c 'import sys,numpy,pandas,scipy;print("python",sys.version.split()[0],"numpy",numpy.__version__,"pandas",pandas.__version__,"scipy",scipy.__version__)'
for name in m8_future m8c_crossfit; do
  python3 "$here/$name.py" > "$SNAP/$name.out"
  if diff -q "$here/$name.out" "$SNAP/$name.out"; then echo "$name: 커밋한 출력과 같다"; else echo "$name: 다르다 - diff $here/$name.out $SNAP/$name.out"; exit 1; fi
done
