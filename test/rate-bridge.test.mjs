import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RATE_PAGES } from "../scripts/build-rate-pages.mjs";
import { RATE_BRIDGE, BUDGET_HREF, CONVERSION_HREF } from "../scripts/rate-bridge.mjs";

// #179: 금리 화면 다섯 장이 실거래(10억대)와 전월세전환율 화면으로 가는 길을 갖되,
// 다섯 장의 문구가 한 문장 틀에 숫자만 바꾼 것이 되지 않게 지킨다(애드센스 반려 사유).

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

// rates.html은 총괄(예금 탭을 먼저 그리지만 문단은 총괄 것)이다.
const PAGES = [{ category: "rates", file: "rates.html" }, ...RATE_PAGES.map(({ category, file }) => ({ category, file }))];

/** 문단 하나의 안쪽 HTML. 모양이 바뀌어 못 찾으면 시험이 깨지게 둔다. */
function bridgeInner(html, locale) {
  const id = locale === "en" ? "rates-bridge-en" : "rates-bridge";
  const m = new RegExp(`<p class="rates-bridge" id="${id}" data-lang="${locale}"[^>]*>(.*?)</p>`, "s").exec(html);
  assert.ok(m, `#${id} 문단을 찾지 못했다`);
  return m[1];
}

/**
 * 비교 전에 지우는 것: 링크(앵커 글자와 대상 파일명 포함) 전체, 남은 숫자.
 * 앵커를 남기면 다섯 장이 같은 점수를 받아 시험이 무의미해진다(growth 권고).
 */
export function stripped(inner) {
  return inner
    .replace(/<a\b[^>]*>.*?<\/a>/gs, " ")
    .replace(/budget-10eok|jeonse-vs-wolse/g, " ")
    .replace(/[0-9]+/g, " ");
}

export function sentences(text) {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** 겹침을 세는 단위 셋. 영어는 단어 8-gram, 한국어는 공백 뺀 글자 8-gram과 어절 4-gram. */
export function grams(text, kind) {
  const out = new Set();
  if (kind === "char8") {
    const chars = [...text.replace(/[\s.,?!;:()\[\]·'"“”]/g, "")];
    for (let i = 0; i + 8 <= chars.length; i++) out.add(chars.slice(i, i + 8).join(""));
  } else {
    const n = kind === "word8" ? 8 : 4;
    const words = text.toLowerCase().replace(/[.,?!;:()]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

export function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export const JACCARD_LIMIT = 0.2;

const bridges = async () => {
  const out = {};
  for (const { category, file } of PAGES) out[category] = await read(`docs/${file}`);
  return out;
};

test("금리 다섯 장 모두 한·영 문단에 예산대와 전월세전환율 링크가 있다", async () => {
  const pages = await bridges();
  for (const { category, file } of PAGES) {
    for (const locale of ["ko", "en"]) {
      const inner = bridgeInner(pages[category], locale);
      assert.ok(inner.includes(`<a href="${BUDGET_HREF}">`), `${file} ${locale}: budget-10eok 링크가 없다`);
      assert.ok(inner.includes(`<a href="${CONVERSION_HREF}">`), `${file} ${locale}: jeonse-vs-wolse 링크가 없다`);
    }
  }
});

test("링크 대상 두 화면이 실제로 있다", async () => {
  for (const href of [BUDGET_HREF, CONVERSION_HREF]) {
    await read(`docs/${href.replace("./", "")}`);
  }
});

test("영어 문단은 처음에 숨겨져 있고 한국어 문단은 보인다", async () => {
  const pages = await bridges();
  for (const { category, file } of PAGES) {
    assert.match(pages[category], /<p class="rates-bridge" id="rates-bridge" data-lang="ko">/, `${file} 한국어 문단`);
    assert.match(pages[category], /<p class="rates-bridge" id="rates-bridge-en" data-lang="en" hidden>/, `${file} 영어 문단`);
  }
});

test("굽힌 문단이 문구 원본(rate-bridge.mjs)과 같다 — 임의 수정 방지", async () => {
  const pages = await bridges();
  for (const { category, file } of PAGES) {
    for (const locale of ["ko", "en"]) {
      const text = RATE_BRIDGE[category][locale].replace(/\[\[[bc]\|([^\]]+)\]\]/g, "$1");
      const shown = bridgeInner(pages[category], locale).replace(/<[^>]+>/g, "");
      assert.equal(shown, text, `${file} ${locale} 문구가 원본과 다르다`);
    }
  }
});

test("숫자·링크 대상·앵커를 지운 뒤 다섯 장 사이 같은 문장이 없다", async () => {
  const pages = await bridges();
  for (const locale of ["ko", "en"]) {
    const seen = new Map();
    for (const { category } of PAGES) {
      for (const s of sentences(stripped(bridgeInner(pages[category], locale)))) {
        assert.ok(!seen.has(s) || seen.get(s) === category, `${locale}: ${seen.get(s)}와 ${category}에 같은 문장: ${s}`);
        seen.set(s, category);
      }
    }
  }
});

test(`쌍별 8-gram 겹침(Jaccard)이 ${JACCARD_LIMIT} 미만이다 — 공통 고정구를 지우지 않은 채로 잰다`, async () => {
  const pages = await bridges();
  const kinds = { ko: ["char8", "word4"], en: ["word8"] };
  for (const locale of ["ko", "en"]) {
    const text = {};
    for (const { category } of PAGES) text[category] = stripped(bridgeInner(pages[category], locale));
    // 공통 고정구('10억 원 예산 기준'/'at a KRW 1 billion budget')는 지우지 않고 잰다 — 지우고 재면 겹침이 낮게 나온다.
    assert.ok(text.mortgage.includes(locale === "ko" ? "억 원 예산 기준" : "KRW   billion budget"), "고정구가 지워졌다");
    for (const kind of kinds[locale]) {
      for (let i = 0; i < PAGES.length; i++) {
        for (let j = i + 1; j < PAGES.length; j++) {
          const a = PAGES[i].category;
          const b = PAGES[j].category;
          const score = jaccard(grams(text[a], kind), grams(text[b], kind));
          assert.ok(score < JACCARD_LIMIT, `${locale} ${kind} ${a}-${b} Jaccard ${score.toFixed(3)} >= ${JACCARD_LIMIT}`);
        }
      }
    }
  }
});

test("각 문단이 그 화면 고유 금리 용어를 쓴다", async () => {
  const pages = await bridges();
  const own = {
    rates: { ko: [/예금/, /주택담보대출/], en: [/deposits/, /home-purchase/] },
    mortgage: { ko: [/주택담보대출/], en: [/mortgage/i] },
    deposit: { ko: [/정기예금/], en: [/deposit rate/i] },
    saving: { ko: [/적금/], en: [/installment savings/i] },
    rentLoan: { ko: [/전세자금대출/], en: [/jeonse-loan/i] },
  };
  for (const { category, file } of PAGES) {
    for (const locale of ["ko", "en"]) {
      const text = bridgeInner(pages[category], locale).replace(/<[^>]+>/g, "");
      for (const re of own[category][locale]) assert.match(text, re, `${file} ${locale}: ${re} 용어가 없다`);
    }
  }
});

test("전망·추천·금리 수치 표현이 없다", async () => {
  const pages = await bridges();
  for (const { category, file } of PAGES) {
    const ko = bridgeInner(pages[category], "ko").replace(/<[^>]+>/g, "");
    assert.ok(!/\d+(\.\d+)?\s*%/.test(ko), `${file}: 퍼센트 수치가 들어 있다`);
    assert.ok(!/(오를|내릴|추천|유망)/.test(ko), `${file}: 전망·추천 표현`);
  }
});
