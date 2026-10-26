import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICT_SLUGS, districtFile } from "./district-slugs.ts";
import {
  BASE_AREA_M2,
  CHANGE_MIN_COUNT,
  areaPrice,
  formatEok,
  hasEnoughSample,
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
// 남는 맥락은 국토부 실거래가 하나다. 이미 쌓였던 news·news-history 의 kind:"rates" 맥락 62건은 #577 C 에서 지웠다.

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

export function articleText(item) {
  return `${item?.title ?? ""} ${item?.preview ?? ""}`.replace(BYLINE, " ");
}

const articleTitle = (item) => String(item?.title ?? "").replace(BYLINE, " ");

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
  if (!hasEnoughSample(metric)) return null;

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

// ---- 새 답 잇기 (#694, N12): 기사 키워드 → 우리 데이터 화면 -----------------------------------------------------
// 신고가·계약 해제·입주 물량·반전세(전월세전환) 기사에 그 질문의 답 화면 링크와 값 한 줄을 붙인다. 값은 우리 산출물
// (docs/data/*.json)을 그대로 읽고, 기사 주장이 맞다 틀리다는 말하지 않는다. 걸리는 규칙은 아래 조건이 모두 맞을 때뿐이다.
//  1. 키워드(정규식, 고정). 2. 부동산 신호어(증시·주식 기사의 같은 단어를 거른다). 3. 서울 범위: 자치구 이름이 있거나,
//  '서울'이 있고 다른 지역·"서울이 아닌" 표현이 없을 때. 데이터가 서울뿐이라 지방 기사에 서울 값을 붙이지 않는다.
// 문턱은 데이터 쪽 값을 그대로 따른다(record-high 의 enough, cancellation 의 cancelledShare===null, conversion 의 cells 필터).
// 칩 모양은 기존 realestate 칩과 같고(label·value·note + href) kind 만 다르다 - news.html·프리렌더 코드는 그대로 그린다.
// 칩 전체가 링크라 note 끝에 "관련 숫자 →"를 적어 이동을 알린다. 금리 값은 읽지 않는다(#577).

const HOUSING_WORDS = ["아파트", "집값", "부동산", "단지", "실거래", "매매", "주택", "재건축", "재개발", "㎡", "호가", "전세", "월세"];
const MARKET_WORDS = /코스피|코스닥|증시|주가|나스닥|다우|S&P|종목|주식|비트코인|코인|상장|환율/;
const OTHER_REGION = /경기|인천|부산|대구|대전|광주|울산|세종|제주|전국|지방|충청|전라|경상|강원|수원|성남|분당|일산|판교|하남|과천|화성|용인|고양|김포|평택|안양|충남|충북|전남|전북|경남|경북/;
const NOT_SEOUL = /서울\s?(도|이|가)\s?아닌|서울\s?(외|밖)|비\s?서울/;
const PRESALE_WORDS = /분양|청약/;
// 제목이 자기 비율을 이미 적은 기사(「서울 해제율은 7.6%」)는 정의·기간이 다른 우리 값(1.4%)을 옆에 두면 모순처럼 읽힌다(#698 판정).
const TITLE_PERCENT = /\d(\.\d+)?\s?%/;
const TITLE_STAT = /해제율|취소율|\d(\.\d+)?\s?%/;

const THIN_NOTE_KO = " · 관련 숫자 →";
const THIN_NOTE_EN = " · Related numbers →";

const num = (value, locale = "ko") => Number(value).toLocaleString(locale === "en" ? "en-US" : "ko-KR");
const isNum = (value) => typeof value === "number" && Number.isFinite(value);

// 기사가 가리키는 서울 범위: 자치구 이름 하나, 서울 전체, 또는 null(붙이지 않는다).
// 자치구가 둘 이상 나오면(「동작구 현대(관악)」「강남은 내리고 강북은 신고가」) 어느 구 얘기인지 못 가리므로 구를 고르지 않고,
// '서울'이 있을 때만 서울 전체로 간다. 다른 지역 이름이 하나라도 있으면 구가 있어도 붙이지 않는다(세종 기사에 성동구 값이 붙었다).
function seoulScope(text, names) {
  if (NOT_SEOUL.test(text) || OTHER_REGION.test(text)) return null;
  const mentioned = names.filter((name) => {
    const short = name.endsWith("구") ? name.slice(0, -1) : name;
    return text.includes(name) || (short.length >= 2 && text.includes(short));
  });
  if (mentioned.length === 1) return { name: mentioned[0] };
  return text.includes("서울") ? { name: null } : null;
}

const chip = (kind, href, ko, en) => ({
  kind,
  href,
  label: ko.label,
  labelEn: en.label,
  value: ko.value,
  valueEn: en.value,
  note: ko.note + THIN_NOTE_KO,
  noteEn: en.note + THIN_NOTE_EN,
});

function recordHighChip(data, scope) {
  const MIN_WITH_NEXT = 100; // record-high.ts MIN_RECORDS 와 같은 서울 줄 문턱(구 줄은 데이터의 `enough` 를 따른다).
  const row = scope.name ? data?.breakdown?.districts?.find((d) => d?.ko === scope.name && d.enough) : null;
  const m = row ?? data?.main;
  if (!isNum(m?.record) || !isNum(m?.all) || !isNum(m?.withNext) || m.withNext < MIN_WITH_NEXT) return null;
  const name = row ? row.ko : "서울";
  const nameEn = row ? row.en : "Seoul";
  return chip(
    "record-high",
    "./record-high.html#breakdown-section",
    {
      label: `${name} 아파트 신고가 다음 거래`,
      value: `그 값 이상 ${m.record}%`,
      note: `신고가 ${num(m.withNext)}건 중 · 아무 거래 뒤는 ${m.all}%`,
    },
    {
      label: `${nameEn} apartments: next sale after a record high`,
      value: `${m.record}% matched or beat it`,
      note: `of ${num(m.withNext, "en")} record highs · ${m.all}% after any sale`,
    }
  );
}

function cancellationChip(data, scope) {
  const row = scope.name ? data?.districts?.find((d) => d?.district === scope.name && isNum(d.cancelledShare)) : null;
  const m = row ?? data?.seoul;
  if (!isNum(m?.cancelledShare) || !isNum(m?.cancelled) || !isNum(m?.deals)) return null;
  const months = data?.months;
  const span = months?.length ? `${months[0].slice(0, 4)}.${months[0].slice(4)}~${months.at(-1).slice(0, 4)}.${months.at(-1).slice(4)} ` : "";
  const name = row ? row.district : "서울";
  return chip(
    "cancellation",
    row ? "./cancelled-deals.html#district-section" : "./cancelled-deals.html",
    {
      label: `${name} 아파트 매매 계약 해제`,
      value: `${num(m.cancelled)}건 · ${m.cancelledShare}%`,
      note: `${span}신고 ${num(m.deals)}건 중`,
    },
    {
      label: `${row ? row.district : "Seoul"} apartment sales later cancelled`,
      value: `${num(m.cancelled, "en")} · ${m.cancelledShare}%`,
      note: `of ${num(m.deals, "en")} filed${span ? `, ${span.trim()}` : ""}`,
    }
  );
}

function moveInChip(data, scope) {
  // 구 합계는 본문 문장과 같은 seoul.districts(달 미정 세대 포함)에서 읽고, 예정이 없는 구(거기엔 없다)는 byDistrict.rows 로 0 을 확인한다.
  const rows = scope.name ? data?.byDistrict?.rows?.find((r) => r?.name === scope.name) : null;
  const found = rows ? data?.seoul?.districts?.find((d) => d?.name === scope.name) : null;
  const rental = rows && Array.isArray(rows.rental) ? rows.rental.reduce((a, b) => a + (isNum(b) ? b : 0), 0) : null;
  const units = rows ? (found?.units ?? 0) : data?.seoul?.units;
  const complexes = rows ? (found?.complexes ?? 0) : data?.seoul?.complexes;
  if (!isNum(units) || !isNum(complexes) || (rows && !isNum(rental))) return null;
  const from = String(data?.seoul?.from ?? "").replace("-", ".");
  const to = String(data?.seoul?.to ?? "").replace("-", ".");
  const span = from && to ? `${from}~${to}` : "앞으로 2년";
  const name = rows ? rows.name : "서울";
  return chip(
    "move-in",
    rows ? "./price-outlook.html#move-in-districts" : "./price-outlook.html#move-in-section",
    {
      label: `${name} 입주 예정 (30세대 이상 아파트)`,
      value: units ? `${num(units)}세대` : "예정 없음",
      note: `${span}${units ? ` · ${num(complexes)}개 단지` : ""}${rows && units ? ` · 그중 임대 ${num(rental)}` : ""} · 추정`,
    },
    {
      label: `${rows ? rows.name : "Seoul"} move-ins expected (30+ unit complexes)`,
      value: units ? `${num(units, "en")} homes` : "none expected",
      note: `${span}${units ? ` · ${num(complexes, "en")} complexes` : ""}${rows && units ? ` · ${num(rental, "en")} rental` : ""} · estimate`,
    }
  );
}

function conversionChip(data, scope) {
  const cell = scope.name ? data?.cells?.find((c) => c?.district === scope.name && c.band === "60to85" && isNum(c.rate)) : null;
  const m = cell ?? data?.seoul;
  if (!isNum(m?.rate) || !isNum(m?.pairs)) return null;
  const name = cell ? `${cell.district} 60~85㎡` : "서울";
  const nameEn = cell ? `${cell.district} 60-85㎡` : "Seoul";
  return chip(
    "conversion",
    "./jeonse-vs-wolse.html#rate-section",
    {
      label: `${name} 전월세전환율`,
      value: `${m.rate}%`,
      note: `같은 단지 전세·월세 ${num(m.pairs)}쌍 기준`,
    },
    {
      label: `${nameEn} jeonse-to-rent conversion rate`,
      value: `${m.rate}%`,
      note: `from ${num(m.pairs, "en")} same-complex jeonse/rent pairs`,
    }
  );
}

// 규칙 4종. 순서가 곧 우선순위다(기사당 칩 ≤ MAX_CONTEXT).
const ANSWER_RULES = [
  {
    key: "recordHigh",
    keyword: /신고가/,
    requires: (text) => hasAny(text, HOUSING_WORDS) && !MARKET_WORDS.test(text),
    names: (data) => (data?.breakdown?.districts ?? []).map((d) => d?.ko).filter(Boolean),
    chip: recordHighChip,
  },
  {
    key: "cancellation",
    keyword: /(계약|거래)\s?(해제|취소)|(해제|취소)\s?거래|해제\s?(신고|건)/,
    // 분양·청약 계약 해제는 우리 매매 해제 데이터가 다루지 않는다.
    requires: (text, title) =>
      hasAny(text, ["아파트", "부동산", "실거래", "매매", "주택", "집값", "단지"]) && !PRESALE_WORDS.test(text) && !TITLE_STAT.test(title),
    names: (data) => (data?.districts ?? []).map((d) => d?.district).filter(Boolean),
    chip: cancellationChip,
  },
  {
    key: "moveIn",
    keyword: /입주\s?(물량|폭탄|대란|쇼크|절벽)|입주\s?예정\s?(물량|단지|가구|세대)/,
    requires: () => true,
    names: (data) => (data?.byDistrict?.rows ?? []).map((r) => r?.name).filter(Boolean), // 25구 전부(예정 없는 구 포함)
    chip: moveInChip,
  },
  {
    key: "conversion",
    keyword: /반전세|전월세\s?전환|월세\s?전환|월세화|전환율/,
    // '전환율'은 기업·마케팅 기사에도 쓰여 전세·월세가 같이 있을 때만 센다.
    // 제목이 이미 비율을 말하면(「월세 비중 50%」) 우리 정의의 값과 어긋나 보이니 붙이지 않는다.
    requires: (text, title) => hasAny(text, ["전세", "월세", "반전세"]) && !TITLE_PERCENT.test(title),
    names: (data) => Object.keys(data?.slugs ?? {}),
    chip: conversionChip,
  },
];

// 키워드는 제목에서만 찾는다 - 미리보기 문장에 곁다리로 나온 단어(「…신고가…」「…반전세…」)는 그 기사의 주제가 아니다.
function answerContext(rule, item, text, data) {
  const source = data?.[rule.key];
  const title = articleTitle(item);
  if (!source || !rule.keyword.test(title) || !rule.requires(text, title)) return null;
  const scope = seoulScope(text, rule.names(source));
  return scope ? rule.chip(source, scope) : null;
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

// 새 답 칩(#694)의 입력. 모양은 docs/data 의 같은 이름 파일 그대로이고, 없거나 깨졌으면 그 칩만 안 붙는다.
type ContextData = { realestate?: unknown; recordHigh?: any; cancellation?: any; moveIn?: any; conversion?: any };

// 규칙 하나가 던져도 다른 칩과 기사 전체는 그대로 가야 한다 - daily·summarize 두 경로 모두 soft-fail(#694 판정).
const safely = (fn) => {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
};

export function buildContext(item, data: ContextData = {}) {
  const text = articleText(item);
  if (!text.trim()) return [];

  // 실거래 시세 칩이 먼저다(기존 동작 그대로). 새 답 칩은 남는 자리를 채우고 합쳐 MAX_CONTEXT 를 넘기지 않는다.
  return [
    safely(() => realestateContext(text, data?.realestate)),
    ...ANSWER_RULES.map((rule) => safely(() => answerContext(rule, item, text, data))),
  ]
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
  const [news, realestate, recordHigh, cancellation, moveIn, conversion] = await Promise.all([
    readFile(newsFile, "utf8").then(JSON.parse),
    readJson("realestate"),
    readJson("record-high"),
    readJson("cancellation"),
    readJson("move-in"),
    readJson("conversion"),
  ]);

  const next = attachContext(news, { realestate, recordHigh, cancellation, moveIn, conversion });
  const counts = { realestate: 0, "record-high": 0, cancellation: 0, "move-in": 0, conversion: 0 };
  let matched = 0;
  for (const item of next.items) {
    if (!item.context?.length) continue;
    matched += 1;
    for (const c of item.context) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  }

  await writeFile(newsFile, JSON.stringify(next, null, 2));
  console.log(
    `  기사 ${next.items.length}건 중 ${matched}건에 수치를 붙였습니다` +
      ` (실거래가 ${counts.realestate} · 신고가 ${counts["record-high"]} · 해제 ${counts.cancellation} · 입주 ${counts["move-in"]} · 전환율 ${counts.conversion})`
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
