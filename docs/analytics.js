(function () {
  const GA_MEASUREMENT_ID = "G-Z1LH7S1ZE5";
  const ADSENSE_CLIENT_ID = "ca-pub-1195159445218373";
  const PAGE_VIEW_FALLBACK_MS = 4000;
  const SEARCH_DEBOUNCE_MS = 800;
  // 사용자가 직접 치는 칸이 URL에 실리는 키. GA 약관 7조는 개인을 알아볼 수 있는 정보를 보내지 말라고 하고,
  // 자유 입력에는 주소·이름·전화번호가 섞여 들어올 수 있다. 그래서 원문은 GA에 보내지 않는다.
  const FREE_TEXT_PARAMS = ["q", "apt", "dong"];

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("js", new Date());

  const debugMode = new URLSearchParams(location.search ?? "").has("ga_debug");
  const siteGroup = document.querySelector('meta[name="site-group"]')?.getAttribute("content");

  // gtag는 이벤트마다 현재 주소를 같이 보낸다. 검색어가 쿼리스트링에 있으면 그것도 원문 전송이다.
  function safeLocation() {
    try {
      const url = new URL(location.href);
      for (const key of FREE_TEXT_PARAMS) url.searchParams.delete(key);
      return url.toString();
    } catch {
      return location.href.split("?")[0];
    }
  }

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
    send_page_view: false,
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
      ...params,
    });
  }

  function event(name, params) {
    gtag("event", name, { page_location: safeLocation(), ...(params ?? {}) });
  }

  const debounceTimers = {};
  function debouncedEvent(name, params, delay) {
    clearTimeout(debounceTimers[name]);
    debounceTimers[name] = setTimeout(() => event(name, params), delay ?? SEARCH_DEBOUNCE_MS);
  }

  window.analytics = { pageView, event, debouncedEvent, termShape };

  setTimeout(() => pageView(), PAGE_VIEW_FALLBACK_MS);

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
