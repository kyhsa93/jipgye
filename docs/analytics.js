(function () {
  const GA_MEASUREMENT_ID = "G-Z1LH7S1ZE5";
  const ADSENSE_CLIENT_ID = "ca-pub-1195159445218373";
  const PAGE_VIEW_FALLBACK_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 800;
  // 사용자가 직접 치는 칸이 URL에 실리는 키. GA 약관 7조는 개인을 알아볼 수 있는 정보를 보내지 말라고 하고,
  // 자유 입력에는 주소·이름·전화번호가 섞여 들어올 수 있다. 그래서 원문은 GA에 보내지 않는다.
  const FREE_TEXT_PARAMS = ["q", "apt", "dong", "cash", "ga_internal", "ga_debug"];

  // 본인 브라우저만 표시한다. IP를 추측하거나 다른 이용자를 제외하지 않는다.
  // ?ga_internal=1 로 켜고 ?ga_internal=0 으로 끈다. 저장소가 막혀도 현재 페이지에서는 적용한다.
  let internal = false;
  try { internal = localStorage.getItem("jipgye_ga_internal") === "1"; } catch {}
  const internalChoice = new URLSearchParams(location.search ?? "").get("ga_internal");
  if (internalChoice === "1" || internalChoice === "0") {
    internal = internalChoice === "1";
    try {
      localStorage.setItem("jipgye_ga_internal", internal ? "1" : "0");
    } catch {}
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("js", new Date());

  const debugMode = new URLSearchParams(location.search ?? "").has("ga_debug");
  const siteGroup = document.querySelector('meta[name="site-group"]')?.getAttribute("content");

  // gtag는 이벤트마다 현재 주소를 같이 보낸다. 검색어가 쿼리스트링에 있으면 그것도 원문 전송이다.
  function scrub(href) {
    try {
      const url = new URL(href);
      for (const key of FREE_TEXT_PARAMS) url.searchParams.delete(key);
      return url.toString();
    } catch {
      return String(href).split("?")[0];
    }
  }
  const safeLocation = () => scrub(location.href);
  // 앞 장의 주소도 page_referrer 로 따로 나간다(#779). 같은 사이트면 같은 규칙으로 지우고, 바깥이면 출처(origin)만 남긴다.
  const referrer = (() => {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === new URL(location.href).origin) return scrub(ref.href);
      return ref.origin === "null" ? "" : `${ref.origin}/`;
    } catch {
      return "";
    }
  })();
  const refParam = referrer ? { page_referrer: referrer } : {};

  // 검색어 대신 보내는 모양: 몇 글자였는지, 숫자(예산·면적)가 들어 있었는지.
  function termShape(term) {
    const text = String(term ?? "").trim();
    return {
      search_term_length: String(text.length),
      search_term_has_digit: /\d/.test(text) ? "yes" : "no",
    };
  }

  gtag("config", GA_MEASUREMENT_ID, {
    page_location: safeLocation(),
    ...refParam,
    send_page_view: false,
    ...(internal ? { traffic_type: "internal" } : {}),
    ...(siteGroup ? { content_group: siteGroup } : {}),
    ...(debugMode ? { debug_mode: true } : {}),
  });

  let pageViewSent = false;

  function pageView(params) {
    if (pageViewSent) return;
    pageViewSent = true;
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: safeLocation(),
      ...refParam,
      ...params,
    });
  }

  function event(name, params) {
    gtag("event", name, { page_location: safeLocation(), ...refParam, ...(params ?? {}) });
  }

  const debounceTimers = {};
  function debouncedEvent(name, params, delay) {
    clearTimeout(debounceTimers[name]);
    debounceTimers[name] = setTimeout(() => event(name, params), delay ?? SEARCH_DEBOUNCE_MS);
  }

  // 결과가 실제 표시된 뒤 안정된 입력 한 벌당 한 번. signature는 메모리에만 두고 GA로 보내지 않는다.
  const results = {};
  function result(type, signature, params) {
    const state = results[type] ??= {};
    clearTimeout(state.timer);
    if (signature === null) {
      state.last = undefined;
      return;
    }
    if (state.last === signature) return;
    state.timer = setTimeout(() => {
      state.last = signature;
      event("calculator_result", { ...params, calculator_type: type, result_status: "success" });
    }, SEARCH_DEBOUNCE_MS);
  }

  window.analytics = { pageView, event, debouncedEvent, termShape, result };

  setTimeout(() => pageView(), PAGE_VIEW_FALLBACK_MS);

  // 로컬엔 GA·AdSense를 안 붙인다(#466). LAN IP·*.local은 안 막는다.
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;

  const gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(gaScript);

  const adScript = document.createElement("script");
  adScript.async = true;
  adScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
  adScript.crossOrigin = "anonymous";
  document.head.appendChild(adScript);
})();

