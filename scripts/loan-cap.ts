/**
 * 주택가격 구간별 주택담보대출 상한 - 소득과 무관한 천장.
 *
 * 이 사이트는 "얼마를 빌릴 수 있나"를 계산하지 않는다(DIRECTION 2부). LTV·DSR은 소득과 해마다
 * 바뀌는 규제에 따라 갈려, 하나로 적으면 조용히 틀린 화면이 된다. 다만 2025-10-16부터 서울
 * 25개 구 전부가 규제지역이라, 시가 구간별 상한은 서울 안에서 누구에게나 같은 천장이다.
 * 그 천장만 기준일·출처와 함께 적는다. 실제 한도는 LTV·DSR로 이보다 낮을 수 있다고 같이 적는다.
 *
 * 기준일이 6개월을 넘으면 자동 점검 봇이 원문을 다시 대조하라는 이슈를 올린다(audit/HOWTO.md).
 */

export const BASIS_DATE = "2026-10-01";

export const SOURCES = [
  { name: "주택시장 안정화 대책(10·15 대책)", date: "2025-10-15", url: "https://www.korea.kr/briefing/policyBriefingView.do?newsId=156722073" },
  { name: "'26년도 가계부채 관리방안(같은 구간을 온라인투자연계금융까지 넓힘)", date: "2026-04-01", url: "https://www.fsc.go.kr/no010101/86606" },
];

/** 시가 이하 → 상한(만원). 15억 "이하"는 6억이다 - 경계값은 아래 구간에 든다. */
export const CAPS = [
  { upTo: 150_000, cap: 60_000 },
  { upTo: 250_000, cap: 40_000 },
  { upTo: Infinity, cap: 20_000 },
];

export const capFor = (price10k) => CAPS.find((c) => price10k <= c.upTo).cap;

export const POLICY_DATE = "2025-10-16";

/**
 * 경계 바로 아래(2천만원 안, 경계 포함) 거래 수 ÷ 바로 위 2천만원. 억 단위 경계에는 어림수로 몰리는
 * 몫이 늘 있으므로, 15억 경계의 비를 이웃 경계(14억·16억)의 비와 견준다 - 남는 몫이 상한 탓이다.
 */
export function boundaryRatio(amounts, b) {
  const lo = amounts.filter((a) => a > b - 2000 && a <= b).length;
  const hi = amounts.filter((a) => a > b && a <= b + 2000).length;
  return hi ? { lo, hi, ratio: lo / hi } : null;
}

/** 대책 뒤 거래만으로 15억 경계의 몰림이 이웃의 몇 배인가. 표본이 모자라면 null. */
export function clustering(deals, { boundary = 150_000, since = POLICY_DATE, minEach = 100 } = {}) {
  const amounts = deals.filter((d) => d.date >= since).map((d) => d.amount);
  const at = boundaryRatio(amounts, boundary);
  const below = boundaryRatio(amounts, boundary - 10_000);
  const above = boundaryRatio(amounts, boundary + 10_000);
  if (![at, below, above].every((r) => r && r.lo + r.hi >= minEach)) return null;
  const neighbour = (below.ratio + above.ratio) / 2;
  return {
    since,
    deals: amounts.length,
    ratio: Math.round(at.ratio * 100) / 100,
    neighbour: Math.round(neighbour * 100) / 100,
    times: Math.round((at.ratio / neighbour) * 10) / 10,
  };
}

const eok = (v) => `${v / 10_000}억`;

/**
 * 16~20억대 다섯 장에 똑같이 실리던 구간표·규제지역 단서(#66) - method.html 한 자리로 옮겼다. 글자는 그대로다.
 * 장의 문장은 "이 예산대 집의 주택담보대출 상한은 N억입니다"와 DSR 단서 한 줄만 남는다(상한 숫자는 장마다 다르다).
 * 구간표의 가운데 칸(15억 초과 25억 이하 4억)은 capFor와 14억대 문장에 있는 값이다. 지시어만 "장에 적은"으로 고쳤다.
 */
export const CAP_RULES_HIGH =
  `(시가 15억 초과 25억 이하는 4억 — 15억 이하는 6억, 25억을 넘으면 2억). ` +
  `서울 전역이 규제지역이라 누구에게나 같은 천장이고, 실제로 빌릴 수 있는 돈은 소득(DSR)에 따라 장에 적은 상한보다 적을 수 있습니다. (금융위원회 원문 기준, ${BASIS_DATE} 확인)`;

/** 15억 경계에 걸친 예산대(14억대·15억대) 한 줄. 다른 예산대에는 쓰지 않는다. */
export function capSentence(bandEok, stats) {
  if (bandEok >= 16 && bandEok <= 24) {
    return `이 예산대 집의 주택담보대출 상한은 ${eok(capFor((bandEok + 0.5) * 10_000))}입니다. 소득(DSR)에 따라 이보다 적을 수 있습니다.`;
  }
  if (bandEok !== 14 && bandEok !== 15) return null;
  const head =
    bandEok === 14
      ? `이 예산대 바로 위 15억을 넘기면 주택담보대출 상한이 ${eok(capFor(150_000))}에서 ${eok(capFor(150_001))}으로 내려갑니다(시가 15억 이하 6억, 25억 이하 4억, 그 위 2억 — 서울 전역이 규제지역이라 누구에게나 같은 천장).`
      : `15억을 넘긴 집은 주택담보대출 상한이 ${eok(capFor(150_001))}입니다. 15억 이하이면 ${eok(capFor(150_000))}입니다(25억을 넘으면 2억 — 서울 전역이 규제지역이라 누구에게나 같은 천장).`;
  const cluster = stats
    ? ` 대책 뒤(${stats.since}~) 거래를 세면 15억 바로 아래에 몰린 정도가 이웃 경계(14억·16억)의 ${stats.times}배입니다 — 억 단위 어림수에 몰리는 몫을 빼고도 남는 몫입니다.`
    : "";
  return (
    head +
    cluster +
    ` 실제로 빌릴 수 있는 돈은 LTV와 소득(DSR)에 따라 이보다 적을 수 있습니다. (금융위원회 원문 기준, ${BASIS_DATE} 확인)`
  );
}
