import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.RATES_OUT_DIR
  ? path.resolve(process.env.RATES_OUT_DIR)
  : path.resolve(import.meta.dirname, "../docs/data");
const outFile = path.join(dataDir, "rates.json");
const historyFile = path.join(dataDir, "rates-history.json");
const metaFile = path.join(dataDir, "rates-meta.json");
const HISTORY_MAX_DAYS = 180;

const API_KEY = process.env.FSS_FINLIFE_API_KEY;

const API_BASE = process.env.FSS_API_BASE ?? "https://finlife.fss.or.kr/finlifeapi";

const USER_AGENT = "Mozilla/5.0 (compatible; jipgye/1.0)";

const BANK = "020000";
const SAVINGS_BANK = "030300";

const SECTOR_BY_GROUP = { [BANK]: "bank", [SAVINGS_BANK]: "savingsBank" };

const CATEGORIES = [
  { key: "deposit", endpoint: "depositProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "saving", endpoint: "savingProductsSearch", groups: [BANK, SAVINGS_BANK], kind: "saving" },
  { key: "mortgage", endpoint: "mortgageLoanProductsSearch", groups: [BANK], kind: "loan" },
  { key: "rentLoan", endpoint: "rentHouseLoanProductsSearch", groups: [BANK], kind: "loan" },
];

const MAX_PAGES = 20;

// 네 상품군이 전부 실패했을 때 스크립트가 끝나는 코드. 1(키 없음 등 그 밖의 오류)과 구분한다.
// 워크플로는 이 단계를 continue-on-error로 돌리고, 원본 커밋·배포가 끝난 뒤에 job을 실패로 끝낸다(#107).
const EXIT_ALL_FAILED = 3;

// 진단 로그에 응답 본문·URL·오류 메시지가 들어가므로 인증키 값은 찍기 전에 치환한다.
// 서버가 요청 URL(auth=키)을 본문에 에코할 수 있고, 인코딩된 꼴로 오는 경우도 있다.
// GitHub 시크릿 마스킹에만 기대지 않는다 - rates-meta.json은 커밋돼 공개된다.
function mask(text) {
  let out = String(text ?? "");
  if (!API_KEY) return out;
  for (const k of new Set([API_KEY, encodeURIComponent(API_KEY)])) out = out.split(k).join("***");
  return out;
}

const BODY_PREVIEW_CHARS = 200;

function kstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

// 연결이 안 되거나 서버가 5xx를 주는 것은 잠깐 뒤에 다시 부르면 풀리는 일이 있다.
// 2026-10-03에는 네 상품군이 전부 연결 단계에서 ~10초 만에 끊겼다(#62). 인증키·응답
// 형식 오류는 다시 불러도 같으므로 재시도하지 않는다.
const RETRY_DELAYS_MS = (process.env.RATES_RETRY_DELAYS_MS ?? "30000,120000")
  .split(",")
  .filter((v) => v !== "")
  .map(Number);

function connectionError(message, cause) {
  const err = new Error(message);
  err.connection = true;
  err.code = cause;
  return err;
}

async function withRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!err.connection || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = RETRY_DELAYS_MS[attempt];
      console.warn(`[fetch-rates] ${label}: ${err.message} - ${wait / 1000}초 뒤 다시 (${attempt + 1}/${RETRY_DELAYS_MS.length})`);
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

async function fetchPage(endpoint, topFinGrpNo, pageNo) {
  return withRetry(`${endpoint}/${topFinGrpNo} p${pageNo}`, () => fetchPageOnce(endpoint, topFinGrpNo, pageNo));
}

async function fetchPageOnce(endpoint, topFinGrpNo, pageNo) {
  const url = `${API_BASE}/${endpoint}.json?auth=${API_KEY}&topFinGrpNo=${topFinGrpNo}&pageNo=${pageNo}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    const code = err.cause?.code ?? err.cause?.name ?? "FETCH_FAILED";
    throw connectionError(`연결 실패 ${code}`, code);
  }
  if (res.status >= 500) throw connectionError(`http ${res.status}`, `HTTP_${res.status}`);
  const contentType = res.headers.get("content-type") ?? "없음";
  const text = await res.text();
  // 200인데 JSON이 아닌 응답(2026-10-09, HTML)이 원인 규명 없이 SyntaxError로만 남았다(#107).
  // 상태 코드·content-type·본문 앞부분을 남겨 키 문제/차단/엔드포인트 변경을 가릴 수 있게 한다.
  const diagnose = (what) => {
    const err = new Error(`${what} (http ${res.status}, ${contentType})`);
    err.diagnostic = `http ${res.status} · content-type ${contentType} · 본문 앞 ${BODY_PREVIEW_CHARS}자: ${mask(text).slice(0, BODY_PREVIEW_CHARS).replace(/\s+/g, " ")}`;
    return err;
  };
  if (!res.ok) throw diagnose("http 오류 응답");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const html = /html/i.test(contentType) || /^\s*</.test(text);
    throw diagnose(html ? "JSON이 아닌 HTML 응답" : "JSON이 아닌 응답");
  }
  const result = json?.result;
  if (!result) throw new Error("result 필드 없음");
  if (result.err_cd && result.err_cd !== "000") {
    throw new Error(`API 오류 ${result.err_cd}: ${result.err_msg ?? ""}`.trim());
  }
  return result;
}

async function fetchAllPages(endpoint, topFinGrpNo) {
  const baseList = [];
  const optionList = [];
  let disclosureMonth = null;

  let pageNo = 1;
  let maxPageNo = 1;
  while (pageNo <= maxPageNo && pageNo <= MAX_PAGES) {
    const result = await fetchPage(endpoint, topFinGrpNo, pageNo);
    baseList.push(...(result.baseList ?? []));
    optionList.push(...(result.optionList ?? []));
    disclosureMonth ??= result.baseList?.[0]?.dcls_month ?? null;

    const reported = toNumber(result.max_page_no);
    if (pageNo === 1 && reported && reported > 1) maxPageNo = reported;
    if (reported && reported > MAX_PAGES) {
      console.warn(
        `[fetch-rates] ${endpoint}/${topFinGrpNo}: max_page_no=${reported}인데 ${MAX_PAGES}페이지까지만 수집`
      );
    }
    pageNo += 1;
  }

  return { baseList, optionList, disclosureMonth };
}

function joinProducts({ baseList, optionList, sectorByProduct }, kind) {
  const optionsByProduct = new Map();
  for (const opt of optionList) {
    const id = `${opt.fin_co_no}:${opt.fin_prdt_cd}`;
    if (!optionsByProduct.has(id)) optionsByProduct.set(id, []);
    optionsByProduct.get(id).push(kind === "saving" ? savingOption(opt) : loanOption(opt));
  }
  if (kind === "saving") {
    for (const [id, options] of optionsByProduct) {
      optionsByProduct.set(id, dedupeSavingOptions(options));
    }
  }

  const products = [];
  for (const base of baseList) {
    const id = `${base.fin_co_no}:${base.fin_prdt_cd}`;
    const options = (optionsByProduct.get(id) ?? []).filter(Boolean);
    if (options.length === 0) continue;
    products.push({
      id,
      sector: sectorByProduct.get(id) ?? "bank",
      company: clean(base.kor_co_nm),
      name: clean(base.fin_prdt_nm),
      joinWay: clean(base.join_way),
      ...(kind === "saving"
        ? {
            joinDeny: clean(base.join_deny),
            joinMember: clean(base.join_member),
            maxLimit: toNumber(base.max_limit),
            spclCnd: clean(base.spcl_cnd),
            mtrtInt: clean(base.mtrt_int),
          }
        : {
            loanInciExpn: clean(base.loan_inci_expn),
            erlyRpayFee: clean(base.erly_rpay_fee),
            dlyRate: clean(base.dly_rate),
            loanLmt: clean(base.loan_lmt),
          }),
      options,
    });
  }
  return products;
}

function dedupeSavingOptions(options) {
  const bestByTerm = new Map();
  for (const opt of options) {
    if (!opt) continue;
    const key = opt.term;
    const current = bestByTerm.get(key);
    const rate = opt.maxRate ?? opt.rate ?? -Infinity;
    const currentRate = current ? current.maxRate ?? current.rate ?? -Infinity : -Infinity;
    if (!current || rate > currentRate) bestByTerm.set(key, opt);
  }
  return [...bestByTerm.values()].sort((a, b) => (a.term ?? 0) - (b.term ?? 0));
}

function savingOption(opt) {
  const term = toNumber(opt.save_trm);
  const rate = toNumber(opt.intr_rate);
  const maxRate = toNumber(opt.intr_rate2);
  if (term === null && rate === null && maxRate === null) return null;
  return {
    term,
    rateTypeName: clean(opt.intr_rate_type_nm),
    rate,
    maxRate,
  };
}

function loanOption(opt) {
  const min = toNumber(opt.lend_rate_min);
  const max = toNumber(opt.lend_rate_max);
  const avg = toNumber(opt.lend_rate_avg);
  if (min === null && max === null && avg === null) return null;
  return {
    mortgageType: clean(opt.mrtg_type_nm),
    repayType: clean(opt.rpay_type_nm),
    rateType: clean(opt.lend_rate_type_nm),
    min,
    max,
    avg,
  };
}

function bestSavingAt(products, term, sector) {
  let best = null;
  for (const product of products) {
    if (sector && product.sector !== sector) continue;
    for (const opt of product.options) {
      if (opt.term !== term) continue;
      const rate = opt.maxRate ?? opt.rate;
      if (rate === null) continue;
      if (!best || rate > best.rate) {
        best = { rate, baseRate: opt.rate, company: product.company, name: product.name };
      }
    }
  }
  return best;
}

function lowestLoan(products) {
  let best = null;
  for (const product of products) {
    for (const opt of product.options) {
      const rate = opt.avg ?? opt.min;
      if (rate === null) continue;
      if (!best || rate < best.rate) {
        best = { rate, company: product.company, name: product.name, rateType: opt.rateType };
      }
    }
  }
  return best;
}

async function fetchCategory(category) {
  const merged = { baseList: [], optionList: [], disclosureMonth: null, sectorByProduct: new Map() };
  for (const group of category.groups) {
    const part = await fetchAllPages(category.endpoint, group);
    for (const base of part.baseList) {
      merged.sectorByProduct.set(`${base.fin_co_no}:${base.fin_prdt_cd}`, SECTOR_BY_GROUP[group]);
    }
    merged.baseList.push(...part.baseList);
    merged.optionList.push(...part.optionList);
    merged.disclosureMonth ??= part.disclosureMonth;
  }
  return {
    disclosureMonth: merged.disclosureMonth,
    products: joinProducts(merged, category.kind),
  };
}

async function main() {
  if (!API_KEY) throw new Error("FSS_FINLIFE_API_KEY 환경변수가 필요합니다");

  const now = new Date();
  const today = kstDateString(now);

  const meta = await readMeta();
  if (process.env.RATES_FORCE !== "1" && meta.lastFetchedDate === today) {
    console.log(`[fetch-rates] 오늘(${today}) 이미 조회함 - 건너뜀 (다시 받으려면 RATES_FORCE=1)`);
    return;
  }

  let previous = {};
  try {
    previous = JSON.parse(await readFile(outFile, "utf-8"));
  } catch {
  }

  const result = {};
  let disclosureMonth = null;
  let failed = 0;
  let succeeded = 0;
  let hostDown = null;
  let failCause = null;

  for (const category of CATEGORIES) {
    // 첫 상품군이 재시도까지 다 연결에 실패했으면 같은 호스트다 - 나머지를 같은
    // 시간만큼 더 기다려 봐야 같은 답이 온다.
    if (hostDown) {
      failed += 1;
      console.warn(`[fetch-rates] ${category.key}: 호스트 연결 실패(${hostDown})로 건너뜀`);
      result[category.key] = previous[category.key] ?? [];
      continue;
    }
    try {
      const { products, disclosureMonth: month } = await fetchCategory(category);

      const kept = previous[category.key] ?? [];
      if (products.length === 0 && kept.length > 0) {
        failed += 1;
        failCause ??= "EMPTY";
        console.warn(
          `[fetch-rates] ${category.key}: 0건으로 왔다 - 지난번 ${kept.length}건을 그대로 둔다`
        );
        result[category.key] = kept;
        continue;
      }

      result[category.key] = products;
      succeeded += 1;
      disclosureMonth ??= month;
      console.log(`[fetch-rates] ${category.key}: 상품 ${products.length}건`);
    } catch (err) {
      failed += 1;
      failCause ??= mask(err.code ?? err.message);
      console.error(`[fetch-rates] ${category.key} 실패: ${mask(err.message)}`);
      if (err.diagnostic) console.error(`[fetch-rates] ${category.key} 진단: ${mask(err.diagnostic)}`);
      result[category.key] = previous[category.key] ?? [];
      if (err.connection && succeeded === 0) hostDown = err.code;
    }
  }

  // 전부 실패하면 어제 값을 그대로 두고 실패를 경고와 메타 파일로 남긴 뒤, 코드 3으로
  // 끝낸다(#107). 이전에는 0으로 끝내 full이 success로 보였고 낡은 금리가 이틀째 실렸다.
  // 이 단계의 실패가 뒤 단계를 막으면 같은 실행에서 받은 실거래 원본까지 버려지므로
  // (2026-10-03, 175슬롯·1,724건 - #62) 워크플로가 이 단계를 continue-on-error로 돌리고,
  // 원본 커밋·배포가 끝난 뒤 마지막 단계에서 job을 실패로 만든다. 며칠째 어제 값인지는
  // 점검 봇이 본다 - 날짜에 따라 갈리는 검사를 여기 두면 배포가 멈춘다(#8).
  if (failed === CATEGORIES.length) {
    const cause = failCause ?? "알 수 없음";
    await mkdir(dataDir, { recursive: true });
    await writeFile(metaFile, JSON.stringify({ ...meta, lastFailedAt: now.toISOString(), failCause: cause }));
    console.log(
      `::warning::금리 수집 실패(금감원 finlife) - 원인 ${cause}, 마지막 성공 ${meta.lastFetchedDate ?? "없음"}. 기존 금리를 그대로 둔다`
    );
    process.exitCode = EXIT_ALL_FAILED;

    return;
  }

  const payload = {
    updatedAt: now.toISOString(),
    disclosureMonth: disclosureMonth ?? previous.disclosureMonth ?? null,
    ...result,
  };

  await mkdir(dataDir, { recursive: true });

  if (sameContent(previous, payload)) {
    console.log("[fetch-rates] 공시 내용 변화 없음 - rates.json 그대로 둠");
  } else {
    await writeFile(outFile, JSON.stringify(payload));
  }

  await appendHistory(now, result);

  await writeFile(metaFile, JSON.stringify({ lastFetchedDate: today, lastFetchedAt: now.toISOString() }));

  console.log(`[fetch-rates] 저장 완료 (실패 ${failed}/${CATEGORIES.length})`);
}

async function readMeta() {
  try {
    return JSON.parse(await readFile(metaFile, "utf-8"));
  } catch {
    return {};
  }
}

function sameHistoryValue(a, b) {
  const withoutDate = ({ date, ...rest }) => JSON.stringify(rest);
  return withoutDate(a) === withoutDate(b);
}

function sameContent(a, b) {
  const withoutTimestamp = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  return withoutTimestamp(a) === withoutTimestamp(b);
}

async function appendHistory(now, result) {
  let history = [];
  try {
    history = JSON.parse(await readFile(historyFile, "utf-8"));
  } catch {
  }

  const entry = {
    date: kstDateString(now),
    deposit12: {
      bank: bestSavingAt(result.deposit ?? [], 12, "bank"),
      savingsBank: bestSavingAt(result.deposit ?? [], 12, "savingsBank"),
    },
    saving12: {
      bank: bestSavingAt(result.saving ?? [], 12, "bank"),
      savingsBank: bestSavingAt(result.saving ?? [], 12, "savingsBank"),
    },
    mortgage: lowestLoan(result.mortgage ?? []),
    rentLoan: lowestLoan(result.rentLoan ?? []),
  };

  const idx = history.findIndex((h) => h.date === entry.date);
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    const last = history[history.length - 1];
    if (last && sameHistoryValue(last, entry)) {
      console.log("[fetch-rates] 대표 금리 변화 없음 - 히스토리 추가 생략");
      return;
    }
    history.push(entry);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_MAX_DAYS) {
    history = history.slice(history.length - HISTORY_MAX_DAYS);
  }

  await writeFile(historyFile, JSON.stringify(history, null, 2));
}

main().catch((err) => {
  console.error(`[fetch-rates] ${mask(err.message)}`);
  process.exit(1);
});
