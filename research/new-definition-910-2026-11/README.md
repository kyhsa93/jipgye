# #910 계수 — 계약구분 미표기 줄을 「신규」에서 빼면 (2026-11-16)

- 기준 raw R0 = `f692748e4c0434557f382470de883e3646234b39`(2026-11-16 Daily 원본 커밋, raw/rent 트리 `85e27f6c`), 같은 실행 데이터 커밋 `cd20a99b`.
- 코드 = 계수 시점 main `b360dcfb`. 임시 워크트리에서 `git checkout f692748e -- raw`, `git checkout cd20a99b -- docs/data`.
- before = main 코드 그대로, after = `after.patch`(네 줄: A `newJeonse`, B `summarizeRent`, B5 `weeklyRows`, B6 `build-rent-preview`).
- 시각은 R0 Daily 의 산출 시각으로 고정: build-realestate `REALESTATE_NOW=2026-11-16T02:42:23Z`, complex-ratio·jeonse-risk 02:45:01.520Z, reco 02:45:08.412Z, rent-preview 02:45:08.203Z.

## 다시 세기

```
git worktree add --detach <wt> b360dcfb
git -C <wt> restore --source=f692748e4c0434557f382470de883e3646234b39 --staged --worktree -- raw
git -C <wt> diff --cached --quiet f692748e4c0434557f382470de883e3646234b39 -- raw   # 종료 0 = raw 가 R0 그대로
git -C <wt> restore --source=cd20a99bc954797ae12bedeffa48252e8e505a22 --staged --worktree -- docs/data
ln -s <repo>/node_modules <wt>/node_modules
node dist-910.mjs <wt>                 # contractType 값 분포(달별)
node arrival-910.mjs <wt>              # 도착 주별 미표기 비율
./run-910.sh <wt> out/before           # build-realestate(B1·B2·B5·rents) → measure-910(A1·A2·A3·B6)
git -C <wt> apply after.patch
./run-910.sh <wt> out/after
python3 -I compare-910.py . <wt>       # → compare-910.out
node cells-gone-910.mjs <wt> .         # A1 사라진 칸의 원인
```

before 산출물은 cd20a99b 의 공개 파일(realestate.json·realestate-trend.json·complex-ratio.json·jeonse-risk.json·rent-preview.json·reco 25개·rents 25개·history 마지막 레코드)과 updatedAt 을 빼고 모두 같았다.

## 구현 PR 위 재계수

- after 를 `after.patch` 대신 구현 가지의 scripts 로 다시 돌렸다(`git -C <wt> checkout <구현 커밋> -- scripts` 뒤 `./run-910.sh <wt> out/after`). `compare-910.out` 이 이 폴더의 것과 글자 그대로 같았다 — 함수 하나로 모은 구현(isNewContract)이 네 줄 패치와 같은 값을 낸다.
- 구현은 history 새 레코드에 `rentContract: "신규"` 를 붙인다. 위 재계수에서 `realestate-history.json` 의 지난 레코드 67개는 cd20a99b 공개 파일과 바이트 그대로였고 오늘(2026-11-16) 레코드만 달랐다.

## 커밋하지 않은 출력과 다시 만드는 명령

`out/{before,after}/re/`(다시 만든 realestate·history·trend 사본, 각 1.7MB)·`out/*/rents/`·`out/*/reco/`·`out/*/a3.json`(추천 25개 구 파일, 각 0.63MB)은 넣지 않았다. 위 「다시 세기」의 `./run-910.sh <wt> out/before`·`./run-910.sh <wt> out/after` 가 R0 위에서 같은 바이트로 다시 만든다.
