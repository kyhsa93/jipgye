// 금리 네 장 컨트롤의 모바일 순서(#541)와 첫 페인트 높이 예약(#542). 둘 다 CSS 만이다(인라인 JS +0 B).
//
// 높이·위치는 실제 Chrome 에서 잰다(PR 증빙: 1280·412·375·320 CLS 0, 첫 페인트 높이, 읽는 줄 위치). 여기서는 그 측정이 기대는 구조가
// 깨지지 않게 본다 - 값(금리·날짜)에 기대지 않는 구조 검사다(#8).
//  (1) 구운 .controls·.tabs 가 비어 있다. 예약 규칙은 :empty 라서 구운 쪽에 공백이라도 들어가면 예약이 첫 페인트에도 안 걸린다.
//  (2) 장마다 <meta name="rates-category"> 가 있고 스크립트의 initialCategory 가 같은 meta 를 읽는다(CSS 가 첫 탭을 고르는 근거).
//  (3) 스크립트는 .controls 를 innerHTML 로 채운다 - 채우는 순간 :empty 가 풀려 탭을 바꿔도 빈 자리가 안 남는다.
//  (4) 예약 규칙과 줄 수 경계(예금·적금 692/560/343, 대출 560), 모바일 order(읽는 줄 1, 검색 2)가 원문에 있다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SITE } from "./helpers/site-root.mjs";

const PAGES = [
  ["deposit-rates", "deposit"],
  ["saving-rates", "saving"],
  ["mortgage-rates", "mortgage"],
  ["rent-loan-rates", "rentLoan"],
];
const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("구운 .controls·.tabs 는 비어 있고 장마다 첫 탭 meta 가 있다 (#542 :empty 예약의 전제)", async () => {
  for (const [name, category] of PAGES) {
    const html = await readFile(`${SITE}/${name}.html`, "utf8");
    assert.match(html, /<div class="controls" id="controls"><\/div>/, `${name}: 구운 .controls 가 비어 있지 않다 - :empty 예약이 안 걸린다`);
    assert.match(html, /<div class="tabs" id="tabs" role="tablist"><\/div>/, `${name}: 구운 .tabs 가 비어 있지 않다 - :empty 예약이 안 걸린다`);
    assert.ok(html.includes(`<meta name="rates-category" content="${category}">`), `${name}: rates-category meta 가 ${category} 가 아니다`);
  }
});

test("스크립트는 meta 로 첫 탭을 고르고 .controls 를 innerHTML 로 채운다 (#542)", async () => {
  const tpl = await read("scripts/rates-template.html");
  assert.match(tpl, /querySelector\('meta\[name="rates-category"\]'\)/, "initialCategory 가 rates-category meta 를 읽지 않는다 - CSS 예약의 첫 탭 근거가 어긋난다");
  assert.equal([...tpl.matchAll(/controls\.innerHTML = `/g)].length, 2, "controls.innerHTML 채움이 둘(예금·적금, 대출)이 아니다 - 예약이 풀리는 경로를 다시 본다");
});

/** 같은 조건의 @media 블록이 여럿일 수 있다(560px 은 다섯 군데 넘게 있다). 모두 이어 붙여 돌려주고, 안에 든 블록 목록도 준다. */
function mediaBlocks(css, query) {
  const blocks = [];
  for (let from = css.indexOf(`@media (${query}) {`); from >= 0; from = css.indexOf(`@media (${query}) {`, from + 1)) {
    let depth = 0;
    for (let i = css.indexOf("{", from); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}" && --depth === 0) {
        blocks.push(css.slice(from, i + 1));
        break;
      }
    }
  }
  assert.ok(blocks.length > 0, `@media (${query}) 블록이 없다`);
  return blocks;
}
const mediaBody = (css, query) => mediaBlocks(css, query).join("\n");

test("컨트롤 높이 예약 규칙: 비어 있는 동안만, 줄 수는 폭 경계에서 바뀐다 (#542)", async () => {
  const css = await read("src/css/legacy.css");
  const AMOUNT = 'html:has(meta[name="rates-category"][content="deposit"], meta[name="rates-category"][content="saving"]) .controls:empty';
  const ANY = 'html:has(meta[name="rates-category"]) .controls:empty';

  assert.match(css, /html:has\(meta\[name="rates-category"\]\) \.tabs:empty \{\s*min-height: calc\(var\(--tap\) \+ 2px\);/, "상품군 탭 줄 예약이 없다");
  const base = css.slice(css.indexOf(`${ANY} {`));
  assert.match(base, /^[^}]*--ctl-rows: 1;[^}]*--ctl-extra: -10px;[^}]*min-height: calc\(var\(--ctl-rows\) \* \(var\(--tap\) \+ 10px\) \+ var\(--ctl-extra\)\);/, "기본(1줄, 대출) 예약 식이 바뀌었다");
  assert.ok(css.includes(`${AMOUNT} {\n  --ctl-extra: calc(var(--fs-sm) * 1.5);`), "금액 칸 장의 읽는 줄 높이(1.5em, .amount-read 의 min-height 와 같다)가 빠졌다");

  const rows = (block, selector) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{\\s*--ctl-rows: (\\d)`).exec(block)?.[1];
  assert.equal(rows(mediaBody(css, "max-width: 692px"), AMOUNT), "2", "예금·적금 692px 이하는 2줄이다");
  const b560 = mediaBody(css, "max-width: 560px");
  assert.equal(rows(b560, AMOUNT), "3", "예금·적금 560px 이하는 3줄이다");
  assert.equal(rows(b560, ANY), "2", "대출 560px 이하는 2줄이다");
  assert.equal(rows(mediaBody(css, "max-width: 343px"), AMOUNT), "4", "예금·적금 343px 이하는 4줄이다");

  // 읽는 줄의 min-height(1.5em)와 예약 식의 1.5 가 같은 값이어야 채운 높이와 예약이 맞는다.
  assert.match(css, /\.amount-read \{[^}]*min-height: 1\.5em;/, ".amount-read 의 min-height 가 1.5em 이 아니다 - 예약 식(--fs-sm * 1.5)과 어긋난다");
});

test("모바일(560px 이하)에서 읽는 줄은 금액 칸 바로 아래, 검색 칸은 맨 끝이다 (#541)", async () => {
  const css = await read("src/css/legacy.css");
  const b560 = mediaBody(css, "max-width: 560px");
  assert.match(b560, /\.controls input\[type="search"\] \{[^}]*flex-basis: 100%;[^}]*order: 2;/, "검색 칸이 자기 줄(100%)을 쓰고 order 2 로 맨 끝에 서야 한다");
  assert.match(b560, /\.controls \.amount-read \{\s*order: 1;/, "읽는 줄이 order 1 이 아니다 - 검색 칸이 금액 칸과 읽는 줄 사이에 낀다");
  // 데스크톱(561px 이상)은 order 를 건드리지 않는다: 560 블록 밖에 .amount-read·검색 칸의 order 가 없다.
  const outside = mediaBlocks(css, "max-width: 560px").reduce((rest, block) => rest.replace(block, ""), css);
  assert.doesNotMatch(outside, /\.amount-read \{[^}]*[\s;]order:/, "데스크톱 읽는 줄 배치가 바뀌면 안 된다");
  assert.doesNotMatch(outside, /\.controls input\[type="search"\] \{[^}]*[\s;]order:/, "데스크톱 검색 칸 배치가 바뀌면 안 된다");
});

test("추이 격자 빈 칸 높이는 카드 실측(144, 넉 열 163.5)이다 (#542)", async () => {
  const css = await read("src/css/legacy.css");
  assert.match(css, /#history-grid > \.placeholder,\s*\n\.history-reserve \{\s*min-height: 144px;/, "추이 빈 칸 기본 높이가 144px 이 아니다");
  assert.match(css, /@media \(min-width: 1044px\), \(min-width: 524px\) and \(max-width: 653px\) \{\s*#history-grid > \.placeholder,\s*\n\s*\.history-reserve \{\s*min-height: 163\.5px;/, "넉 열(1044px 이상) 추이 빈 칸 높이가 163.5px 이 아니다");
});
