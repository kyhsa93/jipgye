// 「다른 집으로 옮기면」 절의 칸 옆 안내와 근거 — 잘못된 값 안내(#792)·금리 줄·참고값 단추·근거 줄(#777 P3)과 근거 상자 계측(P4). 이 장의 다섯째 장 전용 JS(group-cto 조건부 승인, #777) - renewal-move.js 가
// 그릴 때마다 같은 문맥(문구 M·숫자 표기·고른 종류·금리 자료·상태)으로 부른다. 위 확인기가 고른 칸(window.renewalCheck)을 이어받는다.
// 참고값은 누를 때만 칸에 넣고, 단지 기준(같은 단지·같은 평형 신규 전세 중간값)과 자치구 참고(conversion.json 칸)를 섞지 않는다.
(() => {
  const $ = (id) => document.getElementById(id);
  const LAG = 4; // = scripts/check-data-progress.ts MONTHLY_LAG.jeonse_loan_rate + 1 (시험이 대조): 이보다 오래된 금리는 알린다
  const mon = (y, m) => y * 12 + +m;
  let x; // 마지막으로 그린 문맥
  window.renewalMoveBasis = (ctx) => {
    x = ctx;
    const { M, f, fmt, ym, v, kind, c, st, opp, r, d } = ctx;
    // 잘못된 값은 그 칸 묶음 바로 아래에(#792). 빈칸은 오류가 아니다 - 답 자리가 남은 칸을 적는다.
    const G = { renew: "ask", deposit: "dep", rent: "dep", cash: "cash", loanRate: "loan", months: "loan", depositRate: "opp", oneRenew: "once", oneMove: "once" };
    for (const g of ["ask", "dep", "cash", "loan", "once", "opp"]) $("mv-err-" + g).textContent = (d?.err || []).filter(([k]) => G[k] == g).map((e) => e[1]).join(" ");
    // 금리의 출처는 칸 값으로 정한다 - 평균금리와 같으면 참고값, 아니면 직접 넣은 값(고쳤다가 평균값으로 되돌려도 맞게, #792).
    // 입력 쪽 금리 줄과 결과 아래 근거 줄이 같은 판단을 쓴다. 기회비용을 끄면 예금 금리는 계산에 쓰지 않는다고 적는다.
    const lr = v("mv-rate");
    const dr = v("mv-drate");
    // 계산은 금리를 bp(0.01%p)로 반올림해 쓴다(move-cost.js) - 출처 판정과 근거 줄도 그 값으로(4.234 를 넣으면 4.23 으로 계산·표시).
    const bp = (x) => Math.round(x * 100) / 100;
    const refL = c && lr !== "" && bp(lr) == c.loan.rate;
    const refD = c && dr !== "" && bp(dr) == c.deposit.rate;
    let note = st.err ? M[44] : "";
    if (c) {
      note = (refL ? f(39, ym(c.loan.month)) : M[40]) + (opp ? (refD ? f(41, ym(c.deposit.month)) : M[42]) : M[88]);
      const at = new Date(Date.parse(c.updatedAt) + 324e5).toISOString();
      const seen = [c.loan.month, c.deposit.month].sort()[0];
      if (mon(at.slice(0, 4), at.slice(5, 7)) - mon(seen.slice(0, 4), seen.slice(4)) > LAG) note += f(43, ym(seen));
    }
    $("mv-rate-note").textContent = note;
    // 확인기가 넘기는 것: 자치구 이름·단지·칸 이름·그 칸 줄·칸 파일(f: 받는 중 undefined, 없음 null, 받기 실패 0)·다시 받기. 금액은 없다.
    const rc = window.renewalCheck || {};
    const { row, f: file } = rc;
    rc.band = String(rc.area ?? "").startsWith("b:") ? rc.area.slice(2) : "";
    rc.window = file?.window;
    rc.min = file?.min;
    rc.file = file === 0 ? "failed" : "";
    // 칸 파일을 못 받았으면 확인기 답 자리(#check-answer)에 그 사실과 다시 시도를 둔다 - 확인기(장 인라인)는 받는 중과 실패를 같은 안내로
    // 보이고, 이 실패 표시만 이 파일이 맡는다(경계: 확인기의 다른 상태 표시는 인라인 그대로, #777 P3 engineer).
    if (file === 0) {
      $("check-answer").innerHTML = `${M[68]} <button type="button" id="check-retry">${M[69]}</button>`;
      $("check-retry").onclick = rc.retry;
    }
    const bk = rc.band || (+rc.area > 0 ? (+rc.area < 60 ? "under60" : +rc.area < 85 ? "60to85" : "over85") : "");
    const bn = M[64 + ["under60", "60to85", "over85"].indexOf(bk)];
    const cd = c?.cells?.find((e) => e.district == rc.gu && e.band == bk);
    const med = !rc.band && row?.length > 11 ? row[11] : null;
    // 참고값을 넣은 뒤 칸(자치구·단지·면적)이나 종류가 바뀌면 그 금액은 더는 지금 칸의 참고값이 아니다 - 직접 넣은 값으로 돌린다(po·legal #777 P3).
    const key = [rc.gu, rc.apt, rc.area, kind].join("|");
    if (st.src && st.key != key) st.src = "";
    x.key = key;
    st.ref = { med, cd };
    $("mv-ref-a").hidden = !(med && kind == "jeonse");
    $("mv-ref-a").textContent = med ? f(47, fmt(med), fmt(row[10])) : "";
    $("mv-ref-b").hidden = !cd;
    $("mv-ref-b").textContent = cd ? (kind == "wolse" ? f(50, rc.gu, bn, fmt(cd.deposit10k), fmt(cd.monthly10k), fmt(cd.pairs)) : f(49, rc.gu, bn, fmt(cd.jeonse10k), fmt(cd.pairs))) : "";
    const sum = (a) => a.reduce((p, q) => p + q, 0);
    const lo = row ? Math.min(sum(row.slice(0, 5)), sum(row.slice(5, 10))) : 0;
    // 계측(#777 P4): 고른 칸의 한 줄이 표본 부족(min.show 미만)이면 칸마다 한 번 - 칸 이름은 메모리에만.
    const k = rc.gu + rc.apt + rc.area;
    if (row && lo < rc.min?.show && !(st.low ||= {})[k]) (st.low[k] = 1), window.analytics?.event?.("calculator_unavailable", { calculator_type: "renewal_vs_new", unavailable_reason: "low_sample" });
    // 「단지 값이 없습니다」는 넘겨받은 단지가 목록에 없어 면적대로 내린 때만 - 자료 있는 단지에서 손으로 면적대를 고른 때는 아니다(legal).
    $("mv-ref-note").textContent = [rc.file == "failed" ? M[56] : rc.band && rc.gu && !file?.cells?.[rc.apt] ? f(51, rc.gu, bn) : "", !rc.band && row?.length > 11 && med === null ? f(48, fmt(row[10])) : "", v("mv-dep") ? (st.src ? f(53, M[st.src == "c" ? 54 : 55]) : M[52]) : ""].filter(Boolean).join(" ");
    // 결과 옆 근거 줄: 기준(단지/자치구/없음)·기간·건수·표본 부족·금리 관측월, 그리고 비교할 집 금액이 참고값이면 그 출처(자치구 값을 같은 단지처럼 보이지 않게).
    $("mv-basis-line").textContent = (!row ? (rc.file == "failed" ? M[56] : M[59]) : rc.band ? f(58, rc.gu, bn) : f(57, rc.gu, rc.apt, rc.area)) +
      (row && rc.window ? " " + f(60, ym(rc.window[0]), ym(rc.window[1]), fmt(sum(row.slice(0, 10)))) + (row.length > 11 ? f(61, fmt(row[10])) : "") + (lo < rc.min?.ratio ? f(62, fmt(lo)) : "") : "") +
      (v("mv-dep") && st.src == "d" && cd ? f(70, rc.gu, bn, fmt(cd.pairs)) : v("mv-dep") && st.src == "c" && med ? f(71, fmt(row[10])) : "") +
      // 계산에 쓴 금리와 그 출처(결과가 있을 때만). 직접 넣은 금리가 있으면 한국은행 평균은 따로 「참고」로 적는다.
      (r?.ok ? f(82, bp(lr), refL ? f(85, ym(c.loan.month)) : M[86]) + (opp ? f(83, bp(dr), refD ? f(85, ym(c.deposit.month)) : M[86]) : M[84]) +
        (c && (!refL || (opp && !refD)) ? f(87, c.loan.rate, ym(c.loan.month), c.deposit.rate, ym(c.deposit.month)) : "") : "") + M[67];
  };
  const pick = (src) => ((x.st.src = src), (x.st.key = x.key), x.start(), x.render());
  $("mv-ref-a").addEventListener("click", () => (($("mv-dep").value = x.st.ref.med), pick("c")));
  $("mv-ref-b").addEventListener("click", () => {
    const { cd } = x.st.ref;
    const w = x.v("mv-kind") == "wolse";
    $("mv-dep").value = w ? cd.deposit10k : cd.jeonse10k;
    if (w) $("mv-rent").value = cd.monthly10k;
    pick("d");
  });
  // 계측(#777 P4): 근거 상자를 처음 펼칠 때 한 번. 정해진 낱말만 보낸다.
  $("mv-basis").addEventListener("toggle", () => $("mv-basis").open && !x?.st.e && ((x.st.e = 1), window.analytics?.event?.("evidence_open", { calculator_type: "renewal_move" })));
  window.renewalMove?.();
})();
