// method 「수집 상태」 줄(#657 V11)은 배포 빌드가 데이터에서 그린다 - 나가는 장(build/site)의 줄이 그 빌드의 데이터와 같은지 본다(오늘 날짜는 안 읽는다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sitePath } from "./helpers/site-root.mjs";
import { collectStatus } from "../scripts/check-data-progress.ts";

const root = path.resolve(import.meta.dirname, "..");
const json = (rel) => { try { return JSON.parse(readFileSync(path.join(root, rel), "utf8")); } catch { return null; } };

test("method.html 의 수집 상태 줄은 이 빌드의 market-history 에서 나온 두 언어 줄이다", () => {
  const html = readFileSync(sitePath("method.html"), "utf8");
  const want = collectStatus(json("docs/data/market-history.json"));
  const between = (name) => html.split(`<!--prerender:${name}-->`)[1]?.split(`<!--/prerender:${name}-->`)[0];
  assert.equal(between("collectKo"), want?.ko ?? "");
  assert.equal(between("collectEn"), want?.en ?? "");
  if (want) assert.match(want.ko, /마지막 수집 성공 \d{2}-\d{2} · \d{2}-\d{2} 이후 수집이 빠진 날 \d+일<\/p>$/);
  assert.doesNotMatch(html, /공시가격 수집 진척|official-price collection/, "공시가격 진척은 화면에 싣지 않는다(#667 cpo)");
});
