// 가로로 넘치는 내비게이션을 다룬다. 예순두 장이 같은 파일을 쓴다.
//
// 1층(page-nav)과 2층(sub-nav)은 좁은 화면에서 가로로 잘린다. 잘렸다는 신호가
// 없으면 사용자는 보이는 데까지가 전부인 줄 안다 - 2층 오른쪽 끝에 있는
// '거래내역 검색'과 '전세 vs 월세'가 그래서 아무도 안 누르는 자리에 있었다.
//
// 가로로 넘치는 표(.table-scroll)도 같은 장치를 쓴다 (#178). 폰(358px 가용 폭)에서 신고가 표(9열)·
// 재계약 표·전망 성적표는 오른쪽이 화면 밖인데, 잘렸다는 단서가 없어 "옆에 더 있는 표인가"를 알 수 없었다.
// 표마다 새로 만들지 않고 이 한 곳에서 .table-scroll 전부를 다룬다.
//
// 이 파일이 없어도 페이지는 그대로 돈다. 페이드가 안 보이고 현재 항목이
// 스크롤 밖에 남을 뿐이다.
(function () {
  const navs = document.querySelectorAll(".page-nav, .sub-nav, .table-scroll");
  if (!navs.length) return;

  // 양 끝 페이드는 넘칠 때만, 그리고 그 방향에 남은 것이 있을 때만 켠다.
  // 늘 켜 두면 끝까지 밀었는데도 더 있다고 거짓말을 한다.
  function markEdges(nav) {
    const max = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle("scroll-start", max > 1 && nav.scrollLeft > 1);
    nav.classList.toggle("scroll-end", max > 1 && nav.scrollLeft < max - 1);
    // 표는 넘칠 때만 키보드 초점을 받는다. 마우스·터치가 아닌 사람이 화살표로 가로 스크롤하려면
    // 스크롤 영역이 초점을 받아야 한다. 안 넘치는 표까지 탭 순서에 넣으면 소음이다. 역할·이름은
    // 붙이지 않는다 - 스크린리더에는 표 그대로 읽히고 "영역" 안내가 더 얹히지 않는다.
    if (typeof nav.matches === "function" && nav.matches(".table-scroll")) {
      if (max > 1) nav.setAttribute("tabindex", "0");
      else nav.removeAttribute("tabindex");
    }
  }

  // 표 칸은 페이지 스크립트가 나중에 다시 채우고(prerender 뒤 innerHTML 교체) 글꼴·언어 전환으로도
  // 폭이 바뀐다. 스크롤 이벤트만으로는 이걸 못 따라가므로 크기·내용이 바뀔 때 다시 센다.
  function watchTable(el) {
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => markEdges(el));
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(() => markEdges(el)).observe(el, { childList: true, subtree: true, characterData: true });
    }
  }

  // scrollIntoView는 세로로도 움직여 페이지를 끌어내린다. 가로만 직접 옮긴다.
  function revealCurrent(nav) {
    const current = nav.querySelector('[aria-current="page"], .active');
    if (!current || nav.scrollWidth <= nav.clientWidth) return;
    const centered = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, centered);
  }

  for (const nav of navs) {
    const isTable = typeof nav.matches === "function" && nav.matches(".table-scroll");
    // 표는 처음 위치(첫 열=이름이 보이는 자리)에서 시작해야 한다 - 현재 항목 맞추기는 내비 전용.
    if (!isTable) revealCurrent(nav);
    markEdges(nav);
    nav.addEventListener("scroll", () => markEdges(nav), { passive: true });
    if (isTable) watchTable(nav);
  }

  window.addEventListener("resize", () => {
    for (const nav of navs) markEdges(nav);
  });
  // 글꼴이 늦게 들어와 표 폭이 달라지는 경우까지 한 번 더 센다.
  window.addEventListener("load", () => {
    for (const nav of navs) markEdges(nav);
  });
})();

// 워드마크는 예순두 장에 정적으로 박혀 있다. 페이지마다 사전이 제각각이라
// 한 곳에서 바꾸는 편이 낫고, 건너뛰기 링크가 이미 같은 방식이다.
(function () {
  const brand = document.querySelector(".brand[data-brand-en]");
  if (brand && document.documentElement.getAttribute("lang") === "en") {
    brand.textContent = brand.getAttribute("data-brand-en");
  }
})();

// 데이터 기준일 옆 "n일 전 자료" (#111). 기준일(#updated의 data-updated, YYYY-MM-DD)은 빌드가 HTML에 박고,
// 며칠 지났는지는 페이지를 여는 순간 여기서 KST 오늘로 센다. 빌드가 멈춰도 HTML이 얼어붙은 채 경고가
// 사라지지 않게 하려는 분리다. 기준일을 못 읽으면 경고하지 않는다(없는 날짜로 겁주지 않는다).
// 문턱은 scripts/source-age.mjs의 STALE_DAYS와 같아야 하고 test/updated-stamp.test.mjs가 묶는다.
// 교차값(실거래 x 금리) 화면은 입력별 기준일 줄(#cross-basis)도 같은 방식으로 센다 (#154) - 입력 하나라도
// 낡으면 어느 입력이 며칠인지 글로 밝힌다. 화면 기준일은 가장 오래된 날짜 하나만 말하므로 따로 둔 줄이다.
(function () {
  const STALE_DAYS = 2;
  if (typeof document.getElementById !== "function") return;
  const DAY = 86400000;
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const isEn = () => document.documentElement.getAttribute("lang") === "en";
  // 기준일(YYYY-MM-DD)이 오늘(KST 날짜)보다 며칠 전인가. 일 단위 버림, 기준일이 미래면 0. 못 읽으면 null.
  function daysSince(ymd) {
    if (!YMD.test(ymd || "")) return null;
    const ms = Date.parse(`${ymd}T00:00:00Z`);
    if (Number.isNaN(ms)) return null;
    const today = Math.floor((new Date().getTime() + 9 * 3600 * 1000) / DAY);
    return Math.max(0, today - Math.floor(ms / DAY));
  }
  function watchLang(render) {
    render();
    // 화면 언어를 바꾸면 lang 속성이 바뀐다 - 경고 문구도 따라간다.
    if (typeof MutationObserver === "function") {
      new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
  }

  const stamp = document.getElementById("updated");
  const base = stamp?.getAttribute("data-updated");
  const warn = document.getElementById("updated-warn");
  if (warn && daysSince(base) !== null) {
    watchLang(function () {
      const en = isEn();
      // 정적 라벨("기준일 YYYY-MM-DD", #123)을 화면 언어로 맞춘다. 정적 라벨 모양일 때만 바꾼다 - 페이지
      // 스크립트가 #updated를 자기 문장(기간·보관본 안내)으로 바꾼 장은 그 장의 사전이 언어를 따르므로 건드리지 않는다.
      if (/^(기준일|As of) \d{4}-\d{2}-\d{2}$/.test(stamp.textContent || "")) stamp.textContent = `${en ? "As of" : "기준일"} ${base}`;
      const days = daysSince(base);
      const stale = days >= STALE_DAYS;
      warn.hidden = !stale;
      warn.textContent = stale ? (en ? `Data from ${days} days ago` : `${days}일 전 자료`) : "";
    });
  }

  const basis = document.getElementById("cross-basis");
  const crossWarn = document.getElementById("cross-warn");
  if (basis && crossWarn) {
    const inputs = [
      { attr: "data-deals", ko: "실거래", en: "Deals" },
      { attr: "data-rates", ko: "금리", en: "Rates" },
    ];
    watchLang(function () {
      const en = isEn();
      const dates = inputs.map((i) => basis.getAttribute(i.attr));
      // 줄 글자는 빌드가 한국어로 박아 둔다. 정적 모양일 때만, 두 날짜를 다 읽었을 때만 화면 언어로 바꾼다.
      if (dates.every((d) => YMD.test(d || "")) && /^(실거래|Deals) \d{2}-\d{2} x (금리|Rates) \d{2}-\d{2}$/.test(basis.textContent || "")) {
        const [d, r] = dates.map((x) => x.slice(5));
        basis.textContent = en ? `Deals ${d} x Rates ${r}` : `실거래 ${d} x 금리 ${r}`;
      }
      // 낡은 입력만 이름 붙여 말한다. 못 읽은 입력은 건너뛴다(없는 날짜로 겁주지 않는다).
      const parts = [];
      inputs.forEach((i, k) => {
        const days = daysSince(dates[k]);
        if (days !== null && days >= STALE_DAYS) parts.push(en ? `${i.en} data from ${days} days ago` : `${i.ko} ${days}일 전 자료`);
      });
      crossWarn.hidden = parts.length === 0;
      crossWarn.textContent = parts.join(" \u00b7 ");
    });
  }
})();

// 건너뛰기 링크는 스크립트 없이도 있어야 하므로 HTML에 한국어로 박아 두었다.
// 화면 언어가 영어면 여기서 바꾼다 - 이 파일이 페이지 스크립트보다 뒤에 돌아
// documentElement.lang은 이미 정해져 있다.
(function () {
  const link = document.querySelector(".skip-link[data-skip-en]");
  if (link && document.documentElement.getAttribute("lang") === "en") {
    link.textContent = link.getAttribute("data-skip-en");
  }
})();

// 질문 화면 맨 아래 "다른 질문" — 첫 화면 질문 입구와 같은 세 묶음(UIUX #45). 층·신고가·갈아타기·전망은
// 2층 메뉴가 없어 형제 화면이 안 보였다. 목록은 여기 한 곳에만 두고(test/question-nav.test.mjs가 첫 화면과
// 같은지 본다), 자리(#other-questions)가 있는 화면에만 그린다. 지금 화면은 뺀다.
(function () {
  const QUESTION_GROUPS = [
    {
      ko: "집을 사려는 사람",
      en: "Buying",
      items: [
        ["./budget-10eok.html", "내 예산이면 서울 어디까지", "What does my budget buy?"],
        ["./realestate.html", "우리 동네는 얼마에 팔렸나", "What did homes near me sell for?"],
        ["./deal-search.html", "조건을 걸어 실거래 찾기", "Search transactions by condition"],
        ["./floor-gap.html", "1층은 얼마나 싸야 정상인가", "How much less should a first floor be?"],
        ["./record-high.html", "신고가, 이제 그 값인가", "A record high. Is that the price now?"],
        ["./price-outlook.html", "3개월 뒤 값과 그 오차", "Prices in 3 months, with the error"],
      ],
    },
    {
      ko: "전월세를 구하는 사람",
      en: "Renting",
      items: [
        ["./jeonse-vs-wolse.html", "전세가 쌀까, 월세가 쌀까", "Is jeonse or monthly rent cheaper?"],
        ["./renewal-vs-new.html", "재계약이 새로 구하는 것보다 싼가", "Is renewing cheaper than moving?"],
      ],
    },
    {
      ko: "옮기거나 파는 사람",
      en: "Moving or selling",
      items: [
        ["./switch-house.html", "갈 동네는 얼마나 올랐나", "How far has the next district risen?"],
        ["./cancelled-deals.html", "계약이 취소되는 일이 흔한가", "How often do deals fall through?"],
      ],
    },
  ];
  if (typeof window !== "undefined") window.QUESTION_GROUPS = QUESTION_GROUPS;
  if (typeof document.getElementById !== "function") return;
  const holder = document.getElementById("other-questions");
  if (!holder) return;
  const en = document.documentElement.getAttribute("lang") === "en";
  const here = (String(globalThis.location?.pathname ?? "").split("/").pop() || "index.html").toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const groups = QUESTION_GROUPS.map((g) => {
    const links = g.items
      .filter(([href]) => href.replace("./", "") !== here)
      .map(([href, ko, enText]) => `<a href="${href}">${esc(en ? enText : ko)}</a>`)
      .join("");
    return links ? `<div class="question-group"><h3 class="question-group-title">${esc(en ? g.en : g.ko)}</h3>${links}</div>` : "";
  }).join("");
  holder.innerHTML = `<h2>${en ? "Other questions" : "다른 질문"}</h2><nav class="question-nav" aria-label="${en ? "Other questions" : "다른 질문"}">${groups}</nav>`;
})();

// 머리 버튼은 어느 장이든 셋(공유·테마·언어)이고, 셋 다 구운 HTML에 들어 있다 (UIUX #54, #306).
// 예전에는 여기서 공유 버튼을 만들어 끼워 넣었다 - 그러면 첫 그리기 뒤에 머리의 버튼이 둘에서 셋으로
// 늘어 예순두 장이 0.001 밀렸다(#306). 지금은 만들지 않고 동작만 건다.
// data-share="page"인 다섯 장(첫 화면·금리 넷)은 장 안의 인라인 스크립트가 자기 문구로 공유하므로
// 건드리지 않는다 - 겹쳐 걸면 한 번 눌러 두 번 공유된다.
(function () {
  if (typeof document.getElementById !== "function") return;
  const button = document.getElementById("share-button");
  if (!button || button.getAttribute("data-share") === "page") return;
  const icon = button.querySelector?.("span") ?? button.firstChild;
  button.addEventListener("click", async () => {
    const data = { title: document.title, url: location.href };
    if (navigator.share) {
      try {
        await navigator.share(data);
        window.analytics?.event("share", { method: "web_share" });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(location.href);
      icon.textContent = "✅";
      setTimeout(() => (icon.textContent = "📤"), 1500);
      window.analytics?.event("share", { method: "clipboard" });
    } catch {
      window.prompt("Copy this link:", location.href);
    }
  });
})();

// 머리 버튼 셋의 aria-label이 페이지 언어를 따른다 (#112). 정적 HTML은 ko로 박혀 있고, 언어 전환
// 핸들러는 장마다 인라인(예순일곱 곳)이라 라벨을 따로 갱신하지 않는다 - 전환 때 모두 html lang을
// 바꾸므로 그 속성을 지켜보다가 세 버튼을 한 곳에서 다시 맞춘다. 공유 버튼도 구운 HTML에 박혀 있다(#306).
(function () {
  if (typeof document.getElementById !== "function" || !document.documentElement) return;
  const LABELS = {
    ko: { "share-button": "공유", "theme-toggle": "테마 전환", "lang-toggle": "언어 전환" },
    en: { "share-button": "Share", "theme-toggle": "Toggle theme", "lang-toggle": "Switch language" },
  };
  function apply() {
    const labels = LABELS[document.documentElement.getAttribute("lang") === "en" ? "en" : "ko"];
    for (const id of Object.keys(labels)) document.getElementById(id)?.setAttribute("aria-label", labels[id]);
  }
  apply();
  if (typeof MutationObserver === "function") {
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
})();

// 내 조건 기억 (#654): 화면에서 고른 구·면적·예산을 적어 두고 메인 질문 링크에 각 화면이 읽는 매개변수로 붙인다.
// 적은 것이 없거나 저장소가 막히면 링크는 구운 그대로. 표는 test/my-conditions.test.mjs 가 사이트 목록과 묶는다.
(function () {
  try {
    const KEY = "myConditions";
    const SLUGS = { 종로구: "jongno", 중구: "jung", 용산구: "yongsan", 성동구: "seongdong", 광진구: "gwangjin", 동대문구: "dongdaemun", 중랑구: "jungnang", 성북구: "seongbuk", 강북구: "gangbuk", 도봉구: "dobong", 노원구: "nowon", 은평구: "eunpyeong", 서대문구: "seodaemun", 마포구: "mapo", 양천구: "yangcheon", 강서구: "gangseo", 구로구: "guro", 금천구: "geumcheon", 영등포구: "yeongdeungpo", 동작구: "dongjak", 관악구: "gwanak", 서초구: "seocho", 강남구: "gangnam", 송파구: "songpa", 강동구: "gangdong" };
    const BAND = { 60: "under60", "60-85": "60to85", "85-135": "over85", 135: "over85" };
    const M2 = { 60: 59, "60-85": 84, "85-135": 114, 135: 114 };
    const AREA_OF = { under60: "60", "60to85": "60-85", over85: "85-135", 59: "60", 84: "60-85", 114: "85-135" };
    const pick = (map, value) => Object.keys(map).find((k) => map[k] === value);
    const own = (map, key) => (typeof key === "string" && Object.hasOwn(map, key) ? key : undefined);
    const district = (name) => own(SLUGS, name);
    const area = (key) => own(M2, key);
    const areaOf = (key) => AREA_OF[own(AREA_OF, key)];
    let saved = {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(KEY));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
    } catch (e) {}

    const file = location.pathname.split("/").pop() || "index.html";
    const read = (chose) => {
      const p = new URLSearchParams(location.search);
      const page = /^district-([a-z]+)\.html$/.exec(file);
      const budget = /^budget-(\d+)eok\.html$/.exec(file);
      if (file === "deal-search.html") {
        const b = (p.get("budget") ?? "").trim();
        return { district: district(p.get("district")), area: area(p.get("area")), budget: /^\d+$/.test(b) ? +b : undefined };
      }
      if (file === "jeonse-vs-wolse.html") return { district: district(p.get("district")), area: areaOf(p.get("band")) };
      if (file === "switch-house.html") return { district: district(p.get("to")), home: district(p.get("from")) };
      if (budget) return { budget: chose ? +budget[1] : undefined };
      if (page || file === "realestate.html") return { district: page && chose ? pick(SLUGS, page[1]) : undefined, area: areaOf(p.get("area")) };
      return {};
    };
    const save = (chose) => {
      let changed = false;
      for (const [k, v] of Object.entries(read(chose))) if (v !== undefined && saved[k] !== v) (saved[k] = v), (changed = true);
      try {
        if (changed) window.localStorage.setItem(KEY, JSON.stringify(saved));
      } catch (e) {}
    };
    // 들어온 주소는 바로, 기본값·장 이름(예산대·자치구)은 고른 뒤에만 적는다.
    let touched = false;
    document.addEventListener("change", () => (touched = true), true);
    document.addEventListener("click", (e) => e.target?.closest?.("[role=radio]") && (touched = true), true);
    window.addEventListener("pagehide", () => touched && save(true));
    // 바깥 공유 링크는 적지 않는다
    if ((document.referrer || "").startsWith(location.origin + "/")) save(false);

    const d = district(saved.district);
    const a = area(saved.area);
    const b = Number.isInteger(saved.budget) ? saved.budget : undefined;
    const home = district(saved.home);
    const query = (pairs) => {
      const p = new URLSearchParams();
      for (const [k, v] of pairs) if (v !== undefined) p.set(k, String(v));
      const s = p.toString();
      return s ? `?${s}` : "";
    };
    const hrefs = {
      "q-budget": b >= 3 && b <= 20 ? `./budget-${b}eok.html` : "",
      "q-realestate": (d ? `./district-${SLUGS[d]}.html` : "./realestate.html") + query([["area", a && M2[a] !== 84 ? M2[a] : undefined]]),
      "q-search": "./deal-search.html" + query([["district", d], ["budget", b], ["area", a]]),
      "q-conversion": "./jeonse-vs-wolse.html" + query([["district", d], ["band", a && BAND[a]]]),
      // 지금 사는 구를 모르면 갈 구와 다른 첫 구(화면 기본값과 같은 순서)를 넘겨 같은 구끼리 견주지 않게 한다.
      "q-switch": "./switch-house.html" + query([["from", home && home !== d ? home : d && Object.keys(SLUGS).find((n) => n !== d)], ["to", d]]),
    };
    for (const [id, href] of Object.entries(hrefs)) {
      const link = document.getElementById(id);
      if (link && href && href !== link.getAttribute("href") && link.closest("#question-nav")) link.setAttribute("href", href);
    }
  } catch (e) {}
})();
