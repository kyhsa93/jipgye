import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SITE, SITE_DIR } from "./helpers/site-root.mjs";
import { TAP_PAIRS, pairProblems, pageUses, readSitePages } from "./helpers/css-html-pairs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const css = () => readFile(path.join(root, "src/css/legacy.css"), "utf8");

// :root 바깥의 규칙만 훑는다. 축척 자체는 :root에 숫자로 적혀 있어야 하기 때문이다.
// 주석은 먼저 걷어낸다 - 안에 쉼표가 있으면 셀렉터 목록으로 딸려 들어온다.
function rules(text) {
  return [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, " "), body }))
    .filter((r) => !r.sel.startsWith(":root"));
}

const parts = (sel) => sel.split(",").map((s) => s.trim()).sort().join(", ");

test("글자 크기는 축척에서만 고른다", async () => {
  const strays = rules(await css())
    .map((r) => ({ sel: r.sel, size: r.body.match(/font-size:\s*([^;]+);/)?.[1]?.trim() }))
    // .method-body code처럼 둘러싼 글에 비례해야 하는 곳만 em으로 남긴다.
    .filter((r) => r.size && !r.size.startsWith("var(--fs-") && !r.size.endsWith("em"));

  // 축척을 안 쓰는 크기가 하나 생기면 다음 것이 그 옆에 붙는다. 스물두 단계는
  // 그렇게 늘어났고, 그때는 무엇이 무엇보다 커야 하는지 아무도 말할 수 없었다.
  assert.deepEqual(strays, [], `축척 밖 글자 크기: ${strays.map((s) => `${s.sel}(${s.size})`).join(", ")}`);
});

test("축척의 바닥이 한글이 읽히는 크기다", async () => {
  const scale = (await css()).match(/:root \{([\s\S]*?)\n\}/)[1];
  const sizes = [...scale.matchAll(/--fs-[a-z0-9]+:\s*([\d.]+)rem;/g)].map((m) => Number(m[1]));

  assert.ok(sizes.length >= 8, `축척 단계가 ${sizes.length}개뿐이다`);
  assert.ok(Math.min(...sizes) >= 0.78, `${Math.min(...sizes)}rem은 한글이 뭉갠다`);
});

test("입력칸은 iOS가 화면을 확대하지 않는 크기다", async () => {
  const text = await css();
  const field = Number(text.match(/--fs-field:\s*([\d.]+)rem;/)[1]);
  // 16px 미만이면 iOS Safari가 초점이 갈 때 화면을 당겨 버리고, 되돌려주지 않는다.
  assert.ok(field >= 1, `--fs-field가 ${field}rem이라 초점에서 화면이 확대된다`);

  const small = rules(text)
    .filter((r) => /\b(input|select|textarea)\b/.test(r.sel) && !/\[type="(checkbox|radio)"\]/.test(r.sel))
    .filter((r) => {
      const size = r.body.match(/font-size:\s*([^;]+);/)?.[1]?.trim();
      return size && size !== "var(--fs-field)";
    });

  assert.deepEqual(small.map((r) => r.sel), [], "입력칸이 --fs-field보다 작은 크기를 쓴다");
});

test("표와 카드의 숫자는 자릿수를 세로로 맞춘다", async () => {
  const text = await css();
  const fixed = new Set(
    rules(text)
      .filter((r) => r.body.includes("tabular-nums"))
      .flatMap((r) => r.sel.split(",").map((s) => s.trim()))
  );

  // 이 사이트는 5,211만원과 11,227만원을 위아래로 놓고 비교하는 것이 전부다.
  // 비례폭 숫자로 적으면 만 자리가 어긋나 눈이 열을 따라가지 못한다.
  for (const sel of [".data-table td", ".change", ".count", ".history-current", ".rate-table td"]) {
    assert.ok(fixed.has(sel), `${sel}에 고정폭 숫자가 없다`);
  }
});

test("숫자 열은 오른쪽, 이름 열은 왼쪽에 붙인다", async () => {
  const text = await css();
  const find = (want) => rules(text).find((r) => parts(r.sel) === parts(want));
  const cells = find(".data-table td, .data-table th");
  const first = find(".data-table th:first-child, .data-table td:first-child");
  assert.ok(cells && first, "표 정렬 규칙을 찾지 못했다");

  assert.match(cells.body, /text-align: right/, "숫자 열이 오른쪽에 붙지 않는다");
  assert.match(first.body, /text-align: left/, "지역·지표 이름까지 오른쪽으로 밀렸다");
});

test("누르는 것은 손가락이 닿는 크기다", async () => {
  const text = await css();
  const tap = Number(text.match(/--tap:\s*(\d+)px;/)[1]);
  // 알약 탭 30px, 아이콘 버튼 36px, 뉴스 칩 26px이었다. 셋 다 엄지 끝보다 작다.
  assert.ok(tap >= 44, `--tap이 ${tap}px다`);

  const uses = (sel) => {
    const rule = rules(text).find((r) => parts(r.sel) === parts(sel));
    assert.ok(rule, `${sel} 규칙이 없다`);
    assert.match(rule.body, /(min-height|height): var\(--tap\)/, `${sel}이 --tap을 안 쓴다`);
  };
  // 이 다섯은 구운 HTML 이 그 class 를 쓰는지까지 짝으로 본다(#317, 아래 시험). 목록은 TAP_PAIRS 한 곳이다.
  for (const [sel] of TAP_PAIRS) uses(sel);
  // 줄 단위 링크 목록도(#50) - 한 규칙에 묶여 있다.
  const lists = rules(text).find((r) => r.sel.includes(".district-links a") && r.sel.includes(".card-links a"));
  assert.ok(lists, "줄 단위 링크 목록 규칙이 없다");
  assert.match(lists.body, /min-height: var\(--tap\)/);
  for (const sel of [".section-links a", ".method-callout a"]) assert.ok(lists.sel.includes(sel), `${sel}이 빠졌다`);
  // 예산대 후보 카드의 단지 이름 링크(a.apt)는 flex 항목이라 inline 이 아니다 - 자기 상자가 --tap 이어야 한다(#459).
  uses(".budget-candidates .budget-deal > a.apt");
  const apt = rules(text).find((r) => parts(r.sel) === parts(".budget-candidates .budget-deal > a.apt"));
  assert.match(apt.body, /display: inline-flex/, "a.apt 가 inline-flex 가 아니다");
  assert.match(apt.body, /align-items: center/, "a.apt 글자가 위에 붙는다");
  // 체크박스는 input 자신의 상자가 폭 24 이상·높이 --tap 이다(#459 PR 2). 상자만 키우면 WebKit 이 표시를 16px 로 그려
  // zoom 1.5 로 24px 정사각을 맞춘다 - 폭 16 x 1.5 = 24, 높이 (--tap / 1.5) x 1.5 = --tap.
  const box = rules(text).find((r) => r.sel.includes('.search-field input[type="checkbox"]'));
  assert.ok(box, "체크박스 규칙이 없다");
  const zoom = Number(box.body.match(/zoom:\s*([\d.]+)/)?.[1]);
  assert.ok(zoom > 1, "체크박스 zoom 이 없다");
  assert.ok(Number(box.body.match(/(?<![-\w])width:\s*(\d+)px/)?.[1]) * zoom >= 24, "체크박스 상자 폭이 24px 미만이다");
  assert.match(box.body, new RegExp(`min-height: calc\\(var\\(--tap\\) / ${zoom}\\)`), "체크박스 높이가 --tap 이 아니다");
  const tableLink = rules(text).find((r) => parts(r.sel) === parts(".data-table td a"));
  assert.match(tableLink.body, /text-decoration-color: var\(--muted\)/, "표 안 링크 밑줄이 안 보인다");
  assert.doesNotMatch(tableLink.body, /var\(--border\)/, "밑줄이 1.29:1 테두리색이다");
});

test("--tap 을 주는 class 는 CSS 규칙과 구운 HTML 이 짝이다(#317)", async () => {
  const text = await css();
  const all = rules(text);
  const hasRule = (sel) => all.some((r) => parts(r.sel) === parts(sel));
  const pages = await readSitePages(SITE_DIR);
  assert.ok(Object.keys(pages).length > 0, `${SITE} 에 구운 장이 없다`);
  assert.deepEqual(pairProblems(hasRule, pages), []);
});

test("짝 검사가 선택자마다 두 방향과 장 수 하한에서 문다(#317 대조군)", () => {
  // 구운 HTML 을 흉내 낸 작은 사이트: 선택자마다 쓰는 장 수(uses)를 따로 정한다. 기본은 TAP_PAIRS 의 하한 그대로다.
  const markup = ([sel, , where]) => {
    const cls = sel.match(/^\.([\w-]+)/)[1];
    if (where === "script") return `<script>box.innerHTML = \`<button class="${cls}" type="button">x</button>\`;</script>`;
    return sel.includes(" ") ? `<nav class="${cls} tw:gap-2"><a href="/">x</a></nav>` : `<button class="${cls}" type="button">x</button>`;
  };
  const site = (uses = {}) =>
    Object.fromEntries(
      Array.from({ length: Math.max(...TAP_PAIRS.map(([, n]) => n)) }, (_, i) => [
        `p${i}.html`,
        `<body>${TAP_PAIRS.filter((pair) => i < (uses[pair[0]] ?? pair[1])).map(markup).join("")}</body>`,
      ]),
    );
  const everyRule = () => true;

  assert.deepEqual(pairProblems(everyRule, site()), [], "정상 사이트가 짝 검사에 걸린다");
  for (const [sel, floor] of TAP_PAIRS) {
    // HTML 쪽만 지웠다(CSS 규칙은 남았다): 그 선택자 하나만 실패.
    const htmlGone = pairProblems(everyRule, site({ [sel]: 0 }));
    assert.equal(htmlGone.length, 1, `${sel} HTML 삭제: ${htmlGone}`);
    assert.ok(htmlGone[0].startsWith(`${sel}: CSS 규칙은 있는데 구운 HTML 이 한 장도 안 쓴다`), htmlGone[0]);
    // CSS 쪽만 지웠다(HTML 은 그대로): 그 선택자 하나만 실패.
    const cssGone = pairProblems((s) => s !== sel, site());
    assert.equal(cssGone.length, 1, `${sel} CSS 삭제: ${cssGone}`);
    assert.ok(cssGone[0].startsWith(`${sel}: CSS 규칙이 없는데 구운 HTML ${floor}장이 쓴다`), cssGone[0]);
    // 하한보다 한 장 적다: 실패(하한 1 이면 한 장 적음이 곧 HTML 삭제라 위에서 본다).
    if (floor > 1) {
      const short = pairProblems(everyRule, site({ [sel]: floor - 1 }));
      assert.equal(short.length, 1, `${sel} 한 장 적음: ${short}`);
      assert.ok(short[0].startsWith(`${sel}: 구운 HTML ${floor - 1}장뿐이다(하한 ${floor})`), short[0]);
    }
  }
  // 태그 안 class 만 있고 안쪽 링크가 없으면 .page-nav a 는 쓰이지 않은 것이다. 마크업 선택자는 스크립트 안 문자열을 쓴 것으로 치지 않는다.
  assert.equal(pageUses('<nav class="page-nav"><span>x</span></nav>', ".page-nav a"), false);
  assert.equal(pageUses("<script>const s = '<button class=\"lang-toggle\">';</script>", ".lang-toggle"), false);
  assert.equal(pageUses('<button class="icon-toggle-x">x</button>', ".icon-toggle"), false, "class 이름 앞부분만 같다");
});

test("금리 4장의 누르는 것도 손가락이 닿는 크기다(#403)", async () => {
  const text = await css();
  const all = rules(text);
  // 상품군 탭(button.tab, 30px 였다)은 자기 규칙에서 높이 --tap.
  const tab = all.find((r) => parts(r.sel) === parts(".tab"));
  assert.match(tab.body, /min-height: var\(--tap\)/, ".tab 이 --tap 을 안 쓴다");
  // 상품군 링크 줄(nav.rate-links a, 19.5px 였다)은 줄 단위 링크 목록 규칙의 선택자에 들어 있고, 줄 간격은 0 이다(--tap 이 줄 사이를 벌린다).
  const lists = all.find((r) => r.sel.includes(".district-links a") && r.sel.includes(".card-links a"));
  assert.ok(lists.sel.split(",").map((x) => x.trim()).includes(".rate-links a"), ".rate-links a 가 줄 단위 링크 목록에 없다");
  assert.match(lists.body, /display: inline-flex/);
  assert.match(lists.body, /min-height: var\(--tap\)/);
  assert.match(all.find((r) => parts(r.sel) === parts(".rate-links")).body, /gap: 0 14px/, "링크 줄 간격이 --tap 위에 6px 를 또 더한다");
  // 자세히 단추(button.detail-toggle, 폭 22.5px 였다)는 자기 상자에 min-width 24 이상.
  const toggle = all.find((r) => parts(r.sel) === parts(".detail-toggle") && /min-width/.test(r.body));
  assert.ok(Number(toggle?.body.match(/min-width:\s*(\d+)px/)?.[1]) >= 24, ".detail-toggle min-width 가 24px 미만이거나 없다");
  // 체크박스는 #459 의 한 규칙(zoom 1.5)의 선택자 목록에 선택자만 더했다 - 선언을 복사한 둘째 zoom 규칙이 없어야 한다.
  const zooms = all.filter((r) => r.sel.includes('input[type="checkbox"]') && /zoom:/.test(r.body));
  assert.equal(zooms.length, 1, `체크박스 zoom 규칙이 ${zooms.length}개다`);
  assert.ok(zooms[0].sel.includes('.controls label > input[type="checkbox"]'), "금리 장 체크박스 선택자가 공유 규칙에 없다");
});

test("키보드로 훑을 때 지금 어디인지 보인다", async () => {
  const text = await css();
  const focus = rules(text).filter((r) => r.sel.includes(":focus-visible") && /outline:/.test(r.body));
  assert.ok(focus.length, "초점 테두리 규칙이 없다");

  const covered = new Set(focus.flatMap((r) => r.sel.split(",").map((x) => x.trim())));
  for (const sel of ["a:focus-visible", "button:focus-visible", "input:focus-visible", "select:focus-visible"]) {
    assert.ok(covered.has(sel), `${sel}에 초점 테두리가 없다`);
  }
});

test("스크린리더만 읽는 자리가 화면에서는 안 보인다", async () => {
  const rule = rules(await css()).find((r) => r.sel === ".sr-only");
  assert.ok(rule, ".sr-only가 없다");
  // display:none이면 스크린리더도 안 읽는다. 잘라내되 살려 둬야 한다.
  assert.ok(!/display:\s*none/.test(rule.body), ".sr-only를 display:none으로 감췄다");
  assert.match(rule.body, /clip-path|clip:/, ".sr-only가 화면에서 안 잘렸다");
});

test("걸러낸 결과를 소리로도 알린다", async () => {
  const { readFile } = await import("node:fs/promises");
  const has = async (file, id) => {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
    assert.match(tag, /role="status"/, `${SITE}/${file}의 #${id}가 알림 영역이 아니다`);
  };
  await has("index.html", "realestate-status");
  // 메인의 뉴스 건수 알림(#news-status)은 뉴스 칸과 함께 뉴스 화면으로 옮겼다(#575 PR2 - 뉴스 화면은 거르기가 없어 알릴 것이 없다).
  await has("deal-search.html", "search-status");
});

test("데스크톱에서 넓어지는 규칙이 있다", async () => {
  // 오래도록 미디어쿼리가 560·520·480 셋뿐이었다 - 전부 아래쪽이라, 넓은 화면에서는
  // 760px 칸 하나에 갇혀 1920px 모니터의 40%만 썼다.
  const text = await css();
  const up = [...text.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]));
  assert.ok(up.some((w) => w >= 1024), `위로 열리는 분기점이 없다(${up.join(", ")})`);

  const shell = /main \{[^}]*max-width: (\d+)px/.exec(text)?.[1];
  assert.equal(shell, "760", "기본 폭은 좁은 화면 것이라 그대로여야 한다");
  const wide = [...text.matchAll(/main \{\s*max-width: (\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...wide) >= 1100, `넓은 화면 폭이 ${Math.max(...wide)}px뿐이다`);
});

test("글은 껍데기를 따라 넓어지지 않는다", async () => {
  // 728px에서 이미 한 줄이 한글 46~54자다. 껍데기를 1280px로 늘리면서 문단까지
  // 같이 늘리면 여든 자가 되어 넓히기 전보다 나빠진다.
  const text = await css();
  const prose = /--prose:\s*([\d.]+)rem;/.exec(text)?.[1];
  assert.ok(prose, "산문 폭 토큰이 없다");
  assert.ok(Number(prose) <= 48, `${prose}rem은 한 줄이 너무 길다`);

  // 글이 실리는 블록은 그 토큰에 묶여 있어야 한다.
  const capped = rules(text)
    .filter((r) => r.body.includes("max-width: var(--prose)"))
    .flatMap((r) => r.sel.split(",").map((x) => x.trim()));
  for (const sel of [".lead", ".content-notice", ".district-summary", ".method-callout", "#summary-box"]) {
    assert.ok(capped.includes(sel), `${sel}이 산문 폭에 묶여 있지 않다`);
  }
});

// --- 액센트 -----------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;

function luminance(hex) {
  const [r, g, b] = HEX.exec(hex)[1].match(/../g).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// :root, 다크 미디어쿼리, data-theme 둘 - 네 갈래 모두에서 색이 맞아야 한다.
function palettes(text) {
  const blocks = [...text.matchAll(/(:root(?:\[data-theme="[a-z]+"\])?)\s*\{([^}]*)\}/g)];
  return blocks.map(([, sel, body]) => {
    const vars = Object.fromEntries(
      [...body.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]])
    );
    return { sel, vars };
  });
}

test("네 갈래 팔레트가 모두 액센트를 갖는다", async () => {
  const text = await css();
  const found = palettes(text).filter((p) => p.vars["--accent"]);
  // :root · @media dark의 :root · [data-theme="dark"] · [data-theme="light"]
  assert.equal(found.length, 4, `액센트를 정의한 팔레트가 ${found.length}개다`);
});

test("액센트 위의 글자가 읽힌다", async () => {
  for (const { sel, vars } of palettes(await css())) {
    if (!vars["--accent"]) continue;
    const onAccent = contrast(vars["--accent"], vars["--accent-on"]);
    assert.ok(onAccent >= 4.5, `${sel}: 채운 탭의 글자 대비가 ${onAccent.toFixed(1)}:1이다`);

    // 2층 현재 항목은 카드 위에 액센트 글씨로 앉는다.
    if (vars["--card"]) {
      const onCard = contrast(vars["--accent"], vars["--card"]);
      assert.ok(onCard >= 4.5, `${sel}: 카드 위 액센트 대비가 ${onCard.toFixed(1)}:1이다`);
    }
  }
});

test("네 갈래 모두 액센트의 옅은 판을 갖는다", async () => {
  // 질문 입구와 집계 기준 안내가 여기 앉는다. 한 갈래에 빠뜨리면 그 갈래에서만
  // 흰 바탕에 흰 글씨가 된다 - 시스템 다크(미디어쿼리)에서 실제로 그랬다.
  for (const { sel, vars } of palettes(await css())) {
    if (!vars["--accent"]) continue;
    assert.ok(vars["--accent-weak"], `${sel}: --accent-weak이 없다`);
    const onWeak = contrast(vars["--accent-weak"], vars["--fg"]);
    assert.ok(onWeak >= 4.5, `${sel}: 옅은 판 위의 글자 대비가 ${onWeak.toFixed(1)}:1이다`);
    const accentOnWeak = contrast(vars["--accent-weak"], vars["--accent"]);
    assert.ok(accentOnWeak >= 4.5, `${sel}: 옅은 판 위의 액센트 대비가 ${accentOnWeak.toFixed(1)}:1이다`);
  }
});

test("액센트를 데이터 안에는 쓰지 않는다", async () => {
  // 표 안의 파랑은 이미 '하락'이라는 뜻이다. 같은 자리에 다른 뜻의 파랑을
  // 놓으면 둘 다 못 읽는다. 액센트는 어디에 있고 무엇을 골랐는지만 말한다.
  const inData = rules(await css())
    .filter((r) => r.body.includes("var(--accent)"))
    .filter((r) => /\.(data-table|rate-table|change|count|price-strong|rate-strong|history-current)\b/.test(r.sel));

  assert.deepEqual(inData.map((r) => r.sel), [], "액센트가 데이터 안까지 들어왔다");
});

test("네 갈래 팔레트가 모두 오르내림 색을 갖는다", async () => {
  // 오래도록 :root 한 군데에만 있었다. 다크에서는 흰 바탕에서 고른 빨강·파랑이
  // 그대로 근검정 위에 놓였고, 아무도 그것을 재 보지 않았다.
  const found = palettes(await css()).filter((p) => p.vars["--up"] && p.vars["--down"]);
  assert.equal(found.length, 4, `오르내림 색을 정의한 팔레트가 ${found.length}개다`);
});

test("오르내림 색이 놓이는 자리마다 읽힌다", async () => {
  // "+18.4%"는 이 사이트에서 가장 자주 읽히는 숫자이면서 가장 작은 글씨(--fs-xs)다.
  // 표는 흰 바탕, 카드는 --card, 질문 입구와 안내는 --accent-weak 위에 앉는다.
  for (const { sel, vars } of palettes(await css())) {
    if (!vars["--up"]) continue;
    for (const ink of ["--up", "--down"]) {
      for (const paper of ["--bg", "--card", "--accent-weak"]) {
        if (!vars[paper]) continue;
        const ratio = contrast(vars[ink], vars[paper]);
        assert.ok(ratio >= 4.5, `${sel}: ${paper} 위의 ${ink} 대비가 ${ratio.toFixed(2)}:1이다`);
      }
    }
  }
});

test("단지 카드 표 머리글은 접혀 1280px 안에 든다 (#42)", async () => {
  const css = await (await import("node:fs/promises")).readFile(new URL("../src/css/legacy.css", import.meta.url), "utf8");
  const rule = css.match(/\.complex-card \.data-table th \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /word-break:\s*keep-all/, "한국어 낱말 중간에서 꺾인다");
});

test("h3도 축척 안이다 (#54)", async () => {
  const css = await (await import("node:fs/promises")).readFile(new URL("../src/css/legacy.css", import.meta.url), "utf8");
  assert.match(css, /\nmain h3 \{\s*font-size: var\(--fs-lg\);/);
});

// 공유 버튼은 어느 장이든 구운 HTML에 있다 (#54, #306). nav.js가 로드 뒤에 끼워 넣던 때는 머리의
// 버튼이 둘에서 셋으로 늘며 예순두 장이 0.001 밀렸다 - 그래서 nav.js는 더 만들지 않고(createElement가
// 없어야 한다) 동작만 건다. 구운 버튼이 빠진 장이 생기면 그 장에는 공유 버튼이 아예 없게 되므로 여기서 막는다.
test("머리 버튼은 어느 장이든 공유를 갖는다 - 구운 HTML에 들어 있다 (#54, #306)", async () => {
  const { readFile: rf, readdir } = await import("node:fs/promises");
  const nav = await rf(new URL("../docs/nav.js", import.meta.url), "utf8");
  assert.doesNotMatch(nav, /createElement\("button"\)|id = "share-button"/, "nav.js가 공유 버튼을 다시 만든다");
  assert.match(nav, /getAttribute\("data-share"\) === "page"\) return;/, "장이 직접 거는 다섯 장에 겹쳐 건다");
  const docs = pathToFileURL(`${SITE_DIR}/`); // 나가는 사이트 전체(#510)
  let seen = 0;
  let self = 0;
  for (const f of (await readdir(docs)).filter((x) => x.endsWith(".html"))) {
    const html = await rf(new URL(f, docs), "utf8");
    if (!html.includes('class="header-actions"')) continue;
    seen += 1;
    assert.ok(html.includes('id="share-button"'), `${f}: 구운 공유 버튼이 없다`);
    assert.ok(html.includes('src="./nav.js"'), `${f}: nav.js를 싣지 않는다`);
    // 표시(data-share="page")와 장 안의 핸들러는 짝이어야 한다. 표시만 있고 핸들러가 없으면 죽은 버튼이고,
    // 핸들러만 있고 표시가 없으면 nav.js가 겹쳐 걸어 한 번 눌러 두 번 공유된다. 둘 다 아니면 nav.js가 건다.
    const marked = html.includes('data-share="page"');
    const ownHandler = /getElementById\("share-button"\)[\s\S]{0,120}addEventListener|shareButton\s*=\s*document\.getElementById\("share-button"\)/.test(html);
    assert.equal(marked, ownHandler, marked ? `${f}: data-share="page"인데 장 안에 공유 핸들러가 없다 - 죽은 버튼` : `${f}: 장 안에 공유 핸들러가 있는데 data-share="page"가 없다 - nav.js가 겹쳐 건다`);
    if (marked) self += 1;
  }
  assert.ok(seen > 60, `머리를 가진 장을 ${seen}장밖에 못 찾았다 - 검사가 헛돈다`);
  assert.equal(self, 1, `장이 직접 거는 장이 ${self}장이다 - 첫 화면뿐이어야 한다(금리 네 장은 #577 B2 로 지웠다)`);
});

// 장이 자기 문구로 공유하는 다섯 장(첫 화면·금리 넷)은 data-share="page"로 표시하고, 그 표시가 있는
// 장에서는 nav.js가 손을 떼야 한다. 둘 다 걸면 한 번 눌러 두 번 공유된다.
test("data-share=\"page\"인 장에는 nav.js가 동작을 걸지 않는다 (#306)", async () => {
  const { readFile: rf, readdir } = await import("node:fs/promises");
  const vm = await import("node:vm");
  const nav = await rf(new URL("../docs/nav.js", import.meta.url), "utf8");
  const bind = (attrs) => {
    let bound = 0;
    const button = {
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute() {},
      querySelector: () => ({ textContent: "" }),
      addEventListener: () => (bound += 1),
    };
    vm.runInNewContext(nav, {
      document: {
        documentElement: { getAttribute: () => "ko", setAttribute() {} },
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: (id) => (id === "share-button" ? button : null),
      },
      window: { addEventListener() {} },
    });
    return bound;
  };
  assert.equal(bind({}), 1, "구운 버튼에 동작을 걸지 않는다");
  assert.equal(bind({ "data-share": "page" }), 0, "장이 직접 거는 버튼에 겹쳐 건다");
});

const docsPages = async () => {
  const { readFile: rf, readdir } = await import("node:fs/promises");
  const docs = pathToFileURL(`${SITE_DIR}/`); // 나가는 사이트 전체(#510)
  const files = (await readdir(docs)).filter((x) => x.endsWith(".html")).sort();
  return Promise.all(files.map(async (f) => [f, await rf(new URL(f, docs), "utf8")]));
};

// 구운 버튼 셋의 차례는 어느 장이든 공유 -> 테마 -> 언어다. nav.js가 끼워 넣던 자리(맨 앞)와 같다.
test("머리 버튼 셋의 차례가 장마다 같다 (#306)", async () => {
  const bad = [];
  let seen = 0;
  for (const [f, html] of await docsPages()) {
    const actions = /<div class="header-actions">([\s\S]*?)<\/div>/.exec(html)?.[1];
    if (!actions) continue;
    seen += 1;
    const order = [...actions.matchAll(/\bid="([a-z-]+)"/g)].map((m) => m[1]);
    if (order.join(",") !== "share-button,theme-toggle,lang-toggle") bad.push(`${f}: ${order.join(",")}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(seen > 60, `머리를 읽은 장이 ${seen}장뿐이다 - 검사가 헛돈다`);
});

// 공통 컴포넌트(#745 PR1). c-base.css는 색을 새로 정하지 않고 legacy.css의 네 갈래 변수만 가리킨다.
const cBase = () => readFile(path.join(root, "src/css/c-base.css"), "utf8");
// 컴포넌트 변수 → legacy 변수. 아래 대비 계산이 이 표로 c-* 변수를 푼다.
const C_ALIAS = { "--c-action": "--accent", "--c-action-on": "--accent-on" };

test("c-base.css: 색은 legacy 팔레트 변수로만, 글자 크기는 축척으로만 정한다", async () => {
  const text = (await cBase()).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual(text.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [], [], "c-base.css에 색 값이 직접 들어왔다 - 네 갈래 팔레트를 비켜 간다");
  const sizes = [...text.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length > 5);
  assert.deepEqual(sizes.filter((s) => !/^var\(--(fs-|c-fs-)/.test(s)), [], "축척 밖 글자 크기");
  const cfs = Object.fromEntries([...text.matchAll(/(--c-fs-[a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  for (const [k, v] of Object.entries(cfs)) assert.match(v, /^var\(--fs-[a-z0-9]+\)$/, `${k}가 --fs-* 축척을 가리키지 않는다`);
});

test("c-base.css: 글자/바탕 짝이 네 갈래 모두에서 4.5:1 이상이다", async () => {
  const text = (await cBase()).replace(/\/\*[\s\S]*?\*\//g, "");
  const v = (s) => { const n = /^var\((--[a-z-]+)\)$/.exec(s?.trim() ?? "")?.[1]; return n ? (C_ALIAS[n] ?? n) : null; };
  const pairs = [];
  for (const { sel, body } of rules(text)) {
    const fg = body.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1];
    const bg = body.match(/background(?:-color)?:\s*([^;]+)/)?.[1];
    if (fg && bg && v(fg) && v(bg)) pairs.push({ sel, fg: v(fg), bg: v(bg) });
  }
  assert.ok(pairs.length >= 8, `짝을 ${pairs.length}개밖에 못 읽었다`);
  // 상속 짝(#746 후속, #745 PR3): 한 규칙에 color·background 가 함께 없어 위 읽기로는 안 잡히는 짝.
  // 필터 칩은 .c-chip 묶음의 color(--fg)를 받고 바탕만 --accent-weak 로 바꾼다. 상태 상자 본문(--muted)은 .c-state 바탕(--card, 오류는 --bg) 위에 앉는다.
  const ruleOf = (sel) => rules(text).filter((r) => r.sel.split(",").map((x) => x.trim()).includes(sel)).map((r) => r.body).join(";");
  assert.match(ruleOf(".c-filter-chip"), /background: var\(--accent-weak\)/, "필터 칩 바탕이 바뀌었다 - 상속 짝을 고친다");
  assert.match(ruleOf(".c-state__body"), /color: var\(--muted\)/, "상태 본문 글자색이 바뀌었다 - 상속 짝을 고친다");
  pairs.push(
    { sel: ".c-filter-chip(상속)", fg: "--fg", bg: "--accent-weak" },
    { sel: ".c-filter-chip__x(상속)", fg: "--fg", bg: "--accent-weak" },
    { sel: ".c-state > .c-state__body(상속)", fg: "--muted", bg: "--card" },
    { sel: ".c-state--error > .c-state__body(상속)", fg: "--muted", bg: "--bg" },
  );
  const legacy = palettes(await css()).filter((p) => p.vars["--accent"]);
  assert.equal(legacy.length, 4);
  for (const { sel, vars } of legacy) for (const p of pairs) {
    const ratio = contrast(vars[p.fg], vars[p.bg]);
    assert.ok(ratio >= 4.5, `${sel} / ${p.sel}: ${p.fg} on ${p.bg} = ${ratio.toFixed(2)}:1`);
  }
});

test("c-base.css: 누르는 컴포넌트는 44px(--tap) 이상이고 초점 표시를 갖는다", async () => {
  const text = await cBase();
  const all = rules(text.replace(/\/\*[\s\S]*?\*\//g, ""));
  const tapped = (cls) => all.some((r) => r.sel.split(",").map((s) => s.trim()).includes(cls) && /min-height:\s*var\(--tap\)/.test(r.body));
  const focus = all.find((r) => r.sel.includes(":focus-visible"));
  assert.ok(focus && /outline:\s*2px solid var\(--focus\)/.test(focus.body), "c-* 초점 규칙이 없다");
  for (const cls of [".c-btn", ".c-input", ".c-select", ".c-chip", ".c-filter-chip", ".c-filter-chip__x", ".c-fold > summary"]) {
    assert.ok(tapped(cls), `${cls}: min-height: var(--tap)이 없다`);
  }
  for (const cls of [".c-btn", ".c-input", ".c-select", ".c-chip", ".c-filter-chip__x", ".c-fold > summary"]) {
    assert.ok(focus.sel.split(",").map((s) => s.trim()).includes(`${cls}:focus-visible`), `${cls}: 초점 표시가 없다`);
  }
  assert.doesNotMatch(text, /outline:\s*(none|0)\b/, "초점 표시를 지우는 규칙");
});
