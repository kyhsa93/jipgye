// 원본: test/district-change.test.mjs 의 "빌드된 갈아타기 자료에서 금액과 %가 25개 구 모두 맞는다"(#520 이전 판) 단언을 옮겼다(#524). 경로 접두(../ 한 단 -> 세 단)만 다르다.
// 옮긴 이유: 커밋된 docs/data/district-change.json 안 두 수(줄의 %와 84㎡ 환산 금액)의 관계라 데이터가 한쪽만 바뀐 모양(합성 교란: 모든 수 +1)에서 결과가 갈린다 -
// 루트 `npm test`에는 합성 거래로 같은 빌더(buildPayload)를 돌려 같은 단언을 하는 판이 남아 있고(코드 쪽 약속), 이 판은 오늘 커밋된 파일이 그 약속을 지키는지(데이터 쪽)를 비차단으로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

test("커밋된 갈아타기 자료(docs/data/district-change.json)에서 금액과 %가 25개 구 모두 맞는다", async () => {
  const d = JSON.parse(await readFile(path.join(root, "docs/data/district-change.json"), "utf8"));
  const rows = d.rows.filter((r) => r.change !== null && r.level84);
  assert.ok(rows.length >= 20, "값을 낸 구가 거의 없다 - 검사가 아무것도 안 본다");
  for (const r of rows) {
    const money = (r.level84.recent / r.level84.base - 1) * 100;
    assert.ok(Math.abs(money - r.change) < 0.15, `${r.name}: 줄은 ${r.change}%, 금액은 ${money.toFixed(2)}%`);
  }
});
