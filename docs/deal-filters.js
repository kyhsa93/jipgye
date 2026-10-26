// 실거래 검색 조건(#745): 상세 조건 접기·예산 이하 max·걸린 조건 목록. 시험: test/deal-search.test.mjs
(() => {
  const M = [3, 5, 8, 10, 15, 20];
  const ko = () => locale !== "en";
  const set = (n) => (self.maxTo = n > 0 ? n * EOK : NaN);
  set(+params.get("max")); // 인라인이 처음 읽은 주소
  // 목록 밖 값은 숫자 순 자리에. budget 과 함께 오면 max 만 쓴다.
  if (self.maxTo && !M.includes(self.maxTo / EOK)) M.push(self.maxTo / EOK), M.sort((a, b) => a - b);
  if (self.maxTo) band10k = null;
  const label = (n) => (ko() ? `${n}억 이하` : `≤ ₩${n * 100}M`);
  self.maxLabel = () => label(self.maxTo / EOK);
  self.maxOpts = () => M.map((n) => optionHtml(`m${n}`, label(n), self.maxTo === n * EOK)).join("");
  // 예산 select 의 "m8" 이면 max 로 받고 참.
  self.maxPick = (raw) => set(raw[0] === "m" ? +raw.slice(1) : 0);
  // 「조건 지우기」가 max 도 지운다. 전월세에선 예산 칸이 숨으니 max 를 안 센다.
  const clear = clearFilters;
  const any = anyFilterOn;
  clearFilters = () => (clear(), set(0));
  anyFilterOn = () => any() || (!isRent() && !!self.maxTo);
  self.moreCount = () => {
    const n = [areaKey !== ALL, ageKey !== ALL, aptTerm(), excludeDirect, groupView].filter(Boolean).length;
    setText("more-label", (ko() ? "상세 조건 더 보기" : "More filters") + (n ? (ko() ? ` (${n}개 적용)` : ` (${n})`) : ""));
  };
  // 걸린 조건 [주소 키, 이름](숨은 칸 제외)- deal-results.js 의 칩.
  self.conds = () => {
    const c = [];
    const add = (k, yes, name) => yes && c.push([k, name(yes)]);
    const b = (B, k) => k !== ALL && bucketOf(B, k);
    add("district", district !== ALL && district, String);
    add("budget", !isRent() && bandOf(band10k), bandLabel);
    add("max", !isRent() && self.maxTo > 0, self.maxLabel);
    add("deposit", isRent() && b(DEPOSIT_BUCKETS, depositKey), t("depositOption"));
    add("rent", kind === "wolse" && b(RENT_BUCKETS, rentKey), t("rentOption"));
    add("area", b(AREA_BUCKETS, areaKey), t("areaOption"));
    add("age", b(AGE_BUCKETS, ageKey), t("ageOption"));
    add("apt", aptTerm(), t("aptScope"));
    add("dong", dongTerm(), String);
    add("direct", !isRent() && excludeDirect, () => t("directScope"));
    return c;
  };
  // 정렬: 가격순은 자치구를 골랐을 때만(서울 전체 목록은 표본). 30건 자르기 전에 정렬한다.
  let sort = ["low", "high"].includes(params.get("sort")) ? params.get("sort") : "";
  self.sortOk = () => district !== ALL && !groupView;
  self.sortOn = (v) => ((sort = v ?? sort), self.sortOk() ? sort : "");
  self.sorts = () => [["", ko() ? "최근 거래순" : "Most recent"], ["low", ko() ? "가격 낮은 순" : "Lowest price"], ["high", ko() ? "가격 높은 순" : "Highest price"]];
  self.sortDeals = (rows) => {
    const s = { low: 1, high: -1 }[self.sortOn()];
    const p = (d) => d.amount10k ?? d.deposit10k * 1e4 + d.monthlyRent10k;
    if (s) rows.sort((a, b) => s * (p(a) - p(b)));
  };
  for (const lang of ["ko", "en"]) {
    const shown = T[lang].shown;
    T[lang].shown = (n) => (self.sortOn() ? `${self.sorts().find(([k]) => k === sort)[1]} · ${n}` : shown(n));
  }
  const su = syncUrl;
  syncUrl = () => {
    su();
    const q = new URLSearchParams(location.search);
    self.sortOn() ? q.set("sort", sort) : q.delete("sort");
    const u = location.pathname + (String(q) && `?${q}`);
    if (u !== location.pathname + location.search) history.replaceState(null, "", u);
  };

  // 상세 조건이 걸린 주소면 펼친 채 시작.
  const box = document.getElementById("more-filters");
  if (box) box.open = detailActive() || groupView;
  syncUrl();
  // 데이터가 먼저 왔으면 선택지만 다시. 결과는 max 일 때만 다시 받는다.
  if (cache.search) renderControls(), self.maxTo && refresh();
})();
