export const BASE_AREA_M2 = 84;
export const AREA_OPTIONS = [59, 84, 114];

const PYEONG_PER_M2 = 1 / 3.3058;
export const pyeongOf = (areaM2) => areaM2 * PYEONG_PER_M2;
export const BASE_AREA_PYEONG = pyeongOf(BASE_AREA_M2);

export const normalizeArea = (value) =>
  AREA_OPTIONS.includes(Number(value)) ? Number(value) : BASE_AREA_M2;

export const MIN_SAMPLE = 5;

export const hasEnoughSample = (metric) =>
  Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

// 증감은 현재 값과 기준 값 양쪽의 신고 건수가 이 문턱 이상일 때만 낸다(#290). 서울 전체 100·자치구 20은 po·cpo·pm 이 먼저 선언한 임시값이다
// (분석가 표에서 20~200 어디에 놓아도 막히는 날은 4~7일로 같았다 - 결과에 맞춰 고른 값이 아니다). 부트스트랩으로 올릴 근거가 나오면 이 한 줄을 고친다.
// 값을 내는 문턱(MIN_SAMPLE)은 따로다. 브라우저(docs/index.html)는 계산하지 않고 빌드가 남긴 `changeWithheld` 를 그리기만 한다.
export const CHANGE_MIN_COUNT = { seoul: 100, district: 20 };

export const canShowChange = (current, baseline, min) => (current ?? 0) >= min && (baseline ?? 0) >= min;

export function areaPrice(pricePerPyeong10k, areaM2 = BASE_AREA_M2) {
  if (typeof pricePerPyeong10k !== "number" || !Number.isFinite(pricePerPyeong10k)) return null;
  return Math.round(pricePerPyeong10k * pyeongOf(areaM2));
}

export function formatEok(value10k, locale = "ko") {
  if (typeof value10k !== "number" || !Number.isFinite(value10k)) return "-";
  const n = Math.round(value10k);

  if (locale === "en") {
    return `₩${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;
  }

  const eok = Math.floor(n / 10000);
  const man = n % 10000;
  if (!eok) return `${man.toLocaleString("ko-KR")}만원`;
  if (!man) return `${eok}억원`;
  return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
}

// 1억이 넘는 돈은 늘 "2억 264만원" 꼴로 적는다. "20,264만원"과 섞이면 같은 돈이 화면마다 다른 숫자로
// 읽힌다(UIUX #46). 1억 아래(평당가 대부분, 월세)는 그대로 만원.
export const formatMan = (value10k, locale = "ko") =>
  typeof value10k === "number" && Number.isFinite(value10k)
    ? locale === "en"
      ? `₩${(value10k / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`
      : Math.abs(Math.round(value10k)) >= 10000
        ? formatEok(value10k)
        : `${Math.round(value10k).toLocaleString("ko-KR")}만원`
    : "-";

export const KIND_FIELDS = {
  sale: { metric: "sale", value: "avgPricePerPyeong10k" },
  jeonse: { metric: "jeonse", value: "avgDepositPerPyeong10k" },
  wolse: { metric: "wolse", value: "avgDeposit10k" },
};

// kind 는 KIND_FIELDS 의 자기 키(sale·jeonse·wolse)인 문자열만 받는다(#248 g, #593). 배열 ["jeonse"] 는 객체 키로 `"jeonse"` 가 되어 값은 찾으면서
// `kind === "jeonse"` 판정은 거짓이라 라벨·규칙이 어긋났다. 모르는 kind 는 undefined 라 metricOf 는 null, valueOf 는 던진다(예전 그대로).
export const kindField = (kind) => (typeof kind === "string" && Object.hasOwn(KIND_FIELDS, kind) ? KIND_FIELDS[kind] : undefined);

export function metricOf(entry, kind) {
  const field = kindField(kind);
  if (!field) return null;
  const metric = entry?.[field.metric];
  if (!hasEnoughSample(metric)) return null;
  const value = metric[field.value];
  return typeof value === "number" && Number.isFinite(value) ? metric : null;
}

export const valueOf = (metric, kind) => metric?.[kindField(kind).value] ?? null;

export function resolveMetric(entry, kind) {
  const metric = metricOf(entry, kind);
  return metric ? { metric } : null;
}

// 표본이 모자라 값을 못 내는 카드에 이유를 적을 때 쓰는 건수(#264). 지표가 있고 1 <= n < 문턱이면 n, 아니면(n=0·지표 없음·건수가 정수 아님·문턱 이상) null 이라 그 카드는 「-」 그대로다.
// 문턱 판정은 위 hasEnoughSample 한 곳이다 - 여기서 MIN_SAMPLE 을 다시 쓰지 않는다. 브라우저(scripts/realestate-template.html)의 lowOr 가 같은 조건을 쓴다.
// 표 칸의 「신고 N건…」 문구를 적을지(#593 b). 지표가 있고 표본이 모자랄 때만 참이다 - 표본이 충분한데 값만 없는 칸에 「N건뿐」이라 적는 것은 사실이 아니다(해자 2).
// n=0 도 표본 부족이다(lowSampleCount 와 달리 「신고 0건」을 적는다 - 요약 카드와 표의 오래된 차이). 문턱은 위 hasEnoughSample 한 곳이고, 브라우저(realestate-template.html)의 lowCell 이 같은 조건을 쓴다.
export const isShortSample = (metric) => Boolean(metric) && !hasEnoughSample(metric);

export function lowSampleCount(entry, kind) {
  const field = kindField(kind);
  const metric = field ? entry?.[field.metric] : null;
  const n = metric?.transactionCount;
  return !hasEnoughSample(metric) && Number.isInteger(n) && n >= 1 ? n : null;
}

export function jeonseRatio(entry) {
  const sale = resolveMetric(entry, "sale");
  const jeonse = resolveMetric(entry, "jeonse");
  if (!sale || !jeonse) return null;

  const salePrice = valueOf(sale.metric, "sale");
  const jeonsePrice = valueOf(jeonse.metric, "jeonse");
  if (!salePrice || !jeonsePrice) return null;

  return { ratio: (jeonsePrice / salePrice) * 100 };
}

export const formatPercent = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";

export function monthLabel(period, locale = "ko") {
  const month = Number(String(period ?? "").slice(4, 6));
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (locale === "en") {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  }
  return `${month}월`;
}
