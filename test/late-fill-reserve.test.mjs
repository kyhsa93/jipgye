import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "./helpers/site-root.mjs";

// 늦게 채워지는 글 네 자리의 줄 수 예약(#341; 다섯째였던 index #update-schedule 은 머리에서 바닥글로 옮겨 예약이 필요 없어졌다 - #398). 이 시험은 "예약이 서 있는가"를 본다. 예약이 정확한가(줄 수가 실제와 같은가)는
// 브라우저가 아는 일이라 여기서 못 본다 - 그건 PR 본문의 측정(375x812, 장당 3회, 네 폴더)이 한다. 줄 수는 글에 달려 있고
// 글은 날마다 바뀔 수 있어(#8) 줄 수를 시험에 못박으면 값에 기대는 시험이 된다. 그래서 줄 수는 "정수 lh"인지만 본다.
//
// 되풀이는 다섯 길로 들어온다.
//   1. 규칙이 사라진다(누가 CSS를 정리하다 지운다) → 같은 채움이 접힌 선 안으로 들어와 이동이 돌아온다.
//   2. 예약이 px 로 바뀐다 → 글자 크기·줄 간격이 바뀔 때 따라오지 않아 어긋난다(#336 이 베껴 적었다 7.5px 틀린 자리).
//   3. 미디어 쿼리가 풀리거나 밖으로 나간다 → 넓은 화면에서 예약이 남아 채워진 뒤에 줄어든다(예약이 새 이동을 만든다).
//   4. 예약이 집는 구획·형제가 사라진다 → 규칙이 아무것도 안 집는다(조용히 죽는다).
//   5. 예약이 고정 높이·overflow 로 바뀐다 → 본문 컨테이너에 그것을 두면 자동 광고가 깨진다(체인 규칙 3).
// 구운 HTML 쪽 전제(자리가 있는가)와 CSS 쪽(규칙이 있는가)을 같이 본다. 한쪽만 보면 다른 쪽이 어긋나도 통과한다.

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => readFile(path.join(root, p), "utf8");

// 예약 네 자리. selector 는 legacy.css 에 적힌 글자 그대로다.
const RESERVES = [
  { selector: "main:has(> #top-section) #lead-note", page: "floor-gap.html", maxWidth: 400 },
  { selector: "main:has(> #wolse-section) #lead-note", page: "renewal-vs-new.html", maxWidth: 400 },
  { selector: "main:has(> #month-section) #lead-note", page: "cancelled-deals.html", maxWidth: 400 },
  { selector: "#compare-result", page: "switch-house.html", maxWidth: 430 },
];

/** 짝이 맞는 `}` 의 자리. 주석 안의 중괄호는 미리 지운 글에서 센다. */
function closeOf(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  throw new Error("짝이 맞는 }를 찾지 못했다");
}

/** 최상위 `@media (max-width: Npx)` 블록과 그 안의 `선택자 { 선언 }` 규칙을 읽는다(min-width 가 섞인 조건은 건너뛴다). */
function maxWidthRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const re = /@media \(max-width: (\d+)px\) \{/g;
  for (let m; (m = re.exec(clean)); ) {
    const open = m.index + m[0].length - 1;
    const body = clean.slice(open + 1, closeOf(clean, open));
    for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ maxWidth: Number(m[1]), selector: r[1].trim().replace(/\s+/g, " "), decls: r[2].trim() });
    }
  }
  return out;
}

test("늦게 채워지는 글 네 자리의 예약이 좁은 폭에서 서 있다 (#341)", async () => {
  const css = await read("src/css/legacy.css");
  const rules = maxWidthRules(css);
  for (const { selector, maxWidth } of RESERVES) {
    const hit = rules.filter((r) => r.selector === selector);
    assert.equal(hit.length, 1, `src/css/legacy.css: "${selector}" 예약 규칙이 ${hit.length}개다 - 하나여야 한다. 사라지면 늦은 채움이 접힌 선 안으로 들어온다(#341)`);
    assert.equal(hit[0].maxWidth, maxWidth, `${selector}: 미디어 폭이 ${hit[0].maxWidth}px 다. 줄 수를 잰 폭(≤${maxWidth}px)보다 넓히면 넓은 화면에서 예약이 남는다`);
    const lines = /^min-height:\s*(\d+)lh;?$/.exec(hit[0].decls);
    assert.ok(lines && Number(lines[1]) >= 1, `${selector}: 예약은 "min-height: N lh" 하나여야 한다(지금 "${hit[0].decls}"). px 로 베끼면 글자 크기를 바꿀 때 따라오지 않는다`);
  }
  // 예약은 좁은 폭 미디어 쿼리 안에만 있다. 밖(전 폭)에 같은 선택자가 있으면 넓은 화면에서 남는다.
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const { selector } of RESERVES) {
    const head = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(outside, new RegExp(`(?:^|\\n)${head}\\s*\\{[^}]*min-height`), `${selector}: 미디어 쿼리 밖에 min-height 규칙이 있다 - 넓은 화면에서 예약이 남는다`);
  }
});

test("예약은 min-height 하나뿐이고 고정 높이·overflow·sticky 를 쓰지 않는다 (#341, 체인 규칙 3)", async () => {
  const css = await read("src/css/legacy.css");
  const rules = maxWidthRules(css);
  for (const { selector } of RESERVES) {
    const decls = rules.find((r) => r.selector === selector)?.decls;
    assert.ok(decls, `${selector}: 규칙이 없다`);
    // 선언이 정확히 min-height 하나 - 본문 컨테이너에 height·max-height·overflow·position 을 두면 자동 광고가 깨진다.
    assert.equal(decls.split(";").filter((d) => d.trim()).length, 1, `${selector}: 선언이 하나가 아니다(${decls})`);
    assert.doesNotMatch(decls, /(?:^|[;\s])(?:height|max-height|overflow|position)\s*:/, `${selector}: 고정 높이·overflow·position 을 쓴다`);
  }
});

test("예약이 집는 자리가 구운 장에 있다 (#341)", async () => {
  // 규칙이 아무것도 안 집으면 조용히 죽는다. 선택자가 가리키는 요소가 그 장에 그 모양으로 있는지 본다.
  const pages = Object.fromEntries(await Promise.all([...new Set(RESERVES.map((r) => r.page))].map(async (p) => [p, await read(`${SITE}/${p}`)])));

  // 같은 id(#lead-note)가 세 장에 있고 줄 수가 달라서 그 장에만 있는 구획으로 가른다. 구획은 main 의 직계 자식이어야 한다(`>`).
  // 구운 장은 main 의 자식을 두 칸 들여 쓴다(빌더가 만든 모양) - 들여쓰기가 바뀌면 이 시험이 알려 준다.
  for (const [page, section] of [["floor-gap.html", "top-section"], ["renewal-vs-new.html", "wolse-section"], ["cancelled-deals.html", "month-section"]]) {
    assert.match(pages[page], new RegExp(`\\n  <section id="${section}"`), `${SITE}/${page}: main 직계의 #${section} 이 없다 - 예약이 이 장을 못 가른다`);
    assert.match(pages[page], /<div class="content-notice" id="lead-note">/, `${SITE}/${page}: #lead-note 가 없다`);
    // 다른 두 장의 구획이 이 장에 섞여 들어오면 한 장에 예약이 둘 걸린다.
    for (const other of ["top-section", "wolse-section", "month-section"].filter((s) => s !== section)) {
      assert.ok(!pages[page].includes(`id="${other}"`), `${SITE}/${page}: #${other} 가 같이 있다 - #lead-note 예약이 두 줄 수로 겹친다`);
    }
  }

  assert.match(pages["switch-house.html"], /<p class="lead" id="compare-result">/, "docs/switch-house.html: #compare-result 가 없다");

  // index: #update-schedule 은 머리가 아니라 바닥글 첫 줄에 있다(#398). 머리에 있으면 채워지는 순간 아래가 통째로 밀려 예약이 필요했지만,
  // 바닥글은 접힌 선(812px) 밖이라 이동으로 안 잡힌다. 되돌아와 머리(.tagline 뒤)로 가면 예약 없이 채움 이동이 돌아온다.
  const index = await read(`${SITE}/index.html`);
  const header = /<header\b[\s\S]*?<\/header>/.exec(index)?.[0] ?? "";
  assert.ok(header && !header.includes('id="update-schedule"'), "docs/index.html: #update-schedule 이 머리에 있다 - 채움 이동을 막는 예약은 없다(#398)");
  // 머리를 가리키던 예약 규칙(`.tagline ~ .update-schedule`)은 아무것도 안 집는 죽은 규칙이다 - 남겨 두면 다음 사람이 머리로 되돌려도 예약이 살아 있는 줄 안다.
  assert.ok(!(await read("src/css/legacy.css")).includes(".tagline ~ .update-schedule"), "src/css/legacy.css: 죽은 예약 규칙 `.tagline ~ .update-schedule` 이 남아 있다(#398)");
  assert.ok(index.includes('<footer class="site-footer">\n    <div class="update-schedule tw:text-sm tw:mb-2" id="update-schedule"></div>'), "docs/index.html: #update-schedule 이 바닥글 첫 줄에 없다(#398)");
  // 다른 장의 .update-schedule(금리 네 장)은 .tagline 이 없어 이 예약이 안 걸려야 한다 - 걸리면 그 장의 한 줄 예약이 두 줄로 부푼다.
  for (const page of ["deposit-rates.html", "saving-rates.html", "mortgage-rates.html", "rent-loan-rates.html"]) {
    const html = await read(`${SITE}/${page}`);
    assert.ok(html.includes('id="update-schedule"') && !html.includes('class="tagline"'), `${SITE}/${page}: .tagline 이 생겼다 - index 의 2줄 예약이 이 장에도 걸린다`);
  }
});
