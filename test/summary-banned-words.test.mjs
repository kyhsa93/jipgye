// 요약 금지어 모듈(#945). 요약기는 금지어가 든 문장을 통째로 떼고(낱말을 지우거나 바꾸지 않는다), 뗄 것이 없으면 글을 바이트 그대로 둔다.
// 고정값은 2026-11-18 Summarize 커밋 ffbc5b03 의 docs/data/summary.json categories[key=rates] 원문이다(모델 qwen3:14b) - 배포 게이트를 막은 줄.
import test from "node:test";
import assert from "node:assert/strict";
import { BANNED_PATTERNS, bannedWordsIn, dropBannedSentences, dropSentences } from "../scripts/summary-banned-words.ts";

const RATES_1118_KO =
  "국고채 금리가 오늘 대체로 하락한 것으로 나타났다. 3년물 국고채 금리는 장중 연 3.722%를 기록했다. 이는 전일 대비 소폭 하락한 수준이다. 금리 변동은 시장 상황에 따라 실시간으로 움직이는 것으로 나타났다. 오늘 발표된 금리 수치는 향후 금융시장에 영향을 미칠 것으로 보인다.";
const RATES_1118_EN =
  "Today's government bond rates generally declined. The 3-year government bond rate reached 3.722% annually during the day. This is a slight decline compared to the previous day. Rate fluctuations were found to move in real-time according to market conditions. The interest rate figures announced today are expected to affect the financial market in the future.";

test("11-18 금리 줄: 넷째 문장만 빠지고 나머지 네 문장은 글자 그대로 남는다", () => {
  const { text, dropped } = dropBannedSentences(RATES_1118_KO);
  assert.deepEqual(dropped, ["금리 변동은 시장 상황에 따라 실시간으로 움직이는 것으로 나타났다."]);
  assert.equal(
    text,
    "국고채 금리가 오늘 대체로 하락한 것으로 나타났다. 3년물 국고채 금리는 장중 연 3.722%를 기록했다. 이는 전일 대비 소폭 하락한 수준이다. 오늘 발표된 금리 수치는 향후 금융시장에 영향을 미칠 것으로 보인다."
  );
});

test("금지어가 없는 문단은 바이트 그대로다 - 다시 이어 붙이지 않는다", () => {
  for (const clean of [
    "국토교통부는 14일 신규 공공택지 후보지를 발표했다.  이번 후보지에는 3만 가구가 들어선다.\n정부는 연내 추가 발표를 예고했다. ",
    "코스피가 하락했다. 이는 외국인 순매도 영향이다.",
    "Live music venues reopened. The index fell.", // 동사 live 는 금지어가 아니다
  ]) {
    const { text, dropped } = dropBannedSentences(clean);
    assert.equal(text, clean);
    assert.deepEqual(dropped, []);
  }
});

test("뗀 문장 바로 뒤 문장이 「이는/이러한/이에」로 시작하면 같이 뗀다(사슬로), 그 밖의 문장은 남는다", () => {
  const { text, dropped } = dropBannedSentences(
    "코스피가 하락했다. 시세는 실시간으로 바뀌었다. 이는 이례적이다. 이에 대한 해석은 갈린다. 외국인은 순매도했다. 이는 사흘째다."
  );
  assert.deepEqual(dropped, ["시세는 실시간으로 바뀌었다.", "이는 이례적이다.", "이에 대한 해석은 갈린다."]);
  assert.equal(text, "코스피가 하락했다. 외국인은 순매도했다. 이는 사흘째다.");
});

test("모든 문장에 금지어가 있으면 남는 글이 없다(null) - 요약기는 GENERATION_FAILED 길로 간다", () => {
  assert.deepEqual(dropBannedSentences("실시간 시세가 움직였다. 이는 이례적이다."), {
    text: null,
    dropped: ["실시간 시세가 움직였다.", "이는 이례적이다."],
  });
});

test("영어 금지어: real-time·real time·realtime(대소문자 무관)과 대문자 낱말 LIVE, 11-18 영어 줄도 걸린다", () => {
  assert.deepEqual(bannedWordsIn(RATES_1118_EN), ["real-time"]);
  for (const s of ["Real-time data.", "in real time.", "REALTIME feed.", "A LIVE badge."]) assert.ok(bannedWordsIn(s).length > 0, s);
  for (const s of ["They live here.", "Delivered on time.", "OLIVE oil.", "a LIVEly market"]) assert.deepEqual(bannedWordsIn(s), [], s);
  assert.deepEqual(BANNED_PATTERNS.map((p) => p.word), ["실시간", "real-time", "LIVE"]);
});

test("dropSentences 는 판정을 받는 일반 함수다 - 같은 문장 경계·「이는」 규칙, 해당 없으면 바이트 그대로", () => {
  const forecast = (s) => /것으로 보인다\.$/.test(s);
  assert.deepEqual(dropSentences(RATES_1118_KO, forecast).dropped, ["오늘 발표된 금리 수치는 향후 금융시장에 영향을 미칠 것으로 보인다."]);
  const clean = "코스피가 하락했다.  외국인은 순매도했다.";
  assert.equal(dropSentences(clean, forecast).text, clean);
});

// legal 조건(#945): 금지어 모듈은 요약 경로에만 쓴다 - 기사 제목(title·titleEn)을 다루는 수집·빌드 스크립트는 import 하지 않는다.
test("scripts/ 에서 금지어 모듈을 import 하는 것은 요약기 하나뿐이다", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.resolve(import.meta.dirname, "../scripts");
  const importers = [];
  for (const entry of await readdir(dir, { recursive: true })) {
    if (!/\.(?:ts|mjs|js|jsx)$/.test(entry)) continue;
    if (/summary-banned-words/.test(await readFile(path.join(dir, entry), "utf8")) && !entry.endsWith("summary-banned-words.ts")) importers.push(entry);
  }
  assert.deepEqual(importers, ["summarize-news.ts"]);
});
