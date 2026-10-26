// 실거래 검색 결과(#745): 조건 칩·정렬 칸·빈 결과 풀기 링크·오류 상자(role=alert)·줄 계층(단지명→위치→가격→전용·층·일). 규칙과 시험: test/deal-search.test.mjs
(() => {
  const E = escapeHtml;
  const L = (ko, en) => (locale === "en" ? en : ko);
  const bar = document.getElementById("result-bar");
  const box = document.getElementById("search-result");
  const url = (k, q = new URLSearchParams(location.search)) => (q.delete(k), location.pathname + (String(q) && `?${q}`));

  const drop = (k) => {
    if (k === "all") clearFilters();
    else if (k === "max") self.maxPick("");
    else if (k === "budget") band10k = null;
    else if (k === "apt") aptQuery = "";
    else if (k === "dong") dongQuery = "";
    else if (k === "direct") excludeDirect = false;
    else if (k === "district") district = ALL;
    else if (k === "deposit") depositKey = ALL;
    else if (k === "rent") rentKey = ALL;
    else if (k === "area") areaKey = ALL;
    else if (k === "age") ageKey = ALL;
    afterControlChange();
  };

  const decorate = () => {
    const c = self.conds();
    const html = box.innerHTML;
    bar.innerHTML =
      (c.length
        ? `<ul class="c-chips" aria-label="${L("적용 조건", "Filters")}">` +
          c.map(([k, n]) => `<li class="c-filter-chip">${E(n)}<button type="button" class="c-filter-chip__x" data-drop="${k}" aria-label="${E(L(`${n} 해제`, `Remove ${n}`))}">×</button></li>`).join("") +
          `<li><button type="button" class="c-btn c-btn--secondary" data-drop="all">${L("전체 초기화", "Reset all")}</button></li></ul>`
        : "") +
      (!groupView && html.includes('<ul class="budget-deals">')
        ? `<p class="result-sort"><label for="sort-select">${L("정렬", "Sort")}</label> <select id="sort-select" class="c-select">` +
          self.sorts().map(([k, n]) => `<option value="${k}"${k === self.sortOn() ? " selected" : ""}${k && !self.sortOk() ? " disabled" : ""}>${n}</option>`).join("") +
          `</select>${self.sortOk() ? "" : ` <span class="result-note">${L("가격순은 자치구를 고르면 켜집니다(서울 전체 목록은 일부 표본).", "Pick a district to sort by price.")}</span>`}</p>`
        : "");
    if ([t("empty"), t("groupEmpty")].some((m) => html.startsWith(`<p class="budget-empty">${E(m)}</p>`)))
      box.innerHTML =
        `<div class="c-state c-state--empty">${html}` +
        (c.length
          ? `<p class="c-state__body">${L("조건을 하나씩 풀어 보세요.", "Try removing one filter.")}</p><ul class="c-chips">` +
            c.map(([k, n]) => `<li><a class="c-chip" href="${E(url(k))}" data-drop="${k}">${E(L(`「${n}」 풀기`, `Remove “${n}”`))}</a></li>`).join("") +
            "</ul>"
          : "") +
        "</div>";
  };
  const sf = loadState.showFailure;
  loadState.showFailure = (el, o) => sf(el, { ...o, wrap: (i) => `<div class="c-state c-state--error" role="alert"><p class="c-state__title">${L("오류", "Error")}</p>${(o.wrap || String)(i)}</div>` });
  const rr = renderResult;
  renderResult = () => (rr(), decorate());

  const row = (d, name, price, tag) =>
    `<li class="budget-deal"><strong class="apt">${E(d.apt)}</strong>${tag ? `<span class="tag">${E(tag)}</span>` : ""}` +
    `<span class="place">${E([d.district ?? (name === ALL ? null : name), d.dong].filter(Boolean).join(" "))}</span>` +
    `<span class="price">${E(price)}</span><span class="spec">${E(L("전용 ", "") + d.area + "㎡" + (d.floor ? ` · ${t("floor")(d.floor)}` : ""))}` +
    ` · <span class="when">${E(dealWhen(d.date))}</span></span></li>`;
  dealHtml = (d, n) => row(d, n, formatEok(d.amount10k), d.direct === true && t("directTag"));
  rentHtml = (d, n) => row(d, n, rentPriceHtml(d), d.renewal === true && t("renewalTag"));

  const click = (e) => {
    const el = e.target?.closest?.("[data-drop]");
    if (el) e.preventDefault?.(), drop(el.dataset.drop);
  };
  bar.addEventListener("click", click);
  box.addEventListener("click", click);
  bar.addEventListener("change", (e) => {
    if (e.target?.id === "sort-select") self.sortOn(e.target.value), syncUrl(), renderResult();
  });
  if (/budget-deal|load-retry-/.test(box.innerHTML)) renderResultBody();
  decorate();
})();
