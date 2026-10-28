// 재계약 vs 이사 비용 계산(#777). 화면(renewal-move.js)과 시험이 이 한 벌을 같이 부른다. 금액은 만원, 금리는 연 %. 문장·표 줄은 move-text.js(#792, group-ceo 판정 A).
// 월 항목은 천 원 정수로 반올림하고 기간 값은 월 값 × 개월 - 「월 × 기간 = 합」이 맞게. 돌려받는 보증금·대출 원금은 비용이 아니다.
(() => {
  const LTV = 0.8; // = scripts/conversion.ts LOAN_LTV
  const TAX = 0.154; // = scripts/interest.ts TAX_RATE
  const n = (v) => (v === "" || v == null ? NaN : Number(v));

  function check(x) {
    const errors = [];
    // 빈칸은 「아직 안 넣음」(required), 숫자가 아니거나 범위 밖이면 잘못된 값(range) - 둘을 다르게 알리고 다르게 센다(#792).
    const need = (field, raw, ok, v = n(raw)) => Number.isFinite(v) ? ok(v) || errors.push({ field, code: "range" }) : errors.push({ field, code: raw == null || raw === "" ? "required" : "range" });
    const rate = (v) => v >= 0 && v <= 20;
    const wolse = x.kind == "wolse";
    need("renew", x.renew, (v) => v > 0);
    need("deposit", x.deposit, (v) => (wolse ? v >= 0 : v > 0));
    if (wolse) need("rent", x.rent, (v) => v > 0);
    need("cash", x.cash, (v) => v >= 0);
    // 선택지별 금리(#792 5): 켜면 재계약·이사 금리를 따로 보고, 공통 금리는 묻지 않는다.
    if (x.split) need("renewRate", x.renewRate, rate), need("moveRate", x.moveRate, rate);
    else need("loanRate", x.loanRate, rate);
    if (x.opportunity) need("depositRate", x.depositRate, rate);
    need("months", x.months, (v) => Number.isInteger(v) && v >= 1 && v <= 120);
    // 일회성 비용(P5: 이사비·중개보수 등, 사용자가 넣는 값). 비우면 0, 넣으면 0 이상.
    for (const field of ["oneRenew", "oneMove"]) if (x[field] !== "" && x[field] != null && !(n(x[field]) >= 0)) errors.push({ field, code: "range" });
    return errors;
  }

  // 선택지 하나. 대출은 전세 vs 월세(monthlyCost)와 같이 보증금의 80%에서 자르고, 그래도 모자라면 short 로 알린다.
  // 기회비용 = 보증금에 묶인 내 돈의 세후 예금이자. 내 돈 전체가 두 선택지에서 같아 monthlyCost(남는 돈 이자 차감)와 차이가 같다.
  function side(deposit, rent, x, once) {
    const own = Math.min(x.cash, deposit);
    const short = Math.max(0, Math.round(deposit - own - deposit * LTV));
    const loan = deposit - own - short;
    // 금리를 bp 정수로 바꿔 분자를 정수로 둔다 - 4.23% 같은 값의 부동소수 잡음이 0.5 경계를 넘기지 않게.
    const interestK = Math.round((loan * x.loanBp) / 12000);
    const rentK = Math.round(rent * 10);
    const oppK = x.opportunity ? Math.round((own * x.depositBp * Math.round((1 - TAX) * 1000)) / 12e6) : 0;
    const cashK = interestK + rentK;
    const oneK = Math.round((n(once) || 0) * 10);
    // 일회성 비용은 내 돈(C) 밖에서 낸다고 본다 - C 에서 빼면 대출과 기회비용이 같이 움직인다(data-analyst #777).
    return { deposit, own, loan, short, feasible: !short, interestK, rentK, cashK, oppK, oneK, monthK: cashK + oppK, totalK: (cashK + oppK) * x.months + oneK, cashTotalK: cashK * x.months, cashAllK: cashK * x.months + oneK };
  }

  function compare(input) {
    const errors = check(input);
    if (errors.length) return { ok: false, errors };
    const bp = (v) => Math.round((n(v) || 0) * 100);
    const x = { cash: Math.round(n(input.cash)), depositBp: bp(input.depositRate), months: n(input.months), opportunity: !!input.opportunity };
    const lb = (k) => ({ ...x, loanBp: bp(input.split ? input[k] : input.loanRate) }); // 선택지마다 쓸 대출 금리
    const renew = side(Math.round(n(input.renew)), 0, lb("renewRate"), input.oneRenew);
    const move = side(Math.round(n(input.deposit)), input.kind == "wolse" ? n(input.rent) : 0, lb("moveRate"), input.oneMove);
    const ok = renew.feasible && move.feasible;
    const gap = (k) => (ok ? move[k] - renew[k] : null);
    const who = (g) => (!g ? null : g > 0 ? "renew" : "move");
    return { ok: true, kind: input.kind, comparable: ok, months: x.months, opportunity: x.opportunity, renew, move, gapK: gap("totalK"), cashGapK: gap("cashAllK"), cheaper: who(gap("totalK")), cashCheaper: who(gap("cashAllK")) };
  }

  globalThis.jipgyeMoveCost = { compare, LTV, TAX };
})();
