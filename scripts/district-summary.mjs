import { spreadSentence } from "./complex-ratio.mjs";
import {
  areaPrice,
  formatEok,
  formatMan,
  formatPercent,
  jeonseRatio,
  resolveMetric,
  valueOf,
} from "./realestate-format.mjs";

const round1 = (n) => Math.round(n * 10) / 10;

function hasFinalConsonant(word) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}
const topicParticle = (word) => (hasFinalConsonant(word) ? "은" : "는");

function saleRank(entry, districts) {
  const value = valueOf(resolveMetric(entry, "sale")?.metric, "sale");
  if (!value) return null;

  const priced = districts
    .map((d) => valueOf(resolveMetric(d, "sale")?.metric, "sale"))
    .filter((v) => typeof v === "number");
  if (priced.length < 2) return null;

  return { rank: priced.filter((v) => v > value).length + 1, total: priced.length };
}

function nearestDistrict(entry, districts) {
  const value = valueOf(resolveMetric(entry, "sale")?.metric, "sale");
  if (!value) return null;

  let best = null;
  for (const other of districts) {
    if (other.name === entry.name) continue;
    const otherValue = valueOf(resolveMetric(other, "sale")?.metric, "sale");
    if (typeof otherValue !== "number") continue;
    const gap = Math.abs(otherValue - value);
    if (!best || gap < best.gap) best = { name: other.name, value: otherValue, gap };
  }
  return best;
}

/** 전세가율을 낸 구들을 높은 쪽부터 세운 목록. 같은 값이면 이름순으로 가려 순서가 늘 같다. */
function ratioOrder(districts) {
  return districts
    .map((d) => ({ name: d.name, ratio: jeonseRatio(d)?.ratio }))
    .filter((d) => typeof d.ratio === "number")
    .sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name, "ko"));
}

/**
 * 전세가율 값이 든 한 문장 (#172). 값 바로 옆, 같은 문장 안에 그 값을 낸 신고 건수를 적는다 -
 * 이 구의 매매·전세 건수와 비교한 서울 평균의 건수. 이 값은 구 전체 평균 둘의 비이므로 건수가 곧 표본이다.
 *
 * 25장이 숫자만 바꾼 같은 틀이 되지 않도록, 서울 평균과의 방향에 더해 이 구가 전세가율 순서에서
 * 어느 두 구 사이에 있는지를 이름으로 적는다. 순서는 전체가 하나의 줄이라 위아래 이웃의 짝이
 * 구마다 다르고, 숫자와 이 구 이름을 지워도 문장이 겹치지 않는다(test/ratio-sample.test.mjs).
 */
function ratioSentence({ entry, ratio, overall, overallRatio, districts, locale }) {
  const en = locale === "en";
  const fmt = (n) => n.toLocaleString(en ? "en-US" : "ko-KR");
  const counts = (e) => ({
    sale: resolveMetric(e, "sale")?.metric?.transactionCount,
    jeonse: resolveMetric(e, "jeonse")?.metric?.transactionCount,
  });
  const own = counts(entry);
  const city = overall ? counts(overall) : null;

  const order = ratioOrder(districts);
  const at = order.findIndex((d) => d.name === entry.name);
  const upper = at > 0 ? order[at - 1].name : null;
  const lower = at >= 0 && at < order.length - 1 ? order[at + 1].name : null;
  const total = order.length;

  const withSeoul = Boolean(overallRatio);
  const diff = withSeoul ? ratio.ratio - overallRatio.ratio : 0;
  const close = withSeoul && Math.abs(diff) < 1;

  const basisKo = withSeoul && city
    ? `이 구 매매 ${fmt(own.sale)}건·전세 ${fmt(own.jeonse)}건, 서울 전체 매매 ${fmt(city.sale)}건·전세 ${fmt(city.jeonse)}건 기준`
    : `이 구 매매 ${fmt(own.sale)}건·전세 ${fmt(own.jeonse)}건 기준`;
  const basisEn = withSeoul && city
    ? `based on ${fmt(own.sale)} sales and ${fmt(own.jeonse)} jeonse here, ${fmt(city.sale)} and ${fmt(city.jeonse)} citywide`
    : `based on ${fmt(own.sale)} sales and ${fmt(own.jeonse)} jeonse`;

  if (en) {
    const seoul = withSeoul
      ? close
        ? `, close to the Seoul average of ${formatPercent(overallRatio.ratio)}`
        : `, ${diff > 0 ? "above" : "below"} the Seoul average of ${formatPercent(overallRatio.ratio)}`
      : "";
    const place =
      total > 1 && at >= 0
        ? !upper
          ? `, the highest of ${total} districts with the next one down being ${lower}`
          : !lower
            ? `, the lowest of ${total} districts with the next one up being ${upper}`
            : `, ranking between ${upper} and ${lower} among ${total} districts`
        : "";
    return `The jeonse ratio is ${formatPercent(ratio.ratio)}${seoul}${place} (${basisEn}).`;
  }

  const joinKo = (name) => `${name}${hasFinalConsonant(name) ? "과" : "와"}`;
  const seoulKo = withSeoul
    ? close
      ? `서울 평균 ${formatPercent(overallRatio.ratio)}에 가까운 수준`
      : `서울 평균 ${formatPercent(overallRatio.ratio)}보다 ${diff > 0 ? "높은" : "낮은"} 편`
    : null;
  const placeKo =
    total > 1 && at >= 0
      ? !upper
        ? `${total}개 구를 전세가율 순으로 세우면 가장 높고 바로 아래는 ${lower}`
        : !lower
          ? `${total}개 구를 전세가율 순으로 세우면 가장 낮고 바로 위는 ${upper}`
          : `${total}개 구를 전세가율 순으로 세우면 ${joinKo(upper)} ${lower} 사이`
      : null;
  const head = `전세가율은 ${formatPercent(ratio.ratio)}`;
  const tail = seoulKo && placeKo ? `로 ${seoulKo}이고, ${placeKo}입니다` : seoulKo ? `로 ${seoulKo}입니다` : placeKo ? `로, ${placeKo}입니다` : "입니다";
  return `${head}${tail}(${basisKo}).`;
}

export function districtSentences(entry, realestate, locale = "ko", spread = null) {
  if (!entry) return [];

  const districts = realestate?.districts ?? [];
  const overall = realestate?.overall;
  const en = locale === "en";
  const out = [];

  const sale = resolveMetric(entry, "sale");
  const overallSale = resolveMetric(overall, "sale");

  if (sale) {
    const value = valueOf(sale.metric, "sale");
    const overallValue = valueOf(overallSale?.metric, "sale");
    const ratio = overallValue ? round1(value / overallValue) : null;

    let first = en
      ? `Apartments in ${entry.name} trade at ${formatMan(value, locale)} per pyeong`
      : `${entry.name} 아파트 매매가는 평당 ${formatMan(value, locale)}입니다`;

    if (ratio) {
      const comparison = en
        ? ratio === 1
          ? `, the same as the Seoul average of ${formatMan(overallValue, locale)}`
          : `, ${ratio}× the Seoul average of ${formatMan(overallValue, locale)}`
        : ratio === 1
          ? `. 서울 평균 ${formatMan(overallValue, locale)}과 같은 수준입니다`
          : `. 서울 평균 ${formatMan(overallValue, locale)}의 ${ratio}배입니다`;
      first += comparison;
    }
    out.push(`${first}.`);

    const rank = saleRank(entry, districts);
    if (rank) {
      const ko =
        rank.rank === 1
          ? `신고 건수가 충분한 ${rank.total}개 구 가운데 가장 높습니다.`
          : rank.rank === rank.total
            ? `신고 건수가 충분한 ${rank.total}개 구 가운데 가장 낮습니다.`
            : `신고 건수가 충분한 ${rank.total}개 구 가운데 ${rank.rank}번째로 높습니다.`;
      const suffix = rank.rank === 1 ? "st" : rank.rank === 2 ? "nd" : rank.rank === 3 ? "rd" : "th";
      const eng =
        rank.rank === 1
          ? `That is the highest among the ${rank.total} districts with enough reported transactions.`
          : rank.rank === rank.total
            ? `That is the lowest among the ${rank.total} districts with enough reported transactions.`
            : `That is ${rank.rank}${suffix} among the ${rank.total} districts with enough reported transactions.`;
      out.push(en ? eng : ko);
    }

    out.push(
      en
        ? `For an 84m² unit that works out to about ${formatEok(areaPrice(value), locale)}.`
        : `84㎡(약 25평) 기준으로 환산하면 약 ${formatEok(areaPrice(value), locale)}입니다.`
    );

    const nearest = nearestDistrict(entry, districts);
    if (nearest) {
      out.push(
        en
          ? `The closest district by price is ${nearest.name} at ${formatMan(nearest.value, locale)} per pyeong.`
          : `평당가가 가장 가까운 지역은 ${nearest.name}(${formatMan(nearest.value, locale)})입니다.`
      );
    }
  } else {
    const reported = entry.sale?.transactionCount ?? 0;
    out.push(
      en
        ? `Only ${reported} apartment sales have been reported in ${entry.name} this month, too few to average.`
        : `${entry.name}${topicParticle(entry.name)} 이번 달 아파트 매매 신고가 ${reported}건뿐이라 평균을 내지 않았습니다.`
    );

    const jeonseOnly = resolveMetric(entry, "jeonse");
    if (jeonseOnly) {
      const deposit = valueOf(jeonseOnly.metric, "jeonse");
      out.push(
        en
          ? `Jeonse deposits average ${formatMan(deposit, locale)} per pyeong, or about ${formatEok(areaPrice(deposit), locale)} for an 84m² unit.`
          : `전세는 평당 보증금 ${formatMan(deposit, locale)}으로, 84㎡ 기준 약 ${formatEok(areaPrice(deposit), locale)}입니다.`
      );
    }
  }

  const ratio = jeonseRatio(entry);
  const overallRatio = overall ? jeonseRatio(overall) : null;
  if (ratio) {
    out.push(ratioSentence({ entry, ratio, overall, overallRatio, districts, locale }));

    // 자치구 값은 구 전체 평균 둘을 나눈 것이라 어느 단지의 전세가율도 아닐 수 있다.
    // 칸 하나하나에서 낸 값의 분포를 바로 뒤에 붙여, 그 하나를 얼마나 믿을지 알린다.
    const spreadLine = spreadSentence(spread, ratio.ratio, locale);
    if (spreadLine) out.push(spreadLine);
  }

  const wolse = resolveMetric(entry, "wolse");
  if (wolse) {
    out.push(
      en
        ? `Monthly rentals average a ${formatMan(wolse.metric.avgDeposit10k, locale)} deposit with ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} per month.`
        : `월세는 보증금 ${formatMan(wolse.metric.avgDeposit10k, locale)}에 월 ${formatMan(wolse.metric.avgMonthlyRent10k, locale)} 수준입니다.`
    );
  }

  const counts = ["sale", "jeonse", "wolse"]
    .map((kind) => ({ kind, metric: resolveMetric(entry, kind)?.metric }))
    .filter((c) => c.metric);
  if (counts.length) {
    const labels = { sale: en ? "sales" : "매매", jeonse: en ? "jeonse" : "전세", wolse: en ? "rentals" : "월세" };
    const parts = counts.map((c) =>
      en
        ? `${c.metric.transactionCount.toLocaleString("en-US")} ${labels[c.kind]}`
        : `${labels[c.kind]} ${c.metric.transactionCount.toLocaleString("ko-KR")}건`
    );
    out.push(
      en
        ? `These figures are based on ${parts.join(", ")} reported to the government.`
        : `이 숫자들은 정부에 신고된 ${parts.join(", ")}을 집계한 것입니다.`
    );
  }

  return out;
}
