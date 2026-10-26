// 실거래 시세표(realestateHeadHtml·realestateTableHtml)가 같이 쓰는 칸 규칙과 정렬. 순수 모듈 - render/entry.jsx(JSX)가 이 함수를 쓴다(#242 PR 2).
// 여기서 `prerender.ts`·`renderer.mjs`를 불러오면 안 된다(로더가 막는다). 예전에 prerender.ts에 있던 `re*` 보조 함수 열여섯이 이름 그대로 여기 있다:
// RE_LABELS·reHeadLabels·reCount·reMan·reEok·reChange·reWolseChange·reCountSpan·reLowSample·reCells·reAllCells·reStaleTag·reDistrictLink·reRow·reSorted·reDistrictRows.
//
// 이 모듈은 마크업(HTML)을 만들지 않는다. 칸 하나가 어떤 모양인지(없음·표본 부족·값·증감·건수)와 그 글자만 정하고, `<span>`·`<td>`는 쓰는 쪽(JSX 요소)이 입힌다
// (#255 `realestate-rows.mjs`, #256 `district-tables.mjs`와 같은 방식). 그래서 분기 오류는 같은 실행 비교가 아니라 손으로 적은 기대값이 잡는다
// (test/fixtures/render/realestate-table-branches.mjs).
//
// 칸은 조각(part)의 배열이다. 조각 하나는 { type, text, title, dir, esc }이다:
//  - type은 조각의 종류다: "text"(글자만) · "strong"(굵은 값) · "count"(작은 건수) · "ratio"(전세가율) · "change"(증감, dir이 "up"|"down") · "low"(표본 부족) · "stale"(낡음 태그).
//    어느 종류가 어떤 마크업(`<span class="price-strong">` 등)이 되는지는 여기서 정하지 않는다 - 쓰는 쪽(JSX 요소)이 입힌다.
//  - title은 그 조각에 붙는 title 속성의 글자(없으면 null)이고 언제나 이스케이프해서 낸다.
//  - esc는 예전 문자열 렌더가 그 글자를 `escapeHtml`에 거치던 자리(true)와 이스케이프 없이 문자열에 끼우던 자리(false, raw)를 가른다. JSX는 어느 쪽이든 글자를 요소의 텍스트로 낸다 - React가 이스케이프한다.
//    raw 자리(esc=false)의 글자는 전부 숫자 서식 함수(formatMan·formatEok·formatPercent·toFixed)나 코드 상수가 만든 것이라 `& < > "`가 들 수 없다(입력 문자열이 닿지 않는다) -
//    그래서 예전 문자열 렌더와 React가 달라질 수 없었다(PR 본문의 raw 보간 표). 입력 글자가 닿는 자리(건수·이름·표본 부족 문구·제목)는 전부 esc=true다.
//
// 표본 문턱(MIN_SAMPLE)은 여기서 다시 적용하지 않는다. `resolveMetric`(realestate-format.mjs, `hasEnoughSample`)이 한 곳에서 판정하고,
// 이 모듈은 그 결과(값 있음 / 값 없음)를 따를 뿐이다. `reLowSample`의 n은 건수 문턱이 아니라 건수 표기다(`transactionCount` 그대로, 없으면 0).
// DIRECTION 해자 2: 표본이 모자라면 값을 내지 않고 모자란다고 적는다(`low-sample` 조각) - 이 판정을 건너뛰는 변경은 방향에 어긋난다.
import { DISTRICT_SLUGS, districtFile } from "./district-slugs.ts";
import {
  areaPrice,
  formatEok,
  formatMan,
  formatPercent,
  isShortSample,
  jeonseRatio,
  kindField,
  resolveMetric,
  valueOf,
} from "./realestate-format.ts";
import { WOLSE_CONVERSION_RATE } from "./realestate-metrics.ts";

export const RE_LABELS = {
  district: "지역",
  sale: "매매",
  jeonse: "전세",
  wolse: "월세",
  colSale: "매매 3.3㎡당 평균",
  colJeonse: "전세 3.3㎡당 평균 보증금",
  colWolse: "월세 평균 보증금 / 월세",
  perPyeong: "3.3㎡당 평균",
  perPyeongDeposit: "3.3㎡당 평균 보증금",
  area: "84㎡ 환산",
  deposit: "평균 보증금",
  monthly: "평균 월세",
  count: "거래 건수",
  ratio: "전세가율",
  ratioByComplex: "전세가율 단지별 중간값",
  overall: "서울 전체",
};

/** 건수 글자 `1,234건`. null·undefined는 `toLocaleString`을 못 불러 던진다(예전 문자열 렌더와 같다). 문자열·배열은 자기 글자를 그대로 낸다. */
export const reCount = (n) => `${n.toLocaleString("ko-KR")}건`;
export const reMan = (v) => formatMan(v);
export const reEok = (v) => formatEok(v);

/** 머리글 칸 이름. 종류(sale·jeonse·wolse)가 없으면 세 종류를 한 줄에 놓는 표, 모르는 종류는 매매와 같다. */
export function reHeadLabels(kind) {
  if (!kind) return [RE_LABELS.district, RE_LABELS.colSale, RE_LABELS.colJeonse, RE_LABELS.colWolse];
  if (kind === "wolse") return [RE_LABELS.district, RE_LABELS.deposit, RE_LABELS.monthly, RE_LABELS.count];
  if (kind === "jeonse") {
    return [RE_LABELS.district, RE_LABELS.perPyeongDeposit, RE_LABELS.area, RE_LABELS.ratio, RE_LABELS.count];
  }
  return [RE_LABELS.district, RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count];
}

/** 머리글 한 줄의 칸 이름. 자치구 페이지(district가 있으면)는 종류와 상관없이 "구분·평당가·84㎡ 환산·거래건수"다. */
export const headLabels = (kind = null, district = null) =>
  district ? ["구분", RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count] : reHeadLabels(kind);

// ---- 조각(part) ----
const part = (type, text, { title = null, dir = null, esc = false } = {}) => ({ type, text, title, dir, esc });
const NONE = () => [part("text", "데이터 없음")];
const SPACE = () => part("text", " ");
const strong = (text) => part("strong", text);
const countSpan = (n) => part("count", reCount(n), { esc: true });

/** 직전 대비 증감(매매·전세). 없거나 숫자가 아니거나 0이면 조각 없음. 제목은 기준일이 있을 때만. */
export function reChange(change, baselineDate) {
  if (!change || typeof change.value10k !== "number" || change.value10k === 0) return [];
  const dir = change.value10k > 0 ? "up" : "down";
  const arrow = change.value10k > 0 ? "▲" : "▼";
  return [
    SPACE(),
    part("change", `${arrow}${reMan(Math.abs(change.value10k))}`, { dir, title: baselineDate ? `${baselineDate} 대비` : null }),
  ];
}

/** 월세 증감: 보증금과 월세를 묶은 값의 변화율(%). 숫자 percent가 없거나 value10k가 0이면 조각 없음. 방향은 value10k의 부호다. */
export function reWolseChange(change, baselineDate) {
  if (!change || typeof change.percent !== "number" || change.value10k === 0) return [];
  const dir = change.value10k > 0 ? "up" : "down";
  const arrow = change.value10k > 0 ? "▲" : "▼";
  const rate = `${(WOLSE_CONVERSION_RATE * 100).toFixed(1)}%`;
  const title = baselineDate
    ? `${baselineDate} 대비 · 보증금과 월세를 묶은 ㎡당 값(보증금 + 월세×12÷${rate})의 증감 — 그 주에 신고된 방 크기가 달라서 생기는 흔들림을 덜어 낸 값입니다`
    : null;
  return [SPACE(), part("change", `${arrow}${Math.abs(change.percent).toFixed(1)}%`, { dir, title })];
}

/** 건수 칸 뒤에 붙이는 작은 건수(한 칸에 값과 건수를 같이 낼 때). 건수가 숫자가 아니면 조각 없음. */
export const reCountSpan = (metric) =>
  typeof metric?.transactionCount === "number" ? [SPACE(), countSpan(metric.transactionCount)] : [];

/**
 * 표본 부족 칸: 값을 내지 않고 모자란다고 적는다(해자 2). n은 `transactionCount` 그대로이고 없으면 0이다 - 건수 문턱은 resolveMetric이 이미 적용했다.
 * 글자와 제목 모두 이스케이프한다(건수가 숫자가 아니어도 그대로 적는다).
 */
export function reLowSample(metric) {
  const n = metric?.transactionCount ?? 0;
  return part("low", `신고 ${n}건`, { title: `이번 달 신고가 ${n}건뿐이라 평균을 내지 않았습니다.`, esc: true });
}

// 값을 못 낸 칸(resolveMetric이 null): 지표가 있고 표본이 모자라면(isShortSample) 표본 부족, 아니면 "-"(지표 없음, 또는 표본은 충분한데 값만 없음 - #593 b).
function lowOrNone(entry, kind) {
  const raw = entry?.[kindField(kind).metric];
  return isShortSample(raw) ? [reLowSample(raw)] : NONE();
}

/**
 * 한 종류(kind) 표의 칸들. 값이 없으면 [표본 부족 또는 "-", "-", "-"]이고 전세는 머리글 다섯 칸에 맞춰 하나 더 "-"다(#593 a - 전에는 세 칸이라 전세가율·거래건수 라벨이
 * 모바일 카드에서 빠졌다). colspan 은 쓰지 않는다(칸마다 data-label 이 카드 모양의 라벨이다). 틀의 cellsFor 가 같은 칸 수를 낸다.
 */
export function reCells(entry, kind) {
  const resolved = resolveMetric(entry, kind);
  if (!resolved) return [lowOrNone(entry, kind), NONE(), NONE(), ...(kind === "jeonse" ? [NONE()] : [])];
  const { metric } = resolved;

  if (kind === "wolse") {
    return [
      [strong(reMan(metric.avgDeposit10k))],
      [strong(`월 ${reMan(metric.avgMonthlyRent10k)}`), ...reWolseChange(metric.change, metric.baselineDate)],
      [countSpan(metric.transactionCount)],
    ];
  }
  const perPyeong = valueOf(metric, kind);
  const cells = [
    [strong(reMan(perPyeong)), ...reChange(metric.change, metric.baselineDate)],
    [strong(reEok(areaPrice(perPyeong)))],
  ];
  if (kind === "jeonse") {
    const ratio = jeonseRatio(entry);
    cells.push(ratio ? [part("ratio", formatPercent(ratio.ratio))] : NONE());
  }
  cells.push([countSpan(metric.transactionCount)]);
  return cells;
}

/** 세 종류를 한 줄에 놓는 표의 세 칸(매매·전세·월세). 칸마다 값 뒤에 증감과 작은 건수를 붙인다. */
export function reAllCells(entry) {
  return ["sale", "jeonse", "wolse"].map((kind) => {
    const resolved = resolveMetric(entry, kind);
    if (!resolved) return lowOrNone(entry, kind);
    const { metric } = resolved;
    if (kind === "wolse") {
      return [part("text", `${reMan(metric.avgDeposit10k)} / 월 ${reMan(metric.avgMonthlyRent10k)}`), ...reCountSpan(metric)];
    }
    return [part("text", reMan(valueOf(metric, kind))), ...reChange(metric.change, metric.baselineDate), ...reCountSpan(metric)];
  });
}

const STALE_TITLE = "이 지역은 오늘 실거래 조회에 실패해 지난번에 받은 값을 그대로 보여줍니다.";

/** 낡음 태그: 오늘 조회에 실패해 지난번 값을 보여주는 지역에 날짜를 붙인다. `staleAt`이 없거나 날짜가 아니면 조각 없음. */
export function reStaleTag(entry) {
  const at = entry?.staleAt;
  if (!at) return [];
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return [];
  const label = date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
  return [SPACE(), part("stale", label, { title: STALE_TITLE, esc: true })];
}

/**
 * 지역 이름 칸. 자치구면 그 자치구 페이지로 가는 상대 경로를 준다(`./district-<slug>.html`). 경로는 DISTRICT_SLUGS 상수 25개가 만들고 `./`로 시작하므로 `javascript:`가 될 수 없다.
 * 이름이 객체의 기본 키(constructor·toString·__proto__ 등)여도 DISTRICT_SLUGS 자기 키만 보므로 링크 없는 글자다(#248 c, #593 - 전에는 `./district-function …`이 됐다).
 * text는 받은 값 그대로다(이스케이프·글자 바꿈은 쓰는 쪽).
 */
export function reDistrictLink(label) {
  const slug = Object.hasOwn(DISTRICT_SLUGS, label) ? DISTRICT_SLUGS[label] : null;
  return { text: label, href: slug ? `./${districtFile(slug)}` : null };
}

/** 표 한 줄: 이름 칸(+낡음 태그)과 값 칸들. 값 칸의 data-label은 머리글의 다음 칸 이름이다. */
export function reRow(entry, label, isOverall, kind) {
  const labels = reHeadLabels(kind);
  const cells = kind ? reCells(entry, kind) : reAllCells(entry);
  const name = isOverall ? { text: label, href: null } : reDistrictLink(label);
  return {
    overall: Boolean(isOverall),
    name,
    stale: reStaleTag(entry),
    cells: cells.map((parts, i) => ({ label: labels[i + 1], parts })),
  };
}

/**
 * 자치구 정렬: 고른 종류(없으면 매매)의 값이 높은 순, 값이 없는 곳은 뒤, 둘 다 없으면 이름순. 사본을 정렬한다(입력을 바꾸지 않는다).
 * 이름순은 `localeCompare(…, "ko")`로 로케일을 고정한다(#248 d, #593). 자치구 25곳의 이름순은 여덟 로케일에서 같고 라틴·자모 혼합만 갈렸으므로 실제 출력은 그대로다.
 */
export function reSorted(districts, kind) {
  const key = kind ?? "sale";
  return [...districts].sort((a, b) => {
    const av = valueOf(resolveMetric(a, key)?.metric, key);
    const bv = valueOf(resolveMetric(b, key)?.metric, key);
    if (av === null && bv === null) return (a.name ?? "").localeCompare(b.name ?? "", "ko");
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

/** 자치구 페이지의 표: 매매·전세·월세 세 줄, 칸은 평당가(월세는 보증금 / 월세)·84㎡ 환산·거래건수. 값이 없으면 [표본 부족 또는 "-", "-", "-"]. */
export function reDistrictRows(entry) {
  const labels = [RE_LABELS.sale, RE_LABELS.jeonse, RE_LABELS.wolse];
  const colLabels = [RE_LABELS.perPyeong, RE_LABELS.area, RE_LABELS.count];
  return ["sale", "jeonse", "wolse"].map((kind, i) => {
    const resolved = resolveMetric(entry, kind);
    let cells;
    if (!resolved) {
      cells = [lowOrNone(entry, kind), NONE(), NONE()];
    } else {
      const { metric } = resolved;
      const change = reChange(metric.change, metric.baselineDate);
      const price =
        kind === "wolse"
          ? [strong(reMan(metric.avgDeposit10k)), part("text", " / "), strong(`월 ${reMan(metric.avgMonthlyRent10k)}`)]
          : [strong(reMan(valueOf(metric, kind))), ...change];
      const area = kind === "wolse" ? [part("text", "-")] : [strong(reEok(areaPrice(valueOf(metric, kind))))];
      cells = [price, area, [countSpan(metric.transactionCount)]];
    }
    return { label: labels[i], cells: cells.map((parts, j) => ({ label: colLabels[j], parts })) };
  });
}

/**
 * 시세표의 줄들. 자치구를 고르면 그 자치구의 세 줄({ byDistrict: true }, 없는 자치구면 null),
 * 아니면 서울 전체 한 줄 + 정렬한 자치구 줄들({ byDistrict: false }, 서울 전체도 자치구도 없으면 null).
 */
export function realestateTable(realestate, kind = null, district = null) {
  const districts = realestate?.districts ?? [];
  if (district) {
    const entry = districts.find((d) => d.name === district);
    return entry ? { byDistrict: true, rows: reDistrictRows(entry) } : null;
  }
  if (!realestate?.overall && !districts.length) return null;
  const rows = [];
  if (realestate.overall) rows.push(reRow(realestate.overall, RE_LABELS.overall, true, kind));
  for (const d of reSorted(districts, kind)) rows.push(reRow(d, d.name ?? "-", false, kind));
  return { byDistrict: false, rows };
}
