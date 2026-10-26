/**
 * 예산대 페이지가 서로 다른 이야기를 하게 만드는 관찰들.
 *
 * 예산 페이지 열여덟 장은 "N억대에서 몇 건이 거래됐고, 어느 구에 몰려 있고, 대표 거래
 * 열두 건은 이렇다"가 전부였다. 나머지는 전부 옆 페이지와 같은 것이었고, 실제로 18장을
 * 8-gram으로 대조하면 서로 84~86%가 겹쳤다. 숫자만 바뀌는 페이지 열여덟 장이다.
 *
 * 여기서 뽑는 것은 그 예산대의 전수 거래에 이미 들어 있던 것들이다 — 얼마짜리 집이
 * 몇 ㎡였고 언제 지은 건물이었는지. 예산 페이지가 답해야 하는 질문은 "이 돈으로 무엇을
 * 살 수 있나"인데, 대표 거래 열두 건으로는 그 답이 안 나온다.
 *
 * `district-facts.mjs`와 같은 규칙을 따른다 — **문턱을 넘은 것만 말한다.** 모든 예산대에
 * 같은 다섯 문장을 붙이면 네 문장짜리 틀이 아홉 문장짜리 틀이 될 뿐이다. 그래서
 * 문턱과 그 근거를 district-facts에서 그대로 가져왔다. 예산대에 맞춰 새로 정하면
 * 어느 예산대가 걸리게 할지를 보면서 정하게 되고, 그건 결과에 끼워 맞추는 것이다.
 */

import { MIN_DEALS as CELL_MIN_DEALS, quantile } from "./complex-price.ts";

/** 전용 60㎡·85㎡는 청약과 세제가 쓰는 선. 준공 30년은 재건축 연한. */
const SMALL_AREA = 60;
const LARGE_AREA = 85;
const OLD_YEARS = 30;
const NEW_YEARS = 5;

/** 중개를 끼지 않은 거래에는 가족 간 증여성 거래가 섞인다. 비중이 크면 평균이 시장가가 아니다. */
const DIRECT_HEAVY = 0.1;

/** 비중을 말하려면 이만큼은 있어야 한다. district-facts와 같은 값. */
const MIN_DEALS = 120;

/**
 * "국민평형"으로 통하는 구간.
 *
 * 이 사이트가 시세를 84㎡로 환산해 보여주고 있으므로, 예산 페이지에서도 같은 크기를
 * 기준으로 삼아야 두 화면이 같은 말을 한다. 80~90㎡로 잡은 것은 같은 84㎡ 타입이
 * 단지마다 83.9~85.0 사이에서 조금씩 다르게 신고되기 때문이다.
 */
const STANDARD_MIN = 80;
const STANDARD_MAX = 90;

/** 어느 구에서 나왔는지를 말하려면 이만큼은 필요하다. 그 아래는 건수만 말한다. */
const STANDARD_MIN_DEALS = 30;

const STANDARD_DISTRICTS = 4;

const share = (count, total) => (total ? count / total : 0);
const pct = (ratio) => Math.round(ratio * 100);

function counted(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "ko"));
}

const areaOf = (deal) => (typeof deal?.area === "number" && deal.area > 0 ? deal.area : null);

/**
 * 한 예산대의 전수 거래에서 말할 만한 것을 고른다.
 *
 * `deals`는 대표 거래가 아니라 그 예산대에 들어온 거래 전부여야 한다. 대표 몇 건 위에
 * 비중을 얹으면 화면이 조용히 틀린 말을 하게 되는 것은 실거래 검색에서 이미 겪었다.
 */
export function budgetFacts(deals, { year }: { year?: number } = {}) {
  const list = (deals ?? []).filter((d) => areaOf(d));
  if (!list.length) return null;

  const facts: Record<string, any> = { total: list.length };

  // 이 예산으로 실제 팔린 것 중 가장 좁은 것과 가장 넓은 것.
  //
  // 문턱이 없다 — 비중과 달리 표본이 얇아도 거짓말을 하지 않는다. 실제로 그 값에 팔린
  // 두 건이고, 예산대마다 다른 단지가 나온다. 평균 한 줄로는 절대 안 보이는 폭이다.
  const sortedByArea = [...list].sort((a, b) => a.area - b.area);
  const pick = (d) => ({
    district: d.district ?? null,
    dong: d.dong ?? null,
    apt: d.apt ?? null,
    area: d.area,
    amount10k: d.amount10k ?? null,
  });
  facts.span = { min: pick(sortedByArea[0]), max: pick(sortedByArea[sortedByArea.length - 1]) };

  // 국민평형을 이 예산으로 살 수 있는가, 살 수 있다면 어디서.
  //
  // 예산대를 하나씩 올리면 이 목록이 도봉·은평에서 노원·구로를 지나 서대문·동작을
  // 거쳐 광진·마포로 옮겨 간다. 예산 페이지 열여덟 장이 서로 다른 이야기를 하게 되는
  // 자리가 여기다.
  const standard = list.filter((d) => d.area >= STANDARD_MIN && d.area < STANDARD_MAX);
  facts.standard = { count: standard.length, min: STANDARD_MIN, max: STANDARD_MAX };
  if (standard.length >= STANDARD_MIN_DEALS) {
    facts.standard.districts = counted(standard, (d) => d.district)
      .slice(0, STANDARD_DISTRICTS)
      .map(([name, count]) => ({ name, count }));
    facts.standard.districtCount = new Set(standard.map((d) => d.district)).size;
  }

  if (list.length < MIN_DEALS) return facts;

  const small = share(list.filter((d) => d.area < SMALL_AREA).length, list.length);
  const large = share(list.filter((d) => d.area > LARGE_AREA).length, list.length);
  if (small >= 0.55) facts.smallHeavy = { share: small };
  else if (large >= 0.3) facts.largeHeavy = { share: large };

  const dated = list.filter((d) => typeof d.buildYear === "number" && d.buildYear > 0);
  if (dated.length >= MIN_DEALS && Number.isFinite(year)) {
    const old = share(dated.filter((d) => year - d.buildYear >= OLD_YEARS).length, dated.length);
    const fresh = share(dated.filter((d) => year - d.buildYear <= NEW_YEARS).length, dated.length);
    if (old >= 0.35) facts.old = { share: old, years: OLD_YEARS };
    else if (fresh >= 0.2) facts.fresh = { share: fresh, years: NEW_YEARS };
  }

  const direct = share(list.filter((d) => d.direct).length, list.length);
  if (direct >= DIRECT_HEAVY) facts.directHeavy = { share: direct };

  return facts;
}

/** 나간 칸이 많은 구를 몇 개까지 적나(#692 완료 조건 1). 구 이름만 - 단지 이름은 적지 않는다. */
export const YEAR_ON_DISTRICTS = 3;

/**
 * 내 예산, 1년 새 — 같은 칸(단지·평형)을 1년 전과 지금으로 견준다(#692, N10).
 *
 * 예산대 장의 다른 숫자는 최근 거래만 본다. 「1년 전 이 돈으로 살 수 있던 칸이 지금은 몇이나 밖으로 나갔나」는
 * 평균 두 개를 견주면 거래 구성이 바뀐 만큼 틀린다 — 비싼 단지가 더 팔린 해에는 아무 칸도 오르지 않아도 평균이 오른다.
 * 그래서 칸마다 자기 자신과 견준다.
 *
 * 값은 단지 가격 범위 파일(complex-price-*.json)에 이미 있는 두 숫자뿐이다 - 새 문턱이 없다.
 * - 지금: `cell.median`(기준 달 값으로 고친 6개월 중앙값). 단지 후보(candidatesInBand)가 「이 예산 안」을 가르는 값과 같은 값이라
 *   장 안의 후보 수와 이 문단의 수가 같은 정의로 맞는다.
 * - 1년 전: `cell.yearAgo.median`(1년 전 같은 석 달의 고치기 전 중앙값). 빌더가 같은 칸 3건(complex-price.ts MIN_DEALS) 이상에만 붙였다.
 * yearAgo 가 없는 칸은 견줄 수 없어 뺀다. 뺀 수는 「지금 이 예산 안인데 1년 전 값이 없는 칸」으로 센다 - 장에 실린 후보 수에서 빠진 만큼이다.
 *
 * 방향도 센다(#699 판정): 넘은 칸은 한 단계 위 예산대(next, [max, max+1억))와 그보다 위(far)로, 들어온 칸은 아래에서 올라온 것(cameBelow)과
 * 위에서 내려온 것(cameAbove)으로. medChange 는 1년 전 이 예산 안이던 칸의 「지금 / 1년 전 - 1」 가운데값이다 - 같은 칸 값이 얼마나 움직였나.
 * 「나간 칸이 많다」가 구간 폭(1억) 탓인지 실제 상승인지는 이 값이 답한다(2026-10 데이터: 같은 칸 +24%, 8억대 +26%).
 *
 * `max10k`가 null 이면(맨 위 구간) 단지 후보와 같은 규칙으로 min + 1억을 쓴다(budget-fragments.ts candidatesShape).
 * 견줄 칸이 하나도 없으면(1년 전 안 0 · 들어온 칸 0) null - 말할 것이 없다.
 */
export function budgetYearOn(files, min10k, max10k) {
  if (!files?.length || !Number.isFinite(min10k)) return null;
  const max = max10k ?? min10k + 10_000;
  const inBand = (v) => v >= min10k && v < max;
  let was = 0;
  let up = 0;
  let down = 0;
  let came = 0;
  let cameBelow = 0;
  let next = 0;
  const changes = [];
  let current = 0;
  let missing = 0;
  let months = null;
  const outBy = new Map();
  for (const file of files) {
    for (const areas of Object.values(file?.cells ?? {})) {
      for (const cell of Object.values(areas ?? {}) as any[]) {
        const now = cell?.median;
        if (!(now > 0)) continue;
        const nowIn = inBand(now);
        if (nowIn) current += 1;
        const then = cell.yearAgo?.median;
        if (!(then > 0)) {
          if (nowIn) missing += 1;
          continue;
        }
        if (!months && cell.yearAgo.months?.length) months = [...cell.yearAgo.months].sort();
        if (inBand(then)) {
          was += 1;
          changes.push(now / then - 1);
          if (nowIn) continue;
          if (now >= max) {
            up += 1;
            if (now < max + 10_000) next += 1;
          } else down += 1;
          outBy.set(file.district, (outBy.get(file.district) ?? 0) + 1);
        } else if (nowIn) {
          came += 1;
          if (then < min10k) cameBelow += 1;
        }
      }
    }
  }
  if (!was && !came) return null;
  const top = [...outBy]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "ko"))
    .slice(0, YEAR_ON_DISTRICTS)
    .map(([name, count]) => ({ name, count }));
  return {
    was,
    out: up + down,
    up,
    down,
    next,
    far: up - next,
    medChange: changes.length ? quantile([...changes].sort((a, b) => a - b), 0.5) : null,
    came,
    cameBelow,
    cameAbove: came - cameBelow,
    current,
    missing,
    top,
    months: months ? [months[0], months.at(-1)] : null,
    reference: files.find((f) => f?.reference)?.reference ?? null,
  };
}

/**
 * 사실 문단(budgetFactsHtml)에 「내 예산, 1년 새」를 얹은 예산대. band.facts 는 budget-deals.json(최근 3개월 거래)에서 오고,
 * yearOn 은 단지 가격 범위 파일에서 빌드 때 센다 - 두 입력을 한 문단으로 굽는 자리다(build-budget-pages.ts). 원본 band 는 바꾸지 않는다.
 * 견줄 칸이 없거나 단지 파일이 없으면 band 그대로(문단도 전과 같다).
 * budget-fragments.ts 가 아니라 여기 두는 것은 그 모듈의 의존 목록이 시험으로 고정돼 있어서다(test/render-parity.test.mjs).
 */
export function withYearOn(band, complexFiles) {
  if (!band) return band;
  const yearOn = budgetYearOn(complexFiles, band.min10k, band.max10k);
  return yearOn ? { ...band, facts: { ...(band.facts ?? {}), yearOn } } : band;
}

const area = (value) => `${Number(value).toFixed(0)}㎡`;

function place(deal, en) {
  const parts = [deal.district, deal.dong, deal.apt].filter(Boolean);
  if (!parts.length) return null;
  return en ? parts.join(", ") : parts.join(" ");
}

/**
 * 고른 관찰을 문장으로.
 *
 * 두 언어를 여기서 미리 만들어 두 벌 다 HTML에 굽는다. 화면은 고르기만 한다 — 같은
 * 계산을 브라우저 쪽에 한 벌 더 두면 같은 수정을 두 곳에 해야 한다.
 */
export function budgetFactSentences(facts, locale = "ko") {
  if (!facts) return [];
  const en = locale === "en";
  const out = [];

  if (facts.span) {
    const { min, max } = facts.span;
    const minPlace = place(min, en);
    const maxPlace = place(max, en);
    if (minPlace && maxPlace && max.area > min.area) {
      out.push(
        en
          ? `What actually sold in this range runs from ${area(min.area)} (${minPlace}) to ${area(max.area)} (${maxPlace}) — the same money buys either.`
          : `이 예산으로 실제 팔린 것은 전용 ${area(min.area)}(${minPlace})부터 ${area(max.area)}(${maxPlace})까지입니다. 같은 돈으로 양쪽 다 살 수 있었습니다.`
      );
    }
  }

  const std = facts.standard;
  if (std) {
    const label = `${std.min}~${std.max}㎡`;
    if (std.districts?.length) {
      const names = std.districts
        .map(({ name, count }) => (en ? `${name} (${count})` : `${name} ${count}건`))
        .join(en ? ", " : " · ");
      out.push(
        en
          ? `Of these, ${std.count.toLocaleString("en-US")} were the standard ${label} size, spread over ${std.districtCount} districts and concentrated in ${names}.`
          : `이 가운데 전용 ${label}, 이른바 국민평형은 ${std.count.toLocaleString("ko-KR")}건입니다. ${std.districtCount}개 구에 걸쳐 있고 ${names} 순으로 많습니다.`
      );
    } else if (std.count > 0) {
      out.push(
        en
          ? `The standard ${label} size barely appears at this budget — ${std.count} deals in total.`
          : `전용 ${label}, 이른바 국민평형은 이 예산대 전체에서 ${std.count}건뿐입니다.`
      );
    } else {
      out.push(
        en
          ? `Not one deal at this budget was the standard ${label} size.`
          : `이 예산대에서는 전용 ${label}, 이른바 국민평형이 한 건도 없었습니다.`
      );
    }
  }

  if (facts.smallHeavy) {
    out.push(
      en
        ? `${pct(facts.smallHeavy.share)}% are under ${SMALL_AREA}m² — at this budget the choice is mostly among small units.`
        : `전용 ${SMALL_AREA}㎡ 미만이 ${pct(facts.smallHeavy.share)}%입니다. 이 예산에서 고르게 되는 것은 대부분 소형입니다.`
    );
  } else if (facts.largeHeavy) {
    out.push(
      en
        ? `${pct(facts.largeHeavy.share)}% are over ${LARGE_AREA}m².`
        : `전용 ${LARGE_AREA}㎡ 초과가 ${pct(facts.largeHeavy.share)}%입니다.`
    );
  }

  if (facts.old) {
    out.push(
      en
        ? `${pct(facts.old.share)}% are in buildings at least ${facts.old.years} years old, so at this budget the price often includes a redevelopment expectation rather than the flat alone.`
        : `준공 ${facts.old.years}년을 넘긴 단지가 ${pct(facts.old.share)}%입니다. 이 예산대에서 붙는 값은 집 자체보다 재건축 기대가 만드는 값인 경우가 많습니다.`
    );
  } else if (facts.fresh) {
    out.push(
      en
        ? `${pct(facts.fresh.share)}% are in buildings under ${facts.fresh.years} years old.`
        : `준공 ${facts.fresh.years}년 이내 단지가 ${pct(facts.fresh.share)}%입니다.`
    );
  }

  if (facts.directHeavy) {
    out.push(
      en
        ? `${pct(facts.directHeavy.share)}% were filed without an agent. Family transfers and developer settlements sit in that group, so they are not all prices the market put on a flat.`
        : `중개사를 끼지 않은 직거래가 ${pct(facts.directHeavy.share)}%입니다. 여기에는 가족 간 증여성 거래와 시행사 정산이 섞이므로, 전부 시장이 붙인 값은 아닙니다.`
    );
  }

  if (facts.yearOn) out.push(...yearOnSentences(facts.yearOn, en));

  return out;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ["202506", "202508"] → 「2025년 6~8월」·"Jun–Aug 2025". 해가 다르면 해를 둘 다 적는다. 한 달이면 한 달. */
function monthSpan(span, en) {
  const [ay, am] = [Number(span[0].slice(0, 4)), Number(span[0].slice(4, 6))];
  const last = span.at(-1);
  const [by, bm] = [Number(last.slice(0, 4)), Number(last.slice(4, 6))];
  const ko = (y, m) => `${y}년 ${m}월`;
  const eng = (y, m) => `${EN_MONTHS[m - 1]} ${y}`;
  if (ay === by && am === bm) return en ? eng(ay, am) : ko(ay, am);
  if (ay === by) return en ? `${EN_MONTHS[am - 1]}–${eng(by, bm)}` : `${ay}년 ${am}~${bm}월`;
  return en ? `${eng(ay, am)}–${eng(by, bm)}` : `${ko(ay, am)}~${ko(by, bm)}`;
}

/**
 * 「내 예산, 1년 새」 문장(#692). 예산대 사실 문단 끝에 붙는다 - 틀(realestate-template.html)에 새 자리를 만들지 않으려고
 * 같은 문단의 뒷부분으로 둔다. 두 언어가 늘 같은 개수의 문장을 낸다. 단지 이름은 쓰지 않는다(구 이름만).
 * 문장 사이 고정 글자가 길게 이어지지 않게 숫자를 사이사이 둔다 - 18장 공통 산문(scripts/prose-share.ts, 8단어 창)을 덜 늘린다.
 */
function yearOnSentences(y, en) {
  const out = [];
  const then = y.months ? monthSpan(y.months, en) : null;
  const ref = /^\d{6}$/.test(String(y.reference ?? "")) ? monthSpan([y.reference], en) : null;
  // 앞머리가 같은 칸 비교라는 한 줄을 겸한다(#699 판정 - 따로 두던 「착시」 문장은 뺐다).
  const basis = then && ref ? ` (${then} median vs the ${ref}-adjusted median)` : "";
  const lead = en
    ? `Comparing each complex-size cell with itself${basis}`
    : then && ref
      ? `같은 단지·같은 평형끼리 1년 전(${then} 중간값)과 지금(${ref} 값으로 고친 중간값)을 견주면`
      : "같은 단지·같은 평형끼리 1년 전과 지금을 견주면";
  const cameAbove = y.cameAbove ? (en ? ` (${y.cameAbove} came down from above)` : `(위에서 내려온 칸 ${y.cameAbove}칸)`) : "";
  if (y.was) {
    const fell = y.down ? (en ? ` (${y.down} fell below it)` : ` (${y.down}칸은 이 예산 아래로)`) : "";
    const ratio = pct(share(y.up, y.was));
    const change = Math.abs(Math.round((y.medChange ?? 0) * 100));
    const rose = (y.medChange ?? 0) >= 0;
    out.push(
      en
        ? `${lead}, ${y.up} of the ${y.was} cells inside this budget a year ago (${ratio}%) now cost more than it (${y.next} in the next band up, ${y.far} further up)${fell}.`
        : `${lead}, 1년 전 이 예산 안이던 ${y.was}칸 가운데 ${y.up}칸(${ratio}%)이 지금은 이 예산을 넘습니다(한 단계 위 예산대 ${y.next}칸, 그보다 위 ${y.far}칸)${fell}.`,
      en
        ? `The typical cell ${rose ? "rose" : "fell"} ${change}%, and ${y.cameBelow} cells that sat below this budget a year ago have risen into it${cameAbove}.`
        : `같은 칸 값은 가운데값으로 ${change}% ${rose ? "올랐고" : "내렸고"}, 1년 전 이 예산 아래였다가 올라 들어온 칸이 ${y.cameBelow}칸입니다${cameAbove}.`
    );
  } else {
    out.push(
      en
        ? `${lead}, none sat inside this budget a year ago, and ${y.cameBelow} cells that sat below it have risen into it${cameAbove}.`
        : `${lead}, 1년 전 이 예산 안이던 칸은 없고, 1년 전 이 예산 아래였다가 올라 들어온 칸이 ${y.cameBelow}칸입니다${cameAbove}.`
    );
  }
  if (y.out && y.top?.length) {
    const names = y.top.map(({ name, count }) => (en ? `${name} (${count})` : `${name} ${count}칸`)).join(en ? ", " : "·");
    out.push(en ? `The cells that left are mostly in ${names}.` : `나간 칸은 ${names} 순으로 많습니다.`);
  }
  if (y.missing) {
    out.push(
      en
        ? `${y.missing} of today's ${y.current} cells had under ${CELL_MIN_DEALS} deals a year earlier and are left out.`
        : `지금 ${y.current}칸 가운데 1년 전 거래가 ${CELL_MIN_DEALS}건 미만인 ${y.missing}칸은 뺐습니다.`
    );
  }
  return out;
}
