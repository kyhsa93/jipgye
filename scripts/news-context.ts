import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_SLUGS, districtFile } from "./district-slugs.ts";
import {
  BASE_AREA_M2,
  CHANGE_MIN_COUNT,
  MIN_SAMPLE,
  areaPrice,
  formatEok,
  monthLabel,
} from "./realestate-format.ts";

const MAX_CONTEXT = 2;

const REALESTATE_HINTS = [
  "아파트", "전세", "월세", "집값", "분양", "재건축", "재개발", "주택", "매매",
  "시세", "청약", "입주", "빌라", "오피스텔", "보증금", "임대", "실거래",
  "평당", "㎡", "정비사업", "전셋값",
];

const BYLINE = /[([][^)\]]{1,12}=[^)\]]{1,15}[)\]]/g;

// 금리 맥락(기사 옆 "전세자금대출 최저금리 연 x%" 등)은 금감원 금융상품통합비교공시 값이라 뺐다(#577, 소유자 결정 2026-10-25).
// 남는 맥락은 국토부 실거래가 하나다. 이미 쌓인 news-history 의 kind:"rates" 맥락은 데이터 정리 PR(#577 C)이 지운다.

const OVERALL_HREF = {
  sale: "./apartment-sale.html",
  jeonse: "./apartment-jeonse.html",
  wolse: "./apartment-rent.html",
};

const hrefFor = (slug, kind) =>
  slug ? `./${districtFile(slug)}` : OVERALL_HREF[kind] ?? OVERALL_HREF.sale;

const hasAny = (text, words) => words.some((word) => text.includes(word));

const areaKo = (perPyeong10k) => formatEok(areaPrice(perPyeong10k, BASE_AREA_M2), "ko");
const areaEn = (perPyeong10k) => formatEok(areaPrice(perPyeong10k, BASE_AREA_M2), "en");

const baselineKo = (date) => {
  const [, month, day] = String(date ?? "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : null;
};
const baselineEn = (date) => {
  const label = monthLabel(`0000${String(date ?? "").slice(5, 7)}`, "en");
  const day = Number(String(date ?? "").slice(8, 10));
  return label && day ? `${label} ${day}` : null;
};

const signed = (value) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(1)}%`;

function noteOf(metric, change, window, locale) {
  const count = metric?.transactionCount;
  if (typeof count !== "number") return null;

  const span = window?.weeks ? (locale === "en" ? `last ${window.weeks} weeks` : `최근 ${window.weeks}주`) : "";
  const parts = [
    locale === "en"
      ? `${count.toLocaleString("en-US")} deals${span ? ` in the ${span}` : ""}`
      : `${span ? `${span} ` : ""}계약 ${count.toLocaleString("ko-KR")}건`,
  ];

  const baseline = locale === "en" ? baselineEn(metric.baselineDate) : baselineKo(metric.baselineDate);
  // 증감은 현재·기준 양쪽 건수가 문턱 이상일 때만(#290). 빌드가 기준 쪽이 얇아 막은 값은 `change` 없이 `changeWithheld` 로 온다.
  if (!metric.changeWithheld && count >= CHANGE_MIN_COUNT.district && typeof change?.percent === "number" && baseline) {
    parts.push(
      locale === "en" ? `${signed(change.percent)} vs ${baseline}` : `${baseline} 대비 ${signed(change.percent)}`
    );
  }
  return parts.join(" · ");
}

const enoughSample = (metric) => Boolean(metric) && (metric.transactionCount ?? 0) >= MIN_SAMPLE;

export function articleText(item) {
  return `${item?.title ?? ""} ${item?.preview ?? ""}`.replace(BYLINE, " ");
}

export function findDistrict(text, districts = []) {
  for (const district of districts) {
    const name = district?.name ?? "";
    if (!name) continue;
    const short = name.endsWith("구") ? name.slice(0, -1) : name;
    if (text.includes(name)) return district;
    if (short.length >= 2 && text.includes(short)) return district;
  }
  return null;
}

// 옵션 객체의 모양만 적는다(타입 표기 전용 - 런타임 코드는 그대로). window 는 noteOf 가 weeks 만 읽는
// 실거래 집계 창이라 여기서는 모양을 고정하지 않는다.
type MetricOptions = { name?: string; nameEn?: string; slug?: string | null; window?: unknown };

export function metricEntry(entry, kind, { name, nameEn, slug = null, window }: MetricOptions = {}) {
  const metric = entry?.[kind];
  if (!enoughSample(metric)) return null;

  const common = { kind: "realestate", href: hrefFor(slug, kind) };

  if (kind === "sale" && metric.avgPricePerPyeong10k) {
    return {
      ...common,
      label: `${name} 아파트 ${BASE_AREA_M2}㎡ 매매`,
      labelEn: `${nameEn} apartment ${BASE_AREA_M2}㎡ sale`,
      value: areaKo(metric.avgPricePerPyeong10k),
      valueEn: areaEn(metric.avgPricePerPyeong10k),
      note: noteOf(metric, metric.change, window, "ko"),
      noteEn: noteOf(metric, metric.change, window, "en"),
    };
  }
  if (kind === "jeonse" && metric.avgDepositPerPyeong10k) {
    return {
      ...common,
      label: `${name} 아파트 ${BASE_AREA_M2}㎡ 전세`,
      labelEn: `${nameEn} apartment ${BASE_AREA_M2}㎡ jeonse`,
      value: areaKo(metric.avgDepositPerPyeong10k),
      valueEn: areaEn(metric.avgDepositPerPyeong10k),
      note: noteOf(metric, metric.change, window, "ko"),
      noteEn: noteOf(metric, metric.change, window, "en"),
    };
  }
  if (kind === "wolse" && metric.avgMonthlyRent10k) {
    const deposit = Math.round(metric.avgDeposit10k ?? 0).toLocaleString("ko-KR");
    const rent = Math.round(metric.avgMonthlyRent10k).toLocaleString("ko-KR");
    return {
      ...common,
      label: `${name} 아파트 월세`,
      labelEn: `${nameEn} apartment rent`,
      value: `보증금 ${deposit}만원 / 월 ${rent}만원`,
      valueEn: `₩${((metric.avgDeposit10k ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}M + ₩${(metric.avgMonthlyRent10k / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}M/mo`,
      note: noteOf(metric, metric.change, window, "ko"),
      noteEn: noteOf(metric, metric.change, window, "en"),
    };
  }
  return null;
}

function realestateEntry(entry, name, nameEn, text, slug, window) {
  const wantsJeonse = text.includes("전세") || text.includes("전셋값");
  const wantsWolse = text.includes("월세") || text.includes("임대료");

  const candidates = [];
  if (wantsJeonse) candidates.push("jeonse");
  if (wantsWolse) candidates.push("wolse");
  candidates.push("sale", "jeonse");

  for (const kind of candidates) {
    const entryOf = metricEntry(entry, kind, { name, nameEn, slug, window });
    if (entryOf) return entryOf;
  }
  return null;
}

function realestateContext(text, realestate) {
  if (!hasAny(text, REALESTATE_HINTS)) return null;

  const window = realestate?.window;
  const district = findDistrict(text, realestate?.districts);
  if (district) {
    const slug = DISTRICT_SLUGS[district.name] ?? null;
    return realestateEntry(district, district.name, district.name, text, slug, window);
  }
  if (text.includes("서울")) {
    return realestateEntry(realestate?.overall, "서울 전체", "Seoul", text, null, window);
  }
  return null;
}

export function buildRealestateStats(realestate) {
  const entries = ["sale", "jeonse", "wolse"]
    .map((kind) =>
      metricEntry(realestate?.overall, kind, {
        name: "서울",
        nameEn: "Seoul",
        window: realestate?.window,
      })
    )
    .filter(Boolean);

  return entries.length === 3 ? entries : null;
}

export function buildContext(item, { realestate }: { realestate?: unknown } = {}) {
  const text = articleText(item);
  if (!text.trim()) return [];

  return [realestateContext(text, realestate)]
    .filter(Boolean)
    .slice(0, MAX_CONTEXT);
}

export function attachContext(news, data) {
  const { realestateStats: _dropStats, ...base } = news ?? {};
  const items = (base.items ?? []).map((item) => {
    const { context: _drop, ...rest } = item;
    const context = buildContext(item, data);
    return context.length ? { ...rest, context } : rest;
  });

  const realestateStats = buildRealestateStats(data?.realestate);
  return realestateStats ? { ...base, items, realestateStats } : { ...base, items };
}

const dataDir = path.resolve(import.meta.dirname, "../docs/data");

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    console.warn(`  ${name}.json을 읽지 못했습니다 - 이 데이터는 기사에 붙이지 않습니다`);
    return null;
  }
}

async function main() {
  const newsFile = path.join(dataDir, "news.json");
  const [news, realestate] = await Promise.all([
    readFile(newsFile, "utf8").then(JSON.parse),
    readJson("realestate"),
  ]);

  const next = attachContext(news, { realestate });
  const counts = { realestate: 0 };
  let matched = 0;
  for (const item of next.items) {
    if (!item.context?.length) continue;
    matched += 1;
    for (const c of item.context) counts[c.kind] += 1;
  }

  await writeFile(newsFile, JSON.stringify(next, null, 2));
  console.log(
    `  기사 ${next.items.length}건 중 ${matched}건에 수치를 붙였습니다` +
      ` (실거래가 ${counts.realestate})`
  );
  if (next.items.length && !matched) {
    console.warn("  경고: 한 건도 붙지 않았습니다. 데이터 파일이 비었는지 확인해주세요");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`뉴스 수치 연결 실패: ${err.message}`);
    process.exit(1);
  });
}
