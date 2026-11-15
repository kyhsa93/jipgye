// 근거표 폼·건수(#871 PR-B). 장 전용 외부 JS(#681 경로, 배포 사본 gzip ≤2KB) - buy-by-budget.html 이 budget-rows.js 다음에 defer 로 읽는다.
// 책임은 「화면 배선」이다(cto 착수 판정 3): 값대·면적대·생애최초 폼, 건수 파일(data/reco-counts.json, 렌더 단계가 만든다)로 그리는 머리·면적대 표·구별 건수,
// 「줄 보기」를 누른 구의 reco 파일 하나 받기. 머리와 구 건수는 파일의 숫자를 읽기만 하고 다시 세지 않는다(cto 조건 E) - 파일은 구운 기본 보기와 같은
// 순수 함수(scripts/budget-table.ts recoCounts)가 만든다.
// 주소: 고른 값은 이 브라우저 안에서만 쓴다. location·history 에 쓰지 않고(완료 조건 5), 18장에서 오는 #bN 은 처음 한 번만 읽는다(N=3~20, 그 밖은 기본값).
// 해시는 analytics.js scrub 이 page_location 에서 지운다. 분석 이벤트는 새로 두지 않는다(po 명세 ②).
// 실패: 건수 파일이 없으면 구운 기본 보기를 그대로 두고 그 아래 실패 문구, 구 파일이 없으면 그 구 자리에 실패 문구와 실거래 검색 링크(po 명세 ①).
(() => {
  const $ = (id) => document.getElementById(id);
  const L = $("bt-live");
  const S = $("bt-band");
  const AK = ["all", "under-60", "60-85", "over-85"];
  const got = {};
  let C;
  let err;
  let open = -1;
  const h = /^#b([3-9]|1\d|20)$/.exec(location.hash);
  if (h) S.value = h[1];

  function draw() {
    const E = document.documentElement.getAttribute("lang") == "en";
    const M = L.getAttribute(E ? "data-msg-en" : "data-msg").split("|");
    const t = (i, ...x) => M[i].replace(/\{(\d)\}/g, (_, k) => x[k]);
    const n = (x) => x.toLocaleString("ko-KR");
    const A = M[14].split(",");
    const b = +S.value;
    const a = $("bt-area").value;
    const bl = t(15, b, b / 10);
    for (const o of S.options) o.textContent = t(16, o.value, o.value / 10, +o.value + 1, (+o.value + 1) / 10);
    [...$("bt-area").options].forEach((o, i) => (o.textContent = A[i]));
    $("bt-nojs").hidden = true;
    if (!C) {
      if (err) L.innerHTML = `<p class="content-notice">${M[10]}</p>`;
      return;
    }
    $("bt-baked").hidden = true;
    const al = A[AK.indexOf(a)];
    const [m, k, rx, ds] = C.b[b][a];
    const tb = (cap, th, tr) => `<div class="table-scroll"><table class="rate-table"><caption>${cap}</caption><thead><tr>${th.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${tr.join("")}</tbody></table></div>`;
    $("bt-head").textContent = t(0, bl, al, n(m + k), n(m), n(k), C.windowDays, C.minDeals, C.start, C.end, C.month[+E]);
    $("bt-range").textContent = t(13, n(C.out));
    let o = rx != null ? `<p class="content-notice">${t(1, n(rx))}</p>` : "";
    // 값대×면적대 표는 뺀 곳이 있을 때만(N6).
    if (k) o += tb(t(3, bl), [M[8], M[6], M[7]], AK.slice(1).map((x, i) => `<tr><th>${A[i + 1]}</th><td>${n(C.b[b][x][0])}</td><td>${n(C.b[b][x][1])}</td></tr>`));
    o += `<p>${t(2, C.windowDays, C.minDeals)}</p>`;
    // 자치구는 거르는 조건이 아니라 건수로 묶는 축이다. 값 낸 곳이 0인 구는 열 줄이 없다.
    o += tb(t(4, bl), [M[5], M[6], M[7]], C.d.map(([nm, , ne, dt], i) => `<tr><th>${E ? ne : nm}${dt != C.end ? ` <small>~${dt}</small>` : ""}${ds[2 * i] ? ` <button type="button" data-d="${i}">${M[9]}</button>` : ""}</th><td>${n(ds[2 * i])}</td><td>${n(ds[2 * i + 1])}</td></tr>`));
    L.innerHTML = o + `<p class="content-notice">${M[12]}</p>`;
    const R = $("bt-rows");
    if (open < 0 || !ds[2 * open]) return (R.innerHTML = "");
    const [nm, sl, ne] = C.d[open];
    if (got[sl] === undefined) return;
    let x = null;
    try {
      x = btRows(got[sl], b, a, $("bt-first").checked, E, t(17, bl, E ? ne : nm, al));
    } catch {}
    R.innerHTML = x ?? `<p class="content-notice"><a href="./deal-search.html?district=${encodeURIComponent(nm)}">${M[11]}</a></p>`;
  }

  L.addEventListener("click", (ev) => {
    const i = ev.target.getAttribute?.("data-d");
    if (i == null) return;
    open = +i;
    const sl = C.d[open][1];
    if (!(sl in got)) {
      got[sl] = undefined;
      fetch(`./data/reco-${sl}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => {
          got[sl] = j;
          draw();
        });
    }
    draw();
  });
  fetch("./data/reco-counts.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      C = j?.v == 1 && j.b ? j : null;
      err = !C;
      draw();
    });
  for (const id of ["bt-band", "bt-area", "bt-first"]) $(id).addEventListener("change", draw);
  for (const id of ["bt-go", "lang-toggle"]) $(id).addEventListener("click", draw);
  draw();
})();
