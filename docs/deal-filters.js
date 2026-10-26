// 실거래 검색 조건 보조(#745 PR2: 상세 조건 접기·예산 이하 max. 남는 gzip 여유는 PR3 결과 칩·정렬 몫). 시험: test/deal-search.test.mjs
(() => {
  const M = [3, 5, 8, 10, 15, 20];
  const ko = () => locale !== "en";
  const set = (n) => (self.maxTo = n > 0 ? n * EOK : NaN);
  set(+params.get("max")); // 인라인이 처음 읽은 주소(이 파일보다 먼저 syncUrl 이 돌았을 수 있다)
  if (self.maxTo && !M.includes(self.maxTo / EOK)) M.push(self.maxTo / EOK);
  const label = (n) => (ko() ? `${n}억 이하` : `≤ ₩${n * 100}M`);
  self.maxLabel = () => label(self.maxTo / EOK);
  self.maxOpts = () => M.map((n) => optionHtml(`m${n}`, label(n), self.maxTo === n * EOK)).join("");
  // 예산 select 의 "m8" 같은 값이면 max 로 받고 참을 돌려준다(구간 budget 은 인라인이 비운다).
  self.maxPick = (raw) => set(raw[0] === "m" ? +raw.slice(1) : 0);
  // 「조건 지우기」가 max 도 지우고, max 만 걸려도 그 단추가 보이게 인라인 함수를 감싼다.
  const clear = clearFilters;
  const any = anyFilterOn;
  clearFilters = () => (clear(), set(0));
  anyFilterOn = () => any() || !!self.maxTo;
  self.moreCount = () => {
    const n = [areaKey !== ALL, ageKey !== ALL, aptTerm(), excludeDirect, groupView].filter(Boolean).length;
    setText("more-label", (ko() ? "상세 조건 더 보기" : "More filters") + (n ? (ko() ? ` (${n}개 적용)` : ` (${n})`) : ""));
  };
  // 상세 조건이 걸린 주소로 들어오면 펼친 채 시작한다. 접어도 값과 주소는 그대로다.
  const box = document.getElementById("more-filters");
  if (box) box.open = detailActive() || groupView;
  syncUrl();
  // 데이터가 이 파일보다 먼저 왔으면 선택지만 다시 그린다. 결과는 max 가 걸렸을 때만 다시 받는다(재시도 연타 1회 규칙).
  if (cache.search) renderControls(), self.maxTo && refresh();
})();
