import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";

// 표의 머리글 방향(scope)·표 이름(caption), 차트 SVG의 접근 가능한 이름(#110).
// 외부 도구(axe-core 등) 없이 쓰는 이유: 새 devDependency는 승인 전이라, 검사 가능한 합격선만
// 정적 HTML과 빌더·브라우저 렌더 출력에서 직접 센다. 데이터 값에 따라 갈리는 검사는 넣지 않았다 -
// 있는지/없는지, 두 쪽이 같은지만 본다.

const docs = path.resolve(import.meta.dirname, "../docs");
const pages = async () =>
  Promise.all(
    (await readdir(docs))
      .filter((f) => f.endsWith(".html"))
      .sort()
      .map(async (f) => ({ file: f, html: await readFile(path.join(docs, f), "utf8") }))
  );

// <th> 여는 태그. `<thead>`는 걸리지 않게 뒤에 공백이나 `>`를 요구한다. 자바스크립트가 문자열로
// 만드는 표(`<th>${...}</th>`)도 소스에서 같이 잡힌다 - 화면에 그려질 때 scope가 없으면 같은 결함이다.
const TH = /<th(?=[\s>])[^>]*>/g;

test("모든 <th>가 열/행 방향(scope)을 가진다", async () => {
  const bad = [];
  let seen = 0;
  for (const { file, html } of await pages()) {
    for (const [tag] of html.matchAll(TH)) {
      seen += 1;
      if (!/\sscope="(col|row|colgroup|rowgroup)"/.test(tag)) bad.push(`${file} ${tag.slice(0, 60)}`);
    }
  }
  assert.ok(seen > 100, `<th>를 ${seen}개밖에 못 찾았다 - 검사가 헛돈다`);
  assert.equal(bad.length, 0, `scope 없는 <th> ${bad.length}개: ${bad.slice(0, 5).join(" | ")}`);
});

test("모든 <table>이 <caption>을 가진다", async () => {
  const bad = [];
  let tables = 0;
  for (const { file, html } of await pages()) {
    for (const m of html.matchAll(/<table(?=[\s>])[\s\S]*?<\/table>/g)) {
      tables += 1;
      if (!/<caption(?=[\s>])/.test(m[0])) bad.push(`${file}: ${m[0].slice(0, 70).replace(/\s+/g, " ")}`);
    }
  }
  assert.ok(tables >= 70, `<table>을 ${tables}개밖에 못 찾았다`);
  assert.equal(bad.length, 0, `caption 없는 표 ${bad.length}개: ${bad.slice(0, 4).join(" | ")}`);
});

test("caption은 장마다 다르고 숫자를 품는다 - 반복 문장으로 굳지 않는다", async () => {
  const seen = new Map();
  for (const { file, html } of await pages()) {
    // 스크립트 안의 것은 화면에서 채워지므로 이 검사는 마크업에 구워진 caption만 센다.
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const m of markup.matchAll(/<caption(?=[\s>])[^>]*>([\s\S]*?)<\/caption>/g)) {
      const text = m[1].replace(/<[^>]+>/g, "").trim();
      assert.match(text, /\d/, `${file} caption에 숫자가 없다: ${text}`);
      (seen.get(text) ?? seen.set(text, []).get(text)).push(file);
    }
  }
  assert.ok(seen.size >= 60, `caption이 ${seen.size}종뿐이다`);
  const repeated = [...seen].filter(([, files]) => files.length > 1);
  assert.deepEqual(repeated.map(([text, files]) => `${files.join(",")}: ${text}`), [], "같은 caption이 여러 장에 있다");
});

test("의미를 가진 차트 SVG(role=img)는 이름(aria-label)을 가진다", async () => {
  const bad = [];
  let charts = 0;
  for (const { file, html } of await pages()) {
    for (const [tag] of html.matchAll(/<svg(?=[\s>])[^>]*>/g)) {
      if (!/role="img"/.test(tag)) continue;
      charts += 1;
      if (!/aria-label="/.test(tag)) bad.push(`${file}: ${tag.slice(0, 80)}`);
    }
  }
  assert.ok(charts > 0, "role=img SVG를 못 찾았다");
  assert.deepEqual(bad, [], "이름 없는 차트 SVG");
});

test("실제로 그려진 차트의 aria-label이 그 계열의 숫자를 말한다", async () => {
  const weeks = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10"];
  const trend = {
    updatedAt: "2026-08-21T00:00:00.000Z",
    weeks,
    pendingWeeks: [],
    overall: Object.fromEntries(
      weeks.map((w, i) => [
        w,
        {
          sale: { avgPricePerPyeong10k: 4400 + i * 10, transactionCount: 300 + i },
          jeonse: { avgDepositPerPyeong10k: 3000 + i * 10, transactionCount: 400 + i },
          wolse: { avgDeposit10k: 22000 + i * 100, avgMonthlyRent10k: 126 - i * 6, transactionCount: 600 + i * 10 },
        },
      ])
    ),
    districts: {},
  };
  const realestate = { updatedAt: trend.updatedAt, period: "202608", overall: trend.overall[weeks[5]], districts: [] };
  const page = await loadRealestatePage({ realestate, trend, kind: "wolse" });

  const label = (html) => html.match(/<svg[^>]*role="img"[^>]*aria-label="([^"]*)"/)?.[1];
  const deposit = label(page.trendHtml());
  const volume = label(page.volumeHtml());
  assert.ok(deposit, "추이 그래프에 aria-label이 없다");
  assert.ok(volume, "거래량 그래프에 aria-label이 없다");
  // 몇 주인지, 처음·마지막 값, 오르내림의 끝이 들어 있어야 소리로도 추이를 알 수 있다.
  assert.match(deposit, /6주/);
  assert.match(deposit, /2억 2,000만원/);
  assert.match(deposit, /2억 2,500만원/);
  assert.match(volume, /600건/);
  assert.match(volume, /650건/);
  assert.notEqual(deposit, volume, "다른 계열인데 같은 이름이다");
});
