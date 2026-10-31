import { readFile } from "node:fs/promises";
import path from "node:path";
import { accessibleTables } from "./table-a11y.ts";
import { bilingualCells, hangulCount } from "./bilingual-cell.ts";
import { moveInDistrictTableHtml } from "./move-in.ts";
import { nowcastSentence, nowcastTableHtml } from "./outlook.ts";
import { createReactRenderer } from "./render/react.ts";
import { createWriteSet } from "./render-writes.ts";
import { escapeHtml } from "./html-escape.ts";
import { sourcesMarkup } from "./summary-note.ts";
import { CONVERSION_BAND } from "./district-tables.ts";
import { budgetBandLabel } from "./budget-fragments.ts";
import { MIN_SAMPLE } from "./realestate-format.ts";
import { stripInlineScriptComments } from "./strip-inline-comments.ts";
import { stampSources } from "./source-lines.ts";
import { requireSite, siteLabel, sitePath } from "./site-dir.ts";
import { collectStatus } from "./check-data-progress.ts";
import { digestHtml } from "./week-digest-view.ts";
import { districtBarsHtml } from "./district-bars.ts";
import { registrationEnHtml, registrationView } from "./registration-view.ts";

const root = path.resolve(import.meta.dirname, "..");

// 시세 장은 틀(scripts/)과 나가는 장(docs/)으로 갈라져 있다(#374). 틀에는 "왜"를 마음껏 적고,
// 이 파일이 틀을 채운 뒤 인라인 스크립트의 주석을 떼어 docs/realestate.html 로 낸다. 두 빌더(build-realestate-pages·build-budget-pages)도
// 같은 틀을 읽는다. docs/realestate.html 은 생성물이라 손으로 고치지 않는다.
export const REALESTATE_TEMPLATE_PATH = path.join(root, "scripts/realestate-template.html");
const DATA_DIR = path.join(root, "docs/data");

// 표본 문턱은 realestate-format.mjs의 것 하나다(예전엔 여기에도 하나 더 있었다). 이 모듈에서 import하던 쪽을 위해 다시 내보낸다.
export { MIN_SAMPLE };
// MAX_DISTRICTS(첫 화면에 그리는 자치구 수)는 칸·정렬 규칙과 함께 realestate-rows.mjs로 옮겼다(JSX 쪽 조각과 같이 쓴다, #241 PR 3).

// escapeHtml은 순수 모듈로 옮겼다(JSX 쪽 조각과 같이 쓴다, #241 PR 2). 다른 모듈이 여기서 import하던 이름은 그대로 둔다.
export { escapeHtml };

// 조각 함수(`*Html()`)는 전부 React 로 그린다(#248 P3 - 문자열 legacy 본문과 렌더러 스위치를 지웠다). 마크업은 render/entry.jsx 의 `fragments` 에 있고,
// 여기의 이름 하나하나는 그 조각을 같은 이름·같은 인자로 부르는 래퍼다. 모듈 최상위에서 await 한다: 조각 함수는 동기라 로더(비동기)가 import 시점에 끝나 있어야 한다.
// 그래서 `npm ci`(react·react-dom·esbuild) 없이 이 모듈을 import 하면 import 에서 던진다. 로더·진입 모듈·조각 렌더의 오류는 삼키지 않고 올라간다.
const react = await createReactRenderer();

/** 조각 래퍼. 진입 모듈에 없는 이름이면 import 때 던진다(오타가 조용히 빈 자리가 되지 않게). */
const fragment = (name: string) => {
  if (!react.has(name)) throw new Error(`render/entry.jsx 의 fragments 에 ${name} 이 없습니다`);
  const wrapped = (...args) => react.render(name, args);
  Object.defineProperty(wrapped, "name", { value: name });
  return wrapped;
};

export const marketHtml = fragment("marketHtml");
export const realestateHtml = fragment("realestateHtml");
export const newsContextHtml = fragment("newsContextHtml");
export const newsHtml = fragment("newsHtml");
export const budgetBodyHtml = fragment("budgetBodyHtml");
export const budgetAnswersHtml = fragment("budgetAnswersHtml");
export const budgetMoreHtml = fragment("budgetMoreHtml");
export const budgetMinCashHtml = fragment("budgetMinCashHtml");
export const budgetPolicyHtml = fragment("budgetPolicyHtml");
export const budgetCapHtml = fragment("budgetCapHtml");
export const budgetCandidatesHtml = fragment("budgetCandidatesHtml");
export const budgetCostsHtml = fragment("budgetCostsHtml");
export const budgetFactsHtml = fragment("budgetFactsHtml");
export const budgetLoanHtml = fragment("budgetLoanHtml");
export const newsRealestateStatsHtml = fragment("newsRealestateStatsHtml");
export const newsKospiHtml = fragment("newsKospiHtml");
export const newsSummaryHtml = fragment("newsSummaryHtml");
export const newsListHtml = fragment("newsListHtml");
export const realestateHeadHtml = fragment("realestateHeadHtml");
export const realestateTableHtml = fragment("realestateTableHtml");
export const realestateOverallHtml = fragment("realestateOverallHtml");
export const districtSummaryHtml = fragment("districtSummaryHtml");
export const districtRenewalHtml = fragment("districtRenewalHtml");
export const districtFactsHtml = fragment("districtFactsHtml");
export const districtRentFlowHtml = fragment("districtRentFlowHtml");
export const districtMoveInHtml = fragment("districtMoveInHtml");
export const districtResaleHtml = fragment("districtResaleHtml");
export const districtLinksHtml = fragment("districtLinksHtml");
export const conversionLeadHtml = fragment("conversionLeadHtml");
export const conversionTableHtml = fragment("conversionTableHtml");
export const conversionDistrictLinksHtml = fragment("conversionDistrictLinksHtml");
export const cancelLeadHtml = fragment("cancelLeadHtml");
export const cancelMonthLeadHtml = fragment("cancelMonthLeadHtml");
export const cancelDistrictsHtml = fragment("cancelDistrictsHtml");
export const cancelMonthsHtml = fragment("cancelMonthsHtml");
export const cancelDistrictLinksHtml = fragment("cancelDistrictLinksHtml");
export const renewalLeadHtml = fragment("renewalLeadHtml");
export const renewalCapLeadHtml = fragment("renewalCapLeadHtml");
export const renewalDistrictsHtml = fragment("renewalDistrictsHtml");
export const renewalWolseLeadHtml = fragment("renewalWolseLeadHtml");
export const renewalWolseDistrictsHtml = fragment("renewalWolseDistrictsHtml");
export const renewalDistrictLinksHtml = fragment("renewalDistrictLinksHtml");
export const floorDistrictsHtml = fragment("floorDistrictsHtml");
export const floorDistrictLinksHtml = fragment("floorDistrictLinksHtml");
export const repeatSalesHtml = fragment("repeatSalesHtml");
export const segmentChangeHtml = fragment("segmentChangeHtml");

// 다른 모듈이 여기서 import 하던 이름은 그대로 다시 내보낸다(예산대 이름은 budget-fragments.ts, 전환율 구간은 district-tables.ts).
export { budgetBandLabel, CONVERSION_BAND };

/** applyPrerender 를 안 지나는 장 중 출처 줄 자리표시가 있는 장(#588). 표를 손대지 않으려고 accessibleTables 길에 넣지 않는다. */
export const SOURCE_ONLY_PAGES = ["about.html", "deal-search.html"];

export function applyPrerender(html, blocks) {
  let out = html;
  for (const [name, content] of Object.entries(blocks)) {
    const open = `<!--prerender:${name}-->`;
    const close = `<!--/prerender:${name}-->`;
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`${name} 자리표시 주석을 찾지 못했습니다. 대상 HTML에서 마커가 지워졌는지 확인해주세요.`);
    }
    if (content == null) continue;
    out = `${out.slice(0, start + open.length)}${content}${out.slice(end)}`;
  }
  // 안내 링크 쌍(#462)은 시세 장만 4주 문단 앵커로 간다. 예산대 장(<meta name="budget-band">)은 두 링크 모두 맨 위(method.html)로 둔다.
  if (out.includes('<meta name="budget-band"')) out = out.replace(/(href="\.\/method\.html)#four-weeks(?:-en)?"/g, '$1"');
  // 출처 줄 자리표시({{src:<id>.ko|en}}, #588)는 모든 장이 지나는 여기서 한 번에 꽂는다. 글자는 scripts/source-lines.ts 한 곳이다.
  out = stampSources(out);
  // 틀에 손으로 쓴 표와 빌더가 채운 표가 모두 이 길을 지나므로 머리글 방향·표 이름은 여기서 한 번에 단다.
  return accessibleTables(out);
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  // 읽고 쓰는 장의 디렉터리. 기본은 docs/ 이고, JIPGYE_SITE_DIR 이 있으면 그 디렉터리의 복사본이다(#508, scripts/site-dir.ts). 데이터는 어느 쪽이든 docs/data 다.
  requireSite();
  const at = (rel) => sitePath(rel);
  const label = (rel) => siteLabel(rel);
  const [summary, market, realestate, news] = await Promise.all(
    ["summary", "market", "realestate", "news"].map(readJson)
  );

  const blocks = {
    market: marketHtml(market),
    realestate: realestateHtml(realestate),
    news: newsHtml(news),
    // 자치구 가격 막대(#745 PR8): 메인 시세 구역 끝에는 매매 막대 한 벌과 시세 장 전체 보기 링크만 굽는다.
    districtBars: districtBarsHtml(realestate, { variant: "home" }),
  };

  const conversion = await readJson("conversion");
  const cancellation = await readJson("cancellation");
  const direct = await readJson("direct-deals");
  const registration = registrationView(await readJson("registration"));
  const renewal = await readJson("renewal-facts");
  const floor = await readJson("floor-gap");
  const moveIn = await readJson("move-in");
  const outlook = await readJson("outlook");
  const indicators = await readJson("outlook-indicators");
  // 전망의 문장과 표는 빌더가 두 언어로 다 만들어 둔다. 여기서는 한국어를 꽂기만 한다.
  const outlookText = (key) => (outlook?.[key]?.ko ? escapeHtml(outlook[key].ko) : null);
  // 메울 달 0개(#801): 이 코드 전에 구운 json 은 nowcast 표·문장이 null 이다. 데이터를 다시 굽지 않아도 json 의 regions 로 자리표시를 지금 만든다
  // (빌더와 같은 함수 - 다음 데일리가 json 에 같은 것을 넣는다).
  const nowcastTable = outlook?.tables?.nowcast?.ko
    ? outlook.tables.nowcast
    : { ko: nowcastTableHtml(outlook?.regions ?? [], "ko"), en: nowcastTableHtml(outlook?.regions ?? [], "en") };
  const nowcastFallback = nowcastSentence(outlook?.regions?.find((r) => r.code === "200"), "ko");
  const nowcastLead = outlookText("nowcastLead") ?? (nowcastFallback ? escapeHtml(nowcastFallback) : null);
  const record = await readJson("record-high");
  const change = await readJson("district-change");
  const repeat = await readJson("repeat-sales");
  const segment = await readJson("segment-change");
  const recordText = (key) => (record?.[key]?.ko ? escapeHtml(record[key].ko) : null);
  // 표 칸은 한국어·영어 두 벌로 굽는다(#708) — 데이터를 받기 전·못 받았을 때 영어 화면에 한국어 표가 남지 않게. 바이트 때문에 칸을 고른다(장당 +4KB).
  const both = (table, pick?) => bilingualCells(table?.ko, table?.en, pick);
  // E1b ①(#708): 칸마다 두 벌 껍데기(약 52 B)가 들어 한글이 적은 칸은 글자당 비싸다 — 지표 표는 한글이 긴 칸(이름 ≥10자·판정 ≥12자)만 굽는다.
  const wide = (c, min) => hangulCount(c.inner) >= min;
  const indicatorPick = (c) => c.section === "thead" || (c.col === 0 && wide(c, 10)) || (c.col === 3 && wide(c, 12));
  const headOnly = (c) => c.section === "thead";
  // 구×반기 입주 표: json 의 영어 조각은 자치구 이름이 아직 한글인 채 구워진 것(다음 데일리가 새로 굽는다)이라, 숫자(byDistrict)로 두 벌을 지금 다시 만든다.
  const moveInDistrictsHtml = (m) =>
    m?.byDistrict?.rows?.length
      ? bilingualCells(
          moveInDistrictTableHtml(m.byDistrict, m.basis, "ko"),
          moveInDistrictTableHtml(m.byDistrict, m.basis, "en"),
          (c) => c.section === "thead" || (c.section === "tbody" && c.col === 0)
        )
      : (m?.districtTable?.ko ?? null);
  // method 「수집 상태」 줄: full 실행 기록(market-history). 없으면 줄을 안 그린다.
  const collect = collectStatus(await readJson("market-history"));
  const weekDigest = await readJson("week-digest");
  const sources = sourcesMarkup(summary, null, news);

  const writes = createWriteSet();
  // 넷째 칸(선택)은 틀 경로다. 있으면 path_ 는 나가는 장이고, 틀을 채운 뒤 인라인 스크립트 주석을 떼어 path_ 에 쓴다(#374).
  for (const [file, path_, fileBlocks, templatePath] of [
    [label("index.html"), at("index.html"), blocks],
    [
      label("news.html"),
      at("news.html"),
      // 이번 주 새 신고(#703 W1): 데이터가 없으면 키를 넣지 않는다 - 틀의 빈 자리를 그대로 두고, 자리표시 없는 틀(시험 고정 틀)도 던지지 않는다.
      // 요약 근거 기사(#745 PR6)도 같다 - 근거가 없으면 키를 넣지 않는다.
      { newsSummary: newsSummaryHtml(summary), newsList: newsListHtml(news), ...(sources ? { newsSources: sources } : {}), ...(weekDigest ? { weekDigest: digestHtml(weekDigest) } : {}) },
    ],
    [
      label("realestate.html"),
      at("realestate.html"),
      {
        realestateOverall: realestateOverallHtml(realestate),
        realestateHead: realestateHeadHtml(),
        realestateTable: realestateTableHtml(realestate),
        districtBars: districtBarsHtml(realestate),
        districtLinks: "",
        districtSummaryKo: "",
        districtSummaryEn: "",
        districtFactsKo: "",
        districtFactsEn: "",
        districtRenewalKo: "",
        districtRenewalEn: "",
        districtRentFlowKo: "",
        districtRentFlowEn: "",
        districtMoveInKo: "",
        districtMoveInEn: "",
        districtResaleKo: "",
        districtResaleEn: "",
      },
      REALESTATE_TEMPLATE_PATH,
    ],
    [
      label("jeonse-vs-wolse.html"),
      at("jeonse-vs-wolse.html"),
      {
        conversionLead: conversionLeadHtml(conversion),
        conversionTable: conversionTableHtml(conversion),
        conversionDistrictLinks: conversionDistrictLinksHtml(conversion),
      },
    ],
    [
      label("renewal-vs-new.html"),
      at("renewal-vs-new.html"),
      {
        renewalLead: renewalLeadHtml(renewal),
        renewalCapLead: renewalCapLeadHtml(renewal),
        renewalDistricts: renewalDistrictsHtml(renewal),
        renewalWolseLead: renewalWolseLeadHtml(renewal),
        renewalWolseDistricts: renewalWolseDistrictsHtml(renewal),
        renewalDistrictLinks: renewalDistrictLinksHtml(renewal),
      },
    ],
    [
      label("floor-gap.html"),
      at("floor-gap.html"),
      {
        floorLead: floor?.lead?.ko ? escapeHtml(floor.lead.ko) : null,
        floorTopLead: floor?.topLead?.ko ? escapeHtml(floor.topLead.ko) : null,
        floorDistrictLead: floor?.districtLead?.ko ? escapeHtml(floor.districtLead.ko) : null,
        floorDistricts: floorDistrictsHtml(floor),
        floorDistrictLinks: floorDistrictLinksHtml(floor),
      },
    ],
    [
      label("switch-house.html"),
      at("switch-house.html"),
      {
        switchLead: change?.lead?.ko ? escapeHtml(change.lead.ko) : null,
        switchTable: change?.table?.ko ?? null,
        switchRegions: change?.regionTable?.ko ?? null,
        // 같은 집 쌍 절(#170 V8): 인라인 스크립트가 아니라 구운 HTML 이다(이 장은 S6 인라인 여유가 없다). 데이터가 없으면 틀의 빈 자리를 둔다.
        repeatSales: repeatSalesHtml(repeat),
        // 가격대·연식별 1년 변화(N4 화면, #676): 같은 방식으로 구운 HTML(인라인 스크립트 0 B). 데이터가 없으면 틀의 빈 자리를 둔다.
        segmentChange: segmentChangeHtml(segment),
      },
    ],
    [
      label("record-high.html"),
      at("record-high.html"),
      {
        recordLead: recordText("lead"),
        recordControl: recordText("control"),
        recordSurvival: recordText("survival"),
        // 비교 기간 열(「90일」「180일」, 칸 12개)만 한국어로 둔다 — 예산(+2 KB) 안에서 가장 값이 낮은 열(칸당 한글 1자 / 약 56 B).
        recordRobust: both(record?.tables?.robust, (c) => c.section !== "tbody" || c.col !== 1),
        recordDistricts: both(record?.tables?.districts),
        recordBands: both(record?.tables?.bands),
        recordBreakdownNote: recordText("breakdownNote"),
      },
    ],
    [
      label("price-outlook.html"),
      at("price-outlook.html"),
      {
        outlookLead: outlookText("lead"),
        outlookRegions: both(outlook?.tables?.regions, (c) => c.section === "thead" || c.col === 0),
        outlookLongLead: outlookText("longLead"),
        outlookNowcastLead: nowcastLead,
        outlookNowcast: both(nowcastTable),
        outlookScore: both(outlook?.tables?.score, headOnly),
        outlookRecordLead: outlookText("recordLead"),
        indicatorLead: indicators?.lead?.ko ? escapeHtml(indicators.lead.ko) : null,
        moveInLead: moveIn?.lead?.ko ? escapeHtml(moveIn.lead.ko) : null,
        moveInTable: both(moveIn?.table, headOnly),
        // 구×반기 표 조각(#677). 예전 자치구별 한 줄(moveIn.districts)은 json 에 남기되 화면은 표를 쓴다.
        moveInDistricts: moveInDistrictsHtml(moveIn),
        indicatorTable: both(indicators?.table, indicatorPick),
      },
    ],
    // 손으로 쓴 장이다. 채울 자리는 「수집 상태」 줄 하나(#657 V11, 빌드 때 데이터에서)이고, 표의 머리글 방향·이름은 같은 길로 단다.
    [label("method.html"), at("method.html"), { collectKo: collect?.ko ?? null, collectEn: collect?.en ?? null }],
    [
      label("cancelled-deals.html"),
      at("cancelled-deals.html"),
      {
        cancelLead: cancelLeadHtml(cancellation),
        cancelCorrectionLead: cancellation?.seoul?.correctionLead?.ko ? escapeHtml(cancellation.seoul.correctionLead.ko) : null,
        cancelDistricts: cancelDistrictsHtml(cancellation),
        cancelMonthLead: cancelMonthLeadHtml(cancellation),
        cancelMonths: cancelMonthsHtml(cancellation),
        cancelPriceLead: cancellation?.priceBands?.lead?.ko ? escapeHtml(cancellation.priceBands.lead.ko) : null,
        cancelPriceTable: cancellation?.priceBands?.table?.ko ?? null,
        cancelDistrictLinks: cancelDistrictLinksHtml(cancellation),
        // 직거래 절(#691). 문장·표는 빌더(build-direct-deals.ts)가 두 언어로 만든 글자를 그대로 꽂는다(priceBands 와 같은 길).
        directLead: direct?.lead?.ko ? escapeHtml(direct.lead.ko) : null,
        directTable: direct?.table?.ko ?? null,
        directMonths: direct?.monthTable?.ko ?? null,
        directNote: direct?.note?.ko ? escapeHtml(direct.note.ko) : null,
        // 신고가 vs 나머지 등기·해제 절(#715 PR2). registration.json 숫자로 registration-view.ts 가 두 언어 글자를 만든다.
        regLead: registration?.lead?.ko ? escapeHtml(registration.lead.ko) : null,
        regTable: registration?.table?.ko ?? null,
        regNote: registration?.note?.ko ? escapeHtml(registration.note.ko) : null,
        // 영어는 같은 장 <template> 에 굽는다 - 언어 전환은 거기서 고르기만 한다(새 fetch·json 칸 0).
        regEn: registrationEnHtml(registration),
      },
    ],
  ]) {
    // 틀이 따로 있는 장은 틀을 읽어 채우고 훑개를 건다(훑개는 굽는 단계의 마지막이다). 나가는 장의 지금 내용은 "변경 없음" 비교용이다.
    const html = await readFile((templatePath ?? path_) as string, "utf8");
    const current = templatePath ? await readFile(path_ as string, "utf8").catch(() => null) : html;
    const filled = applyPrerender(html, fileBlocks);
    const next = templatePath ? stripInlineScriptComments(filled) : filled;

    for (const [name, content] of Object.entries(fileBlocks)) {
      console.log(`  ${file} ${name.padEnd(11)} ${content ? `${content.length}자` : "데이터 없음 - 건너뜀"}`);
    }

    if (next === current) {
      console.log(`  ${file} 변경 없음`);
      continue;
    }
    writes.stage(path_, next, `  ${file} 갱신`);
  }
  // 채울 자리도 표도 없어 위 길을 안 지나는 장은 출처 줄 자리표시만 꽂는다(#588). 그 장이 없는 출력(시험의 축소 사본)은 건너뛴다.
  for (const rel of SOURCE_ONLY_PAGES) {
    const html = await readFile(at(rel), "utf8").catch(() => null);
    if (html == null) continue;
    const next = stampSources(html);
    if (next === html) continue;
    writes.stage(at(rel), next, `  ${label(rel)} 출처 줄`);
  }
  // 열한 장이 전부 렌더에 성공한 뒤에야 쓴다(#237) - 중간 장에서 던지면 어느 파일도 바뀌지 않는다.
  writes.commit();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`프리렌더 실패: ${err.message}`);
    process.exit(1);
  });
}
