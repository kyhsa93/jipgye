/**
 * 신고된 뒤에 일어나는 두 가지 - 해제와 등기.
 *
 * 시세 화면은 해제된 거래를 빼고 센다(dropCancelled). 빼는 것이 맞지만, 뺀 것이
 * 무엇이었는지는 어디에도 남지 않는다. 여기서는 그 뺀 쪽을 본다.
 */

const pad = (n) => String(n).padStart(2, "0");

/** 국토부는 날짜를 "26.08.18"로 준다. */
export function parseShortDate(value) {
  const text = String(value ?? "").trim();
  const matched = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(text);
  if (!matched) return null;
  const [, y, m, d] = matched;
  const year = 2000 + Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC는 13월이나 99일을 다음 해로 굴려 버린다. 굴러간 값은 원래 숫자와
  // 달라지므로, 되읽어 같은지 보는 것으로 걸러낸다.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function dealDate(item) {
  const y = Number(item?.dealYear);
  const m = Number(item?.dealMonth);
  const d = Number(item?.dealDay);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const dayGap = (from, to) => (from && to ? Math.round((to - from) / 86400000) : null);

export const isCancelled = (item) =>
  String(item?.cdealType ?? "").trim().length > 0 || String(item?.cdealDay ?? "").trim().length > 0;

/**
 * 정정 재신고. 해제 기록 가운데 같은 계약(구·동·지번·단지·전용면적·층·계약일·금액)이 해제되지 않은
 * 기록으로 그대로 다시 신고된 것은 계약이 깨진 것이 아니라 신고를 고친 것이다 - 그 다시 신고된 쪽은
 * 대부분 등기까지 갔다. 2026-10-01에 세어 보니 해제 기록의 76%가 이랬고(해제되지 않은 기록끼리
 * 완전히 같은 경우는 0.65%뿐이라 우연이 아니다), 이것을 해제로 세던 이 화면은 해제율을 3~4배로
 * 부풀리고 "비싼 집일수록 더 깨진다"는 틀린 결론을 냈다(#28).
 */
export const contractKey = (item) =>
  [item?.sggCd, item?.umdNm, item?.jibun, item?.aptNm, item?.excluUseAr, item?.floor, item?.dealYear, item?.dealMonth, item?.dealDay, item?.dealAmount].join("|");

/** 정정 기록을 뺀 목록과, 뺀 것들. 정정의 짝(다시 신고된 기록)은 남는다 - 한 계약은 한 번만 센다. */
export function withoutCorrections(items) {
  const live = new Map();
  for (const item of items ?? []) {
    if (!isCancelled(item)) live.set(contractKey(item), item);
  }
  const kept = [];
  const corrections = [];
  for (const item of items ?? []) {
    if (isCancelled(item) && live.has(contractKey(item))) corrections.push({ item, twin: live.get(contractKey(item)) });
    else kept.push(item);
  }
  return { items: kept, corrections };
}

export const isRegistered = (item) => String(item?.rgstDate ?? "").trim().length > 0;

export const monthKey = (item) => `${item?.dealYear}-${pad(item?.dealMonth)}`;

export const amountOf = (item) => {
  const value = Number(String(item?.dealAmount ?? "").replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 해제된 거래가 그 단지에서 비싼 축이었는지.
 *
 * "신고가만 올려 두고 취소한다"는 말이 사실이라면 해제 건은 같은 단지·같은 면적의
 * 남은 거래보다 높아야 한다. 실제로 그런지는 세어 보기 전에는 알 수 없고,
 * 세어 본 결과를 그대로 싣는다.
 */
export function priceStanding(items) {
  const groups = new Map();

  for (const item of items ?? []) {
    const area = Number(item?.excluUseAr);
    const amount = amountOf(item);
    if (!Number.isFinite(area) || !amount) continue;

    const key = `${item.sggCd} ${item.aptNm} ${item.jibun ?? ""} ${Math.round(area)}`;
    if (!groups.has(key)) groups.set(key, { cancelled: [], live: [] });
    groups.get(key)[isCancelled(item) ? "cancelled" : "live"].push(amount);
  }

  let higher = 0;
  let similar = 0;
  let lower = 0;
  const ratios = [];

  for (const group of groups.values()) {
    if (!group.cancelled.length || !group.live.length) continue;
    const mid = median(group.live);
    for (const amount of group.cancelled) {
      const ratio = amount / mid;
      ratios.push(ratio);
      if (ratio > 1.02) higher += 1;
      else if (ratio < 0.98) lower += 1;
      else similar += 1;
    }
  }

  const compared = higher + similar + lower;
  if (!compared) return null;

  const share = (n) => Math.round((n / compared) * 1000) / 10;
  return {
    compared,
    higher,
    similar,
    lower,
    higherShare: share(higher),
    similarShare: share(similar),
    lowerShare: share(lower),
    medianRatio: Math.round(median(ratios) * 1000) / 1000,
  };
}

/**
 * 등기가 늦은 거래를 세려면 "늦었다"고 할 기준이 있어야 하는데, 이것을 등기까지
 * 걸린 날의 분포에서 뽑으면 안 된다. 그 분포에는 이미 등기된 건만 들어 있어서
 * 빠른 쪽으로 기운다 - 아직 등기가 안 된 느린 건들은 애초에 세어지지 않는다.
 *
 * 대신 계약월 단위로 본다. 그 달 계약의 열에 여덟이 이미 등기를 마쳤다면 그 달은
 * 익은 달이고, 거기 남은 미등기는 시간이 모자라서가 아니다. 아직 안 익은 달은
 * 통째로 모집단에서 뺀다 - 이번 달 계약이 등기 전인 것은 당연한 일이라 세면 거짓말이 된다.
 */
export const MATURE_SHARE = 0.8;

/**
 * 등기까지 걸린 날을 가르는 가격대(만원). 비쌀수록 잔금까지 길게 잡는지가 계약 일정을 짜는
 * 사람의 질문이다.
 */
export const GAP_BANDS = [
  { key: "upTo6", max: 60_000 },
  { key: "upTo15", max: 150_000 },
  { key: "upTo25", max: 250_000 },
  { key: "over25", max: Infinity },
];

/** 계약에서 등기까지 걸린 날. 1년을 넘는 값은 날짜가 잘못 들어온 것으로 본다. */
const gapOf = (item) => {
  const gap = dayGap(dealDate(item), parseShortDate(item.rgstDate));
  return gap !== null && gap >= 0 && gap < 400 ? gap : null;
};

export function registrationStats(items, matureShare = MATURE_SHARE) {
  const live = (items ?? []).filter((item) => !isCancelled(item));
  if (!live.length) return null;

  const months = new Map();
  for (const item of live) {
    const key = monthKey(item);
    if (!months.has(key)) months.set(key, { filed: 0, registered: 0 });
    const row = months.get(key);
    row.filed += 1;
    if (isRegistered(item)) row.registered += 1;
  }

  const mature = new Set(
    [...months.entries()].filter(([, row]) => row.registered / row.filed >= matureShare).map(([key]) => key)
  );

  const matured = live.filter((item) => mature.has(monthKey(item)));
  const stale = matured.filter((item) => !isRegistered(item));

  // 걸린 날은 익은 달의 계약에서만 센다. 덜 익은 달에는 빨리 등기된 계약만 들어 있어서, 섞으면
  // 걸린 날이 짧게 나온다(생존 편향, DIRECTION 체크리스트 7) - 46일이 84일이 된 것이 그 차이다.
  const gaps = matured.filter(isRegistered).map(gapOf).filter((gap) => gap !== null);
  const byPrice = {};
  for (const band of GAP_BANDS) {
    const lower = GAP_BANDS[GAP_BANDS.indexOf(band) - 1]?.max ?? 0;
    const inBand = matured
      .filter((item) => isRegistered(item) && amountOf(item) > lower && amountOf(item) <= band.max)
      .map(gapOf)
      .filter((gap) => gap !== null);
    byPrice[band.key] = inBand.length >= MIN_DEALS ? { days: median(inBand), n: inBand.length } : { days: null, n: inBand.length };
  }

  // 미등기는 막 익은 달에 몰린다 - 80%를 겨우 넘긴 달에는 아직 20% 가까이가 등기 전이다. 그 한 달이 미등기의
  // 절반을 넘게 차지하면, 그 달을 뺀 비율을 같이 적는다(문턱을 바꾸면 결과에 맞추는 것이라 바꾸지 않는다, #34).
  const latest = [...mature].sort().at(-1);
  const staleLatest = latest ? stale.filter((item) => monthKey(item) === latest).length : 0;
  const maturedRest = matured.filter((item) => monthKey(item) !== latest);
  const staleRest = stale.length - staleLatest;
  const dominated = stale.length > 0 && staleLatest / stale.length > 0.5 && maturedRest.length > 0;

  return {
    medianDays: gaps.length ? median(gaps) : null,
    latestMature: dominated
      ? {
          month: latest,
          staleShareOfStale: Math.round((staleLatest / stale.length) * 1000) / 10,
          staleShareWithout: Math.round((staleRest / maturedRest.length) * 1000) / 10,
        }
      : null,
    byPrice,
    registered: gaps.length,
    matureMonths: [...mature].sort(),
    matured: matured.length,
    stale: stale.length,
    staleShare: matured.length ? Math.round((stale.length / matured.length) * 1000) / 10 : null,
  };
}

/** 계약월별 등기 완료율. 미등기가 시간의 함수라는 것을 이 곡선이 보여준다. */
export function registrationByMonth(items) {
  const months = new Map();

  for (const item of items ?? []) {
    if (isCancelled(item)) continue;
    const key = monthKey(item);
    if (!months.has(key)) months.set(key, { month: key, filed: 0, registered: 0 });
    const row = months.get(key);
    row.filed += 1;
    if (isRegistered(item)) row.registered += 1;
  }

  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, share: Math.round((row.registered / row.filed) * 1000) / 10 }));
}

/** 자치구별 해제율과 등기 지연율. 표본이 얇은 구는 비율을 말하지 않는다. */
export const MIN_DEALS = 100;

/**
 * 해제율은 itemsByDistrict(최근 여섯 달)에서, 미등기율은 registrationItems(원본 전체)에서 센다.
 * 익은 달은 계약 뒤 넉 달은 지나야 생겨서, 여섯 달 창 안에는 없을 수 있다 - 그날 이 표의 미등기율이
 * 전부 비고 문장이 "0건 가운데 0건(null%)"을 찍었다(#27).
 */
export function districtStats(itemsByDistrict, matureMonths = null, minDeals = MIN_DEALS, registrationItems = itemsByDistrict) {
  const rows = [];
  // 익은 달은 서울 전체에서 한 번 정하고 모든 구에 같이 적용한다. 구마다 따로
  // 정하면 어떤 구는 넉 달, 어떤 구는 두 달을 세게 되어 비율끼리 견줄 수 없다.
  const mature = matureMonths ? new Set(matureMonths) : null;

  // 해제 쪽(itemsByDistrict)이 비어도 등기 쪽에 거래가 있으면 그 구의 줄은 낸다 - 해제가 다 쌓인 달이
  // 아직 없는 날에도 미등기율은 말할 수 있다.
  const names = [...new Set([...Object.keys(itemsByDistrict ?? {}), ...Object.keys(registrationItems ?? {})])];
  for (const district of names) {
    const items = itemsByDistrict?.[district] ?? [];
    if (!items.length && !(registrationItems?.[district] ?? []).length) continue;
    const cancelled = items.filter(isCancelled).length;
    const scoped = mature ? (registrationItems?.[district] ?? []).filter((item) => mature.has(monthKey(item))) : items;
    const live = scoped.filter((item) => !isCancelled(item));
    const staleCount = live.filter((item) => !isRegistered(item)).length;
    const registration = mature
      ? { matured: live.length, stale: staleCount, staleShare: live.length ? Math.round((staleCount / live.length) * 1000) / 10 : null }
      : registrationStats(items);

    rows.push({
      district,
      deals: items.length,
      cancelled,
      cancelledShare: items.length >= minDeals ? Math.round((cancelled / items.length) * 1000) / 10 : null,
      matured: registration?.matured ?? 0,
      stale: registration?.stale ?? 0,
      staleShare: (registration?.matured ?? 0) >= minDeals ? registration.staleShare : null,
    });
  }

  return rows.sort((a, b) => (b.cancelledShare ?? -1) - (a.cancelledShare ?? -1) || a.district.localeCompare(b.district, "ko"));
}

export function cancellationTiming(items) {
  const gaps = [];
  for (const item of items ?? []) {
    if (!isCancelled(item)) continue;
    const gap = dayGap(dealDate(item), parseShortDate(item.cdealDay));
    if (gap !== null && gap > -10 && gap < 400) gaps.push(gap);
  }
  if (!gaps.length) return null;

  return {
    counted: gaps.length,
    medianDays: median(gaps),
    withinFilingWindow: Math.round((gaps.filter((g) => g <= 30).length / gaps.length) * 1000) / 10,
    overQuarter: Math.round((gaps.filter((g) => g > 90).length / gaps.length) * 1000) / 10,
  };
}

const monthLabel = (yearMonth) => `${String(yearMonth).slice(0, 4)}.${String(yearMonth).slice(4, 6)}`;

/**
 * 첫 문단. 전세·월세 화면과 같이 빌드에서 두 언어를 미리 만들어 넘긴다.
 * 해제가 최고가였는지는 세어 본 결과대로만 말한다 - 그 편이 흔한 이야기와
 * 어긋나더라도 그렇다.
 */
export function leadSentence({ deals, cancelled, timing, standing, months }, locale = "ko") {
  if (!deals || !cancelled) return null;

  const share = Math.round((cancelled / deals) * 1000) / 10;
  const span = months?.length ? `${monthLabel(months[0])}~${monthLabel(months[months.length - 1])}` : "";

  if (locale === "en") {
    const verdict = !standing
      ? ""
      : standing.higherShare > standing.lowerShare + 10
        ? ` Cancelled deals do skew high: ${standing.higherShare}% sat above the median of what remained in the same complex and floor area, against ${standing.lowerShare}% below.`
        : ` They are not the top prints people assume: ${standing.higherShare}% sat above the median of what remained in the same complex and floor area, while ${standing.lowerShare}% sat below.`;
    return (
      `Of ${deals.toLocaleString("en-US")} filed sales${span ? ` in ${span}` : ""}, ${cancelled.toLocaleString("en-US")} were later cancelled — ${share}%.` +
      (timing
        ? ` Half of them were undone within ${timing.medianDays} days${timing.medianDays <= 30 ? ", inside the 30-day filing window" : ", just past the 30-day filing window"}.`
        : "") +
      verdict
    );
  }

  const verdict = !standing
    ? ""
    : standing.higherShare > standing.lowerShare + 10
      ? ` 해제된 거래는 실제로 비싼 축이다 — 같은 단지 같은 면적에 남은 거래의 중앙값보다 높았던 것이 ${standing.higherShare}%, 낮았던 것이 ${standing.lowerShare}%다.`
      : ` 흔히 말하는 것과 달리 해제 거래가 그 단지 최고가인 것은 아니다 — 같은 단지 같은 면적에 남은 거래의 중앙값보다 높았던 것이 ${standing.higherShare}%인 반면, 낮았던 것이 ${standing.lowerShare}%로 오히려 더 많다.`;

  return (
    `${span ? `${span} ` : ""}신고된 매매 ${deals.toLocaleString("ko-KR")}건 가운데 ${cancelled.toLocaleString("ko-KR")}건이 나중에 해제됐다. ${share}%다.` +
    (timing
        ? ` 절반은 ${timing.medianDays}일 안에 지워졌다${timing.medianDays <= 30 ? " — 신고 기한 30일 안이다" : " — 신고 기한 30일을 조금 넘긴 때다"}.`
        : "") +
    verdict
  );
}

const ko = (n) => n.toLocaleString("ko-KR");
const en = (n) => n.toLocaleString("en-US");

/** 등기 절의 첫 문장. 익은 달이 없으면 그렇다고 적는다 - null을 숫자처럼 찍지 않는다. */
export function registrationSentence(reg, locale = "ko") {
  if (!reg) return null;
  if (!reg.matured || reg.medianDays === null) {
    return locale === "en"
      ? "No contract month has matured yet (80% of its deals registered), so neither the time to registration nor the late-registration share can be stated."
      : "아직 익은 달(그 달 계약의 열에 여덟이 등기를 마친 달)이 없어 등기까지 걸린 날과 늦은 등기 비율을 말할 수 없습니다.";
  }
  const band = (key, label) => {
    const b = reg.byPrice?.[key];
    return b?.days !== null && b?.days !== undefined ? `${label} ${b.days}${locale === "en" ? " days" : "일"}` : null;
  };
  const bands =
    locale === "en"
      ? [band("upTo6", "up to ₩600M"), band("upTo15", "₩0.6–1.5B"), band("upTo25", "₩1.5–2.5B"), band("over25", "above ₩2.5B")]
      : [band("upTo6", "6억 이하"), band("upTo15", "6억~15억"), band("upTo25", "15억~25억"), band("over25", "25억 넘으면")];
  const listed = bands.filter(Boolean);
  return locale === "en"
    ? `Counting only matured months, half of all deals were registered within ${reg.medianDays} days of signing` +
        (listed.length ? ` (${listed.join(", ")})` : "") +
        `. Registration follows the final payment, so this is roughly how long the gap between contract and final payment runs. ` +
        `Of the ${en(reg.matured)} deals in matured months, ${en(reg.stale)} (${reg.staleShare}%) are still unregistered.` +
        (reg.latestMature
          ? ` Most of those (${reg.latestMature.staleShareOfStale}%) come from ${reg.latestMature.month}, a month that has only just matured; without it the share is ${reg.latestMature.staleShareWithout}%.`
          : "")
    : `익은 달의 계약만 놓고 보면 계약에서 등기까지 절반이 ${reg.medianDays}일 안에 끝났습니다` +
        (listed.length ? `(${listed.join(", ")})` : "") +
        `. 등기는 잔금을 치른 뒤에 하므로, 대략 계약에서 잔금까지 그만큼 잡는다는 뜻입니다. ` +
        `익은 달의 계약 ${ko(reg.matured)}건 가운데 ${ko(reg.stale)}건(${reg.staleShare}%)이 아직 등기를 마치지 않았습니다.` +
        (reg.latestMature
          ? ` 다만 그 미등기의 ${reg.latestMature.staleShareOfStale}%가 막 익은 ${reg.latestMature.month.replace("-", "년 ").replace(/년 0?/, "년 ")}월 한 달에서 나옵니다 — 그 달을 빼면 ${reg.latestMature.staleShareWithout}%입니다.`
          : "");
}

/**
 * 정정 재신고 문장. 해제 신고 가운데 몇이 정정이었고, 그 다시 신고된 거래가 등기까지 갔는지.
 * 등기 비율은 익은 달(registration.matureMonths)의 계약에서만 센다 - 덜 익은 달은 아직 등기 전이다.
 */
export function correctionStats(allCancelled, corrections, matureMonths) {
  if (!allCancelled) return null;
  const mature = new Set(matureMonths ?? []);
  const inMature = corrections.filter((c) => mature.has(monthKey(c.item)));
  return {
    reported: allCancelled,
    corrections: corrections.length,
    share: Math.round((corrections.length / allCancelled) * 1000) / 10,
    matured: inMature.length,
    registeredShare: inMature.length ? Math.round((inMature.filter((c) => isRegistered(c.twin)).length / inMature.length) * 1000) / 10 : null,
  };
}

export function correctionSentence(c, locale = "ko") {
  if (!c?.corrections) return null;
  const reg = c.registeredShare;
  return locale === "en"
    ? `Of ${en(c.reported)} cancellation filings, ${en(c.corrections)} (${c.share}%) were the same contract filed again unchanged — a correction to the filing, not a broken deal.` +
        (reg !== null ? ` In months old enough to have registered, ${reg}% of those re-filed contracts went on to registration.` : "") +
        ` They are left out of every cancellation figure on this page.`
    : `해제 신고 ${ko(c.reported)}건 가운데 ${ko(c.corrections)}건(${c.share}%)은 같은 계약이 그대로 다시 신고된 것입니다 — 계약이 깨진 것이 아니라 신고를 고친 것입니다.` +
        (reg !== null ? ` 등기할 시간이 지난 달만 보면 그 다시 신고된 계약의 ${reg}%가 등기까지 마쳤습니다.` : "") +
        ` 이 화면의 해제 숫자는 모두 이것을 빼고 셉니다.`;
}
