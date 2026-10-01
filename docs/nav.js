// 가로로 넘치는 내비게이션을 다룬다. 예순두 장이 같은 파일을 쓴다.
//
// 1층(page-nav)과 2층(sub-nav)은 좁은 화면에서 가로로 잘린다. 잘렸다는 신호가
// 없으면 사용자는 보이는 데까지가 전부인 줄 안다 - 2층 오른쪽 끝에 있는
// '거래내역 검색'과 '전세 vs 월세'가 그래서 아무도 안 누르는 자리에 있었다.
//
// 이 파일이 없어도 페이지는 그대로 돈다. 페이드가 안 보이고 현재 항목이
// 스크롤 밖에 남을 뿐이다.
(function () {
  const navs = document.querySelectorAll(".page-nav, .sub-nav");
  if (!navs.length) return;

  // 양 끝 페이드는 넘칠 때만, 그리고 그 방향에 남은 것이 있을 때만 켠다.
  // 늘 켜 두면 끝까지 밀었는데도 더 있다고 거짓말을 한다.
  function markEdges(nav) {
    const max = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle("scroll-start", max > 1 && nav.scrollLeft > 1);
    nav.classList.toggle("scroll-end", max > 1 && nav.scrollLeft < max - 1);
  }

  // scrollIntoView는 세로로도 움직여 페이지를 끌어내린다. 가로만 직접 옮긴다.
  function revealCurrent(nav) {
    const current = nav.querySelector('[aria-current="page"], .active');
    if (!current || nav.scrollWidth <= nav.clientWidth) return;
    const centered = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, centered);
  }

  for (const nav of navs) {
    revealCurrent(nav);
    markEdges(nav);
    nav.addEventListener("scroll", () => markEdges(nav), { passive: true });
  }

  window.addEventListener("resize", () => {
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

// 머리 버튼은 어느 장이든 셋(공유·테마·언어) - 첫 화면·금리에만 공유가 있어 장마다 버튼 수가 달랐다
// (UIUX #54). 이미 있는 장(index·rates)은 그 장 것을 쓰고, 없는 장에만 같은 동작의 버튼을 붙인다.
(function () {
  if (typeof document.getElementById !== "function" || typeof document.createElement !== "function") return;
  const actions = document.querySelector(".header-actions");
  if (!actions || document.getElementById("share-button")) return;
  const first = actions.querySelector("button");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "share-button";
  button.className = first?.className || "icon-toggle";
  button.setAttribute("aria-label", "Share");
  button.innerHTML = '<span aria-hidden="true">📤</span>';
  actions.insertBefore(button, actions.firstChild);
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
      button.firstChild.textContent = "✅";
      setTimeout(() => (button.firstChild.textContent = "📤"), 1500);
      window.analytics?.event("share", { method: "clipboard" });
    } catch {
      window.prompt("Copy this link:", location.href);
    }
  });
})();
