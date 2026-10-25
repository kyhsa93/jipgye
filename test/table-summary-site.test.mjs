import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";

/**
 * 틀에서 data-summary·data-caption-en 을 단 표(#707)가 나가는 사이트에서 실제로 요약·영어 caption 을 갖는다.
 *
 * 값은 읽은 장에서 센다(목록에 숫자를 박아 두면 장과 어긋난다). 데이터·날짜에 기대지 않는다(#8): 요약에 든 값이 같은 표의 칸에 있는지,
 * 영어 caption 에 한글이 없는지, 같은 문장이 두 표에 반복되지 않는지만 본다.
 */

const root = path.resolve(import.meta.dirname, "..");
const PAGES = ["record-high", "price-outlook", "floor-gap", "method", "index"];
const HANGUL = /[가-힣]/;
const TABLE = /<table(?=[\s>])([^>]*)>(<caption[^>]*>([\s\S]*?)<\/caption>)?([\s\S]*?)<\/table>/g;

const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/&minus;/g, "−").replace(/&amp;/g, "&");

async function tables() {
  const found = [];
  for (const page of PAGES) {
    const html = await readFile(path.join(root, SITE, `${page}.html`), "utf8");
    for (const m of html.matchAll(TABLE)) found.push({ page, attrs: m[1], caption: m[3] ?? "", body: strip(m[4]) });
  }
  return found;
}

test("data-summary 표는 caption 에 요약이 들어간다 (포함률 100%)", async () => {
  const targets = (await tables()).filter((t) => /data-summary=/.test(t.attrs));
  assert.deepEqual([...new Set(targets.map((t) => t.page))].sort(), ["floor-gap", "method", "price-outlook", "record-high"]);
  assert.ok(targets.length >= 5, `요약 표 ${targets.length}개`);
  for (const t of targets) {
    assert.match(t.caption, /가장 높은 행|highest row|서울 [+\-−]?\d|Seoul [+\-−]?\d/, `${t.page}: 요약이 caption 에 없다`);
  }
});

test("요약에 적힌 값은 모두 같은 표의 칸에 그대로 있다 (새로 셈한 값 0)", async () => {
  const targets = (await tables()).filter((t) => /data-summary=/.test(t.attrs));
  for (const t of targets) {
    const values = [...t.caption.matchAll(/\(([+\-−]?\d[\d,.]*%?p?)\)|(?:서울|Seoul) ([+\-−]?\d[\d,.]*%?p?)/g)].map((m) => m[1] ?? m[2]);
    assert.ok(values.length > 0, `${t.page}: 값이 없다`);
    for (const v of values) assert.ok(t.body.includes(v), `${t.page}: 요약의 ${v} 가 표 칸에 없다`);
  }
});

test("영어 caption(m-en 쪽, lang=en 표)에는 한글이 0자다", async () => {
  const all = await tables();
  const english = [];
  for (const t of all) {
    const en = /<span class="m-en">([\s\S]*?)<\/span>/.exec(t.caption)?.[1];
    if (en) english.push({ page: t.page, text: en });
    else if (/\slang="en"/.test(t.attrs)) english.push({ page: t.page, text: t.caption });
  }
  assert.ok(english.length >= 5, `영어 caption ${english.length}개`);
  for (const e of english) assert.doesNotMatch(e.text, HANGUL, `${e.page}: 영어 caption 에 한글`);
  // 두 벌로 구운 caption 은 m-ko 가 앞에 같이 있다.
  for (const t of all.filter((x) => /m-en/.test(x.caption))) assert.match(t.caption, /^<span class="m-ko">/, `${t.page}: m-ko 가 없다`);
});

test("같은 caption 문장이 두 표에 반복되지 않는다", async () => {
  const captions = (await tables()).map((t) => t.caption).filter(Boolean);
  assert.equal(new Set(captions).size, captions.length);
});
