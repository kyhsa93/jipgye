// 표 조각 여섯(전환율·해제·미등기·재계약 둘·층 격차)의 행 모양과 글자 규칙. 순수 모듈 - render/entry.jsx(JSX)가 이 함수를 쓴다(#242 PR 1).
// 여기서 `prerender.ts`·`renderer.mjs`를 불러오면 안 된다(로더가 막는다).
//
// 이 모듈은 마크업(HTML)을 만들지 않는다. 어떤 행을 어느 순서로 그리는지, 칸이 값인지 "표본 부족"인지, 칸에 들어가는 글자가 무엇인지만 정한다.
// 마크업(`<tr>`·`<td>`·`<span class="low-sample">`)은 쓰는 쪽(JSX 요소)이 입힌다 - 분기가 한 곳에만 있다(#255 `realestate-rows.mjs`와 같은 방식).
// 그러므로 두 구현이 같은 분기 함수를 쓰는 만큼 parity 시험만으로는 이 모듈의 분기 오류가 안 보인다 - 모든 분기에 손으로 적은 기대값을 둔다(test/fixtures/render/district-tables-branches.mjs).
//
// 칸 글자는 두 가지로 나뉜다. 예전 문자열 렌더가 `escapeHtml`을 거쳐 내던 칸과, 이스케이프 없이 문자열에 그대로 끼우던 칸(raw)이다. 어느 칸이 어느 쪽인지는 아래 함수마다 주석에 적었다.
// JSX는 두 종류 모두 글자를 요소의 텍스트로 낸다 - React가 `& < > "`를 이스케이프하므로 raw 칸에 이 글자가 든 문자열이 오면 예전 문자열 렌더와 달라진다
// (알려진 차이, test/fixtures/render/district-tables-branches.mjs의 RAW_TEXT_DIFF. 실제 입력에는 없다: 빌더가 숫자로만 만든다).

export const CONVERSION_BAND = "60to85";

/** 값이 없으면(null·undefined) "-", 아니면 `값%`. 0·""·false·NaN은 값이다. */
export const pct = (value) => (value === null || value === undefined ? "-" : `${value}%`);

/** `pct`에 양수일 때 `+`를 붙인 것(월세 재계약의 격차). */
export const signed = (value) => (value === null || value === undefined ? "-" : `${value > 0 ? "+" : ""}${value}%`);

/** 숫자 칸. `Number.prototype.toLocaleString`이라 null·undefined면 던진다(예전 문자열 렌더와 같다). 문자열·객체는 자기 글자를 그대로 낸다. */
export const count = (value) => value.toLocaleString("ko-KR");

const eok = (value10k) => `${(Math.round((value10k / 10000) * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억`;
const man = (value10k) => `${Math.round(value10k).toLocaleString("ko-KR")}만원`;

/**
 * 전세·월세 전환율 표. 고른 면적대(`band`)의 칸만, 전환율이 높은 순서로(같으면 들어온 순서). 칸이 없으면 null.
 * 이스케이프하던 칸: caption·district·jeonse·rent / raw: rate(`4.97%`)·pairs.
 */
export function conversionTable(conversion, band = CONVERSION_BAND) {
  const rows = (conversion?.cells ?? []).filter((cell) => cell.band === band);
  if (!rows.length) return null;

  const label = conversion.bands?.find((b) => b.key === band)?.label ?? band;
  return {
    caption: `${label} 기준`,
    rows: [...rows]
      .sort((a, b) => b.rate - a.rate)
      .map((cell) => ({
        district: cell.district,
        rate: `${cell.rate}%`,
        jeonse: eok(cell.jeonse10k),
        rent: `${eok(cell.deposit10k)} / ${man(cell.monthly10k)}`,
        pairs: count(cell.pairs),
      })),
  };
}

/**
 * 해제·미등기 자치구 표. 이스케이프하던 칸: district·cancelledShare·staleShare / raw: deals·cancelled·stale.
 */
export function cancelDistricts(cancellation) {
  const rows = cancellation?.districts ?? [];
  if (!rows.length) return null;

  return rows.map((row) => ({
    district: row.district,
    deals: count(row.deals),
    cancelled: count(row.cancelled),
    cancelledShare: pct(row.cancelledShare),
    stale: count(row.stale),
    staleShare: pct(row.staleShare),
  }));
}

/**
 * 계약월별 등기 완료 표. `spot`은 등기가 충분히 지난 달(`matureMonths`)이라 줄을 강조한다.
 * 이스케이프하던 칸: month / raw: filed·registered·share(`99.6%`).
 */
export function cancelMonths(cancellation) {
  const rows = cancellation?.registrationByMonth ?? [];
  if (!rows.length) return null;

  const mature = new Set(cancellation?.seoul?.registration?.matureMonths ?? []);
  return rows.map((row) => ({
    month: row.month,
    spot: mature.has(row.month),
    filed: count(row.filed),
    registered: count(row.registered),
    share: `${row.share}%`,
  }));
}

/**
 * 재계약(전세 갱신) 자치구 표. 문턱은 빌더가 이미 적용했다 - 문턱을 못 넘은 칸은 `gapMedian`이 null이고, 여기서는 비우지 않고 "표본 부족"으로 적는다.
 * 이 함수는 건수 문턱을 다시 적용하지 않는다(`gapMatched`가 작아도 값이 있으면 값을 낸다). **null만** 표본 부족이고 undefined는 값 없음("-")이다 - 표본 부족이 먼저 판정된다.
 * 이스케이프하던 칸: district·gap(값일 때)·cheaper·capMiss / raw: matched·rightUsed. `gap`은 `{ low: true }`(표본 부족) 또는 `{ text }`.
 */
export function renewalDistricts(renewal) {
  const rows = renewal?.table ?? [];
  if (!rows.length) return null;

  return rows.map((row) => ({
    district: row.district,
    gap: row.gapMedian === null ? { low: true } : { text: pct(row.gapMedian) },
    cheaper: pct(row.gapCheaperShare),
    matched: count(row.gapMatched),
    capMiss: pct(row.capMissShare),
    rightUsed: count(row.rightUsed),
  }));
}

/**
 * 월세 재계약 표. 표와 서울 월세 요약(`seoul.wolse`)이 둘 다 있어야 한다(없으면 null). 머리글 둘은 서울 요약의 전환율과 범위 양끝이다.
 * 표본 부족 규칙은 위와 같다(`median`이 null이면 표본 부족, undefined면 "-"). 이스케이프하던 칸: 머리글 둘·district·gap(값일 때)·range·cheaper / raw: matched.
 * `cheaper`는 pct()가 아니라 null만 "-"다(undefined는 "undefined%").
 */
export function renewalWolseDistricts(renewal) {
  const rows = renewal?.wolseTable ?? [];
  const wolse = renewal?.seoul?.wolse;
  if (!rows.length || !wolse) return null;

  const ends = wolse.range.map((r) => r.rate);
  return {
    rateHeading: `갱신 − 신규 (${wolse.rate}%)`,
    endsHeading: `${ends[0]}% / ${ends.at(-1)}%로 보면`,
    rows: rows.map((row) => ({
      district: row.district,
      gap: row.median === null ? { low: true } : { text: signed(row.median) },
      range: row.range.length ? row.range.map((r) => signed(r.median)).join(" / ") : "-",
      cheaper: row.cheaperShare === null ? "-" : `${row.cheaperShare}%`,
      matched: count(row.matched),
    })),
  };
}

/**
 * 층 격차 자치구 표. 갈라 볼 수 없는 구도 빼지 않는다. 서울과 다른지(`distinct`)가 참이면 "다르다"(`lowText`가 null),
 * 아니면 표본 부족 칸이고 이유 글자가 `lowText`다 - 가른 범위(`band`)가 있는데 서울과 안 갈리면 "갈라 볼 수 없음", 범위조차 못 냈으면 "칸이 모자람".
 * 표본 부족(`distinct` 거짓)은 중앙값이 비었는지와 따로 정해진다: 중앙값 칸("-")과 판정 칸은 서로 영향을 주지 않는다.
 * 이스케이프하던 칸: district / raw: median(`-9.1%`, 값이 null이면 "-")·cells.
 * 전세 칸(#705): 중앙값 옆에 칸 수와 구간을 늘 같이 적는다(`-4.2% (n=30, -9~0%)`). 문턱 미달은 `jeonseLow`
 * 「표본 부족(n=…)」, 전세 값이 아예 없으면(빌더 soft-fail) "-".
 */
export function floorDistricts(floor) {
  const rows = floor?.districts ?? [];
  if (!rows.length) return null;

  return rows.map((row) => {
    const j = row.jeonse;
    return {
      district: row.district,
      median: row.median === null ? "-" : `${row.median}%`,
      cells: count(row.cells),
      lowText: row.distinct ? null : row.band ? "갈라 볼 수 없음" : "칸이 모자람",
      jeonse: !j ? "-" : j.band ? `${j.median}% (n=${count(j.cells)}, ${j.band.low}~${j.band.high}%)` : null,
      jeonseLow: j && !j.band ? `표본 부족(n=${count(j.cells)})` : null,
    };
  });
}
