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

export function metricOf(entry, kind) {
  const field = KIND_FIELDS[kind];
  if (!field) return null;
  const metric = entry?.[field.metric];
  if (!hasEnoughSample(metric)) return null;
  const value = metric[field.value];
  return typeof value === "number" && Number.isFinite(value) ? metric : null;
}

export const valueOf = (metric, kind) => metric?.[KIND_FIELDS[kind].value] ?? null;

export function resolveMetric(entry, kind) {
  const metric = metricOf(entry, kind);
  return metric ? { metric } : null;
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
