/**
 * 금리 화면 다섯 장(rates · 예금 · 적금 · 주담대 · 전세자금대출)의 "금리 다음에 볼 곳" 문단.
 *
 * 이 사이트가 이기는 자리는 실거래와 금리를 물리는 교차점인데, 금리 화면에서 실거래·전환율
 * 화면으로 가는 길이 없었다(#179). 문단은 금리 수치를 만들지 않고 어디를 보는지만 안내한다.
 *
 * 문구는 #179에서 po가 쓰고 growth가 틀 복제를 검토하고 cpo가 확인한 것이다
 * (https://github.com/kyhsa93/jipgye/issues/179#issuecomment-6096362539 ,
 * https://github.com/kyhsa93/jipgye/issues/179#issuecomment-6096369499).
 * 바꾸려면 이슈에 다시 올려 cpo 확인을 받는다. 다섯 장이 서로 다른 말을 하게 만든 것이
 * 이 문단의 요점이라 한 장만 고쳐도 test/rate-bridge.test.mjs의 겹침 검사가 다시 돌아야 한다.
 *
 * 링크 대상은 한 곳씩으로 고정한다. 예산대를 장마다 다르게 고르면 문턱을 정하는 일
 * (DIRECTION 체크리스트 4)이 되므로 첫 화면이 입구로 쓰는 10억대 한 장만 건다.
 */
import { escapeHtml } from "./prerender.mjs";

export const BUDGET_HREF = "./budget-10eok.html";
export const CONVERSION_HREF = "./jeonse-vs-wolse.html";

// 문구 속 [[b|앵커]]는 예산대 링크, [[c|앵커]]는 전환율 링크 자리다.
export const RATE_BRIDGE = {
  rates: {
    ko: "이 화면의 금리는 예금·적금처럼 모을 때 받는 금리와 주택담보대출·전세자금대출처럼 빌릴 때 내는 금리가 함께 있습니다. 모은 돈에 대출을 더하면 10억 원 예산 기준으로 서울 어떤 실거래가 보일까요? [[b|10억대 실거래]]에서 확인하고, 전세와 월세 중 매달 덜 드는 쪽은 [[c|전월세전환율]]의 자치구 표에서 따져 봅니다.",
    en: "The rates on this page mix what you earn by saving (deposits, installment savings) with what you pay when you borrow (home-purchase and jeonse loans). Add a loan to your savings, and which Seoul deals come into view at a KRW 1 billion (10억) budget? Check [[b|the 10억 listings]]; and for which of jeonse or monthly rent costs less each month, work through the district table in [[c|the jeonse-to-monthly conversion rate]].",
  },
  mortgage: {
    ko: "주택담보대출 금리는 집값에서 자기 돈을 뺀 나머지를 빌릴 때 매달 내는 이자를 정합니다. 빌릴 금액을 아직 못 정했다면 먼저 [[b|10억대 실거래]]를 열어 10억 원 예산 기준으로 실제 거래가 어디서 있었는지 보세요. 산다면 매달 나가는 돈이 전월세로 머물 때와 얼마나 다른지는 [[c|전월세전환율]]이 비교의 한쪽을 채워 줍니다.",
    en: "The mortgage rate sets the monthly interest on whatever remains after your own money comes off the price. If you have not settled on a loan size, open [[b|the 10억 listings]] first and see where deals actually happened at a KRW 1 billion budget. How the monthly outlay of buying differs from staying on jeonse or rent is covered, on the renting side, by [[c|the conversion rate]].",
  },
  deposit: {
    ko: "정기예금 금리는 계약 날까지 묶어 둘 목돈에 이자가 얼마 붙는지를 알려 줄 뿐, 그 목돈으로 닿을 수 있는 곳까지는 알려 주지 않습니다. 같은 목돈이 10억 원 예산대의 서울 실거래에서 어디쯤인지는 [[b|10억대 실거래]]에 있고, 그 목돈을 전세 보증금으로 묶을지 월세로 낼지의 월 비용 차이는 [[c|전월세전환율]]의 자치구 표가 보여 줍니다.",
    en: "A deposit rate tells you how much interest a lump sum earns while it waits for a contract date; it does not tell you what that sum can reach. Where the same sum sits among Seoul deals at a KRW 1 billion (10억) budget is on [[b|the 10억 listings]], and the monthly cost gap between tying it up as a jeonse deposit and paying it as monthly rent is shown by the district table in [[c|the conversion rate]].",
  },
  saving: {
    ko: "적금은 매달 붓는 돈이라, 우대조건을 다 채워야 받는 최고금리와 조건 없이 받는 기본금리 중 어느 쪽이 내 몫인지가 먼저입니다. [[c|전월세전환율]]에는 월세로 나가는 돈이 자치구별로 나와 있어 월 납입액과 나란히 놓기 좋고, 목돈을 다 모았을 때 닿을 수 있는 서울 동네는 [[b|10억대 실거래]]의 10억 원 예산 기준으로 가늠할 수 있습니다.",
    en: "Because an installment savings plan is paid in monthly, the first question is whether you will get the headline rate that needs every bonus condition met or the base rate paid with none. [[c|The conversion rate]] lists the monthly rent by district, which makes it easy to set beside your monthly deposit; and which Seoul neighborhoods a finished pot could reach can be gauged on [[b|the 10억 listings]], at a KRW 1 billion budget.",
  },
  rentLoan: {
    ko: "전세자금대출 금리는 보증금을 빌린 만큼 매달 나가는 이자이고, 같은 보증금을 월세로 돌렸을 때의 월세와 맞대 보는 값입니다. 그 맞대기가 자치구마다 어떻게 나오는지는 [[c|전월세전환율]]에서, 전세 대신 산다면 10억 원 예산 기준 실거래는 [[b|10억대 실거래]]에서 봅니다.",
    en: "The jeonse-loan rate is the monthly interest on the part of the deposit you borrow, and it is the figure to hold against the monthly rent the same deposit would convert to. How that comparison comes out by district is on [[c|the conversion rate]]; if you buy instead of renting, the deals at a KRW 1 billion (10억) budget are on [[b|the 10억 listings]].",
  },
};

const HREFS = { b: BUDGET_HREF, c: CONVERSION_HREF };

/** 문구를 HTML로: 앵커 밖은 이스케이프하고, 앵커는 대상 파일로 건다. */
export function rateBridgeHtml(category, locale) {
  const text = RATE_BRIDGE[category]?.[locale];
  if (!text) return null;
  return text
    .split(/(\[\[[bc]\|[^\]]+\]\])/)
    .map((part) => {
      const m = /^\[\[([bc])\|([^\]]+)\]\]$/.exec(part);
      return m ? `<a href="${HREFS[m[1]]}">${escapeHtml(m[2])}</a>` : escapeHtml(part);
    })
    .join("");
}
