import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");

function recorder() {
  const calls = [];
  return {
    calls,
    pageView: (params) => calls.push(["page_view", params]),
    event: (name, params) => calls.push([name, params]),
    debouncedEvent: (name, params) => calls.push([name, params]),
  };
}

async function loadAnalytics({
  title = "테스트 제목",
  href = "https://example.test/rates.html",
  search = "",
  siteGroup = "digest",
  hostname = new URL(href).hostname,
  transform = (text) => text,
} = {}) {
  const source = transform(await readFile(path.join(root, "docs/analytics.js"), "utf8"));

  const appended = [];
  const timers = [];

  const context = {
    window: {},
    document: {
      title,
      head: { appendChild: (el) => appended.push(el) },
      createElement: () => ({}),
      querySelector: (sel) =>
        sel === 'meta[name="site-group"]' && siteGroup
          ? { getAttribute: (name) => (name === "content" ? siteGroup : null) }
          : null,
    },
    location: { href, search, hostname },
    URLSearchParams,
    URL,
    setTimeout(fn, ms) {
      timers.push({ fn, ms, cancelled: false });
      return timers.length;
    },
    clearTimeout(id) {
      if (id && timers[id - 1]) timers[id - 1].cancelled = true;
    },
  };

  vm.runInNewContext(source, context);

  return {
    window: context.window,
    document: context.document,
    analytics: context.window.analytics,
    calls: () => context.window.dataLayer.map((args) => Array.from(args)),
    events: () =>
      context.window.dataLayer
        .map((args) => Array.from(args))
        .filter(([kind]) => kind === "event"),
    scriptSrcs: () => appended.map((el) => el.src),
    runTimers: () => {
      for (const timer of [...timers]) {
        if (!timer.cancelled) {
          timer.cancelled = true;
          timer.fn();
        }
      }
    },
  };
}

test("페이지뷰 자동 전송은 꺼두고 로더가 gtag/adsense를 붙인다", async () => {
  const a = await loadAnalytics();

  const config = a.calls().find(([kind]) => kind === "config");
  assert.ok(config, "config 호출이 있어야 한다");
  assert.equal(config[2].send_page_view, false);
  assert.equal(config[2].content_group, "digest");

  const other = await loadAnalytics({ siteGroup: "housing-subsidy-radar" });
  assert.equal(other.calls().find(([kind]) => kind === "config")[2].content_group, "housing-subsidy-radar");

  const none = await loadAnalytics({ siteGroup: null });
  assert.equal(none.calls().find(([kind]) => kind === "config")[2].content_group, undefined);

  const srcs = a.scriptSrcs();
  assert.ok(srcs.some((s) => s.includes("googletagmanager.com/gtag/js?id=G-")));
  assert.ok(srcs.some((s) => s.includes("adsbygoogle.js?client=ca-pub-")));
});

// 로컬 가드(#466): 호스트가 정확히 이 셋일 때만 GA·AdSense script를 안 붙인다. location.hostname 은
// 브라우저에서 IPv6 를 대괄호째 준다. 근접 오탐(접두·접미·부분 일치)은 운영처럼 두 개가 붙어야 한다.
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const NOT_LOCAL_HOSTS = [
  "kyhsa93.github.io",
  "localhost.example.com",
  "mylocalhost",
  "127.0.0.1.evil.com",
  "127.0.0.10",
  "evil-localhost",
  "[::2]",
  "::1",
  "LOCALHOST.example",
  "",
];
const GUARD_LINE = /^ *if \(\[[^\n]*\]\.includes\(location\.hostname\)\) return;\n/m;

function hostHref(host) {
  return `http://${host}/rates.html`;
}

test("로컬 호스트에서는 GA·AdSense script를 안 붙이되 analytics API는 no-op으로 남는다", async () => {
  for (const hostname of LOCAL_HOSTS) {
    const a = await loadAnalytics({ href: hostHref(hostname), hostname });
    assert.deepEqual(a.scriptSrcs(), [], `${hostname}에서 script가 붙었다`);
    assert.deepEqual(
      Object.keys(a.window.analytics).sort(),
      ["debouncedEvent", "event", "pageView", "termShape"],
      `${hostname}에서 analytics 네 함수가 없다`
    );
    assert.doesNotThrow(() => {
      a.analytics.pageView({ site_language: "ko" });
      a.analytics.event("x", { y: "1" });
      a.analytics.debouncedEvent("s", {});
      a.analytics.termShape("가1");
      a.runTimers();
    }, `${hostname}에서 호출이 던졌다`);
  }
});

test("운영·근접 오탐 호스트는 script 둘을 그대로 붙인다", async () => {
  for (const hostname of NOT_LOCAL_HOSTS) {
    const a = await loadAnalytics({ href: hostHref(hostname || "x.test"), hostname });
    assert.deepEqual(
      a.scriptSrcs(),
      [
        "https://www.googletagmanager.com/gtag/js?id=G-Z1LH7S1ZE5",
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1195159445218373",
      ],
      `${JSON.stringify(hostname)}에서 script 둘이 정확히 붙어야 한다`
    );
  }
});

test("양성 대조: 가드 줄을 빼면 로컬 호스트에서도 script가 붙는다(위 시험이 가드를 실제로 본다)", async () => {
  const stripped = (text) => {
    assert.ok(GUARD_LINE.test(text), "가드 줄을 못 찾았다 - 이 대조가 허공을 친다");
    return text.replace(GUARD_LINE, "");
  };
  for (const hostname of LOCAL_HOSTS) {
    const a = await loadAnalytics({ href: hostHref(hostname), hostname, transform: stripped });
    assert.equal(a.scriptSrcs().length, 2, `${hostname}: 가드를 빼도 안 붙으면 로컬 시험이 아무것도 안 잡는다`);
  }
});

test("페이지뷰는 렌더가 끝난 뒤 제목·언어와 함께 나간다", async () => {
  const a = await loadAnalytics({ title: "Deposit, Savings & Loan Rates" });

  a.analytics.pageView({ site_language: "en" });

  const [, name, params] = a.events()[0];
  assert.equal(name, "page_view");
  assert.equal(params.page_title, "Deposit, Savings & Loan Rates");
  assert.equal(params.page_location, "https://example.test/rates.html");
  assert.equal(params.site_language, "en");
});

test("언어를 바꿔 다시 불려도 페이지뷰를 두 번 세지 않는다", async () => {
  const a = await loadAnalytics();

  a.analytics.pageView({ site_language: "ko" });
  a.analytics.pageView({ site_language: "en" });
  a.runTimers();

  assert.equal(a.events().filter(([, name]) => name === "page_view").length, 1);
});

test("렌더가 실패해 아무도 안 부르면 타이머가 대신 보낸다", async () => {
  const a = await loadAnalytics();

  assert.equal(a.events().length, 0);
  a.runTimers();

  const pageViews = a.events().filter(([, name]) => name === "page_view");
  assert.equal(pageViews.length, 1);
});

test("사용자가 친 글자는 주소에서도 이벤트에서도 GA로 나가지 않는다", async () => {
  const a = await loadAnalytics({
    href: "https://example.test/deal-search.html?district=gangnam&apt=%ED%99%8D%EA%B8%B8%EB%8F%99&dong=x&q=010-1234-5678",
  });

  a.analytics.pageView();
  a.analytics.event("deal_search", { search_kind: "sale" });
  a.analytics.debouncedEvent("search", a.analytics.termShape(" 강남구 84 "));
  a.runTimers();

  const config = a.calls().find(([kind]) => kind === "config");
  const sent = [config[2], ...a.events().map(([, , params]) => params)];
  for (const params of sent) {
    assert.equal(params.page_location, "https://example.test/deal-search.html?district=gangnam");
  }
  const search = a.events().find(([, name]) => name === "search")[2];
  assert.equal(search.search_term, undefined);
  assert.equal(search.search_term_length, "6");
  assert.equal(search.search_term_has_digit, "yes");
});

test("검색 이벤트는 마지막 입력 한 번으로 합쳐진다", async () => {
  const a = await loadAnalytics();

  a.analytics.debouncedEvent("search", a.analytics.termShape("금"));
  a.analytics.debouncedEvent("search", a.analytics.termShape("금리"));
  a.analytics.debouncedEvent("search", a.analytics.termShape("금리인하"));
  a.runTimers();

  const searches = a.events().filter(([, name]) => name === "search");
  assert.equal(searches.length, 1);
  assert.equal(searches[0][2].search_term_length, "4");
});

test("DebugView는 ?ga_debug=1을 붙였을 때만 켜진다", async () => {
  const off = await loadAnalytics();
  assert.equal(off.calls().find(([kind]) => kind === "config")[2].debug_mode, undefined);

  const on = await loadAnalytics({ search: "?ga_debug=1" });
  assert.equal(on.calls().find(([kind]) => kind === "config")[2].debug_mode, true);
});

test("이벤트 매개변수에 GA4 예약 이름을 쓰지 않는다", async () => {
  // 둘째 장은 금리 허브였다 - #577 B2 로 종료 안내 장이 되어 계측을 싣지 않아 소개 장으로 바꿨다.
  const [index, about] = await Promise.all(
    [`${SITE}/index.html`, `${SITE}/about.html`].map((p) => readFile(path.join(root, p), "utf8"))
  );

  for (const [name, html] of [
    ["index.html", index],
    ["about.html", about],
  ]) {
    const params = [...html.matchAll(/window\.analytics\?\.\w+\(([\s\S]*?)\);/g)].map((m) => m[1]);
    for (const block of params) {
      assert.ok(!/[{,]\s*value:/.test(block), `${name}에 예약 매개변수 value가 쓰였다: ${block}`);
    }
  }
});

test("데이터를 못 받으면 어느 파일이 실패했는지 남는다", async () => {
  const analytics = recorder();
  await loadIndexPage({ analytics });

  const failures = analytics.calls.filter(([name]) => name === "exception");
  const fatal = failures.filter(([, params]) => params.fatal);
  assert.equal(fatal.length, 4, `fatal 4건이어야 한다: ${JSON.stringify(failures)}`);
  for (const key of ["market", "news", "summary", "realestate"]) {
    assert.ok(
      fatal.some(([, params]) => params.description.includes(`load ${key}:`)),
      `${key} 실패가 안 남았다`
    );
  }

  assert.ok(failures.some(([, params]) => params.fatal === false));
  assert.ok(failures.every(([, params]) => params.description.length <= 100));
});

test("섹션은 화면에 들어왔을 때 한 번만 센다", async () => {
  const analytics = recorder();
  const page = await loadIndexPage({ analytics });

  assert.equal(page.observedCount(), 5, "다섯 섹션 모두 관찰이 걸려야 한다");
  assert.equal(analytics.calls.filter(([n]) => n === "section_view").length, 0, "보기 전엔 안 센다");

  page.scrollTo(0);
  page.scrollTo(0);
  page.scrollTo(1);

  const views = analytics.calls.filter(([n]) => n === "section_view");
  assert.equal(views.length, 2, "같은 섹션을 다시 봐도 한 번이다");
  assert.deepEqual(
    views.map(([, params]) => params.section_name),
    ["market", "realestate"]
  );
  assert.equal(views[0][1].view_type, "today");
});

test("섹션 노출은 길이에 좌우되는 조건으로 재지 않는다", async () => {
  const page = await loadIndexPage({ analytics: recorder() });
  const { options } = page.observer();

  assert.ok(options.rootMargin?.includes("-"), "화면 가운데 띠로 재야 한다");
  assert.ok(
    options.threshold === undefined || options.threshold === 0,
    `길이에 좌우되는 threshold를 쓰고 있다: ${options.threshold}`
  );
});

test("두 페이지와 서비스워커가 모두 analytics.js를 물고 있다", async () => {
  // 둘째 장은 금리 허브였다 - #577 B2 로 종료 안내 장이 되어 계측을 싣지 않아 소개 장으로 바꿨다.
  const [index, about, sw] = await Promise.all(
    [`${SITE}/index.html`, `${SITE}/about.html`, "docs/sw.js"].map((p) =>
      readFile(path.join(root, p), "utf8")
    )
  );

  for (const [name, html] of [
    ["index.html", index],
    ["about.html", about],
  ]) {
    assert.ok(html.includes('<script src="./analytics.js"></script>'), `${name}에 로더가 없다`);
    assert.ok(html.includes('<meta name="site-group" content="digest">'), `${name}에 사이트 구분이 없다`);
    assert.ok(!html.includes("googletagmanager.com"), `${name}에 인라인 GA가 남아 있다`);
    assert.ok(html.includes("privacy-policy"), `${name}에 개인정보처리방침 링크가 없다`);
  }

  assert.ok(sw.includes('"./analytics.js"'), "서비스워커 셸에 analytics.js가 빠졌다");
});

test("요약이 폴백된 날은 메인에도 그 사실을 표시한다", async () => {
  const html = await readFile(path.join(root, `${SITE}/index.html`), "utf8");
  assert.ok(html.includes("summaryFallbackNote"), "안내 문구 사전 항목이 없다");
  assert.ok(
    html.includes("categories.some((c) => c.fallbackReason)"),
    "fallbackReason을 화면 표시에 쓰지 않는다"
  );
  for (const dict of ["일부 항목은 검증에서", "Some summaries failed verification"]) {
    assert.ok(html.includes(dict), `안내 문구가 한쪽 언어에만 있다: ${dict}`);
  }
});

test("로드가 실패하면 다시 시도할 수단을 준다", async () => {
  for (const file of [`${SITE}/index.html`, `${SITE}/news.html`]) {
    const html = await readFile(path.join(root, file), "utf8");
    // 단추를 공용 docs/load-state.js가 만드는 장은(#173) 페이지에 id만 남는다. 표 위 알림의 단추 id 는 공용 함수의 기본값(load-retry)이라
    // 페이지에 글자로 안 남으므로 공용 함수를 부르는 줄로 본다(#296 (마), 실제 단추는 test/load-failure.test.mjs 가 누른다).
    assert.ok(/id="load-(error-)?retry"|retryId: "load-retry"|window\.loadState\.showFailure\(/.test(html), `${file}에 재시도 버튼이 없다`);
    assert.ok(html.includes('"다시 시도"') && html.includes('"Retry"'), `${file} 재시도 문구가 한쪽 언어에만 있다`);
    assert.ok(html.includes('event("load_retry"'), `${file}에서 재시도를 계측하지 않는다`);
  }
});
