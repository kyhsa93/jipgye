// 예산대 후보 단지·본문 합성 조각의 분기별 고정 fixture (#243 PR B): budgetCandidatesHtml(band, complexFiles)·budgetBodyHtml(band, periodList, rates, mortgageSeries, complexFiles, capStats, policyCounts)
// (그리고 이 둘 안에서만 쓰이는 helper budgetWhereHtml·budgetDealHtml·budgetWhen은 본문 행으로 닫는다 - fragment가 아니라 prerender.ts 밖으로 안 나온다).
// 데이터 값이나 날짜에 따라 결과가 갈리지 않는다(R3): 저장소의 docs/·raw/를 읽지 않고 코드(budget-fragments.mjs 등)도 부르지 않는다.
// 한 줄이 한 분기다. `args`는 조각 함수에 그대로 넘기는 인자이고, `expect`는 React 조각이 내야 하는 글자다(본문은 합성 조각이라 예산대가 없으면 `null`, 그 밖에는 문자열).
//
// 기대값의 출처 셋(입력을 가공해 만들지 않았다):
//  1) 후보 단지(CAND_GEN): 모듈을 부르지 않고 **파이썬으로 같은 규칙을 다시 짠 계산**이 낸 글자다(후보 고르기·평형대·정렬·한글 구 순서·`encodeURIComponent`·억 글자). 정상 입력만 다룬다.
//     그중 F01은 손으로도 따졌다(PR 본문). 값이 이상한 입력(NaN 예산대·반올림·비문자열 이름)은 아래 CA-W* 행에 손으로 적었다.
//  2) 본문의 하위 조각 글자(한눈에·돈 문단·상한·정책대출)는 PR A의 분기 표(budget-leaves-branches.mjs)에서 같은 입력의 행을 찾아 그 기대값을 쓴다 - 법령 구간 값은 거기서 이미 파이썬으로 따로 센 값이다.
//  3) 거래 목록·거래 요약·"어디로 가는가" 문장·신고분 기준·지역 줄은 이 파일에 손으로 적었다(글자 틀 + 값).
//
// 이 조각들에는 표본 문턱·`low-sample` 스팬이 없다. 후보 단지의 "같은 평형 6개월 3번 이상"(complex-price.mjs MIN_DEALS)은 렌더 때가 아니라 빌더가 만든 데이터 칸(`cell.n`)에 이미 반영돼 있고
// candidatesInBand는 거르지 않는다(그래서 n이 3 미만인 칸도 중앙값이 범위에 들면 후보로 나온다 - 행 CA-W12). budgetWhereHtml의 0.5·10개 구는 표본 문턱이 아니라 문장 선택 문턱이다.
//
// 모든 값 자리에 같은 종류의 값을 넣었다(#240·#241·#243 PR A 교훈): 비문자열(true·false·0·NaN·{}·[1,2]·[])·null·undefined·특수문자 & < > " '·이미 이스케이프된 &amp;·빈 값 행.
import { BUDGET_LEAVES_BRANCHES } from "./budget-leaves-branches.mjs";

const SP = `A&B <i> "q" it's`;
const SP_OUT = `A&amp;B &lt;i&gt; &quot;q&quot; it's`; // legacy escapeHtml: & < > " 만 바꾸고 '는 그대로

// ===== 값 표(독립 재계산: 모듈을 부르지 않고 파이썬으로 따로 센 값) =====
// 파이썬(cand_expect.py, 모듈을 부르지 않고 같은 규칙을 다시 짠 계산)이 낸 입력과 기대 글자. F-BIG의 입력(1,234곳)은 아래 BIG_FILES를 쓴다(같은 식).
const CAND_GEN = {
 "F01": {
  "cond": "7억대, 후보 6곳(12곳 이하 → 짧은 문구), 구 둘, 평형대 3·3·0",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "meta": {
     "A단지": {
      "dong": "상계동",
      "buildYear": 2005
     },
     "B단지": {
      "dong": "중계동",
      "buildYear": 1998
     }
    },
    "cells": {
     "A단지": {
      "59": {
       "median": 71000,
       "low": 69000,
       "high": 73000,
       "n": 8,
       "quartile": true
      },
      "84": {
       "median": 75000,
       "low": 70000,
       "high": 79000,
       "n": 12,
       "quartile": false
      }
     },
     "B단지": {
      "84": {
       "median": 74000,
       "low": 72000,
       "high": 76000,
       "n": 5,
       "quartile": true
      }
     },
     "C단지": {
      "59": {
       "median": 79999,
       "low": 78000,
       "high": 80500,
       "n": 3,
       "quartile": false
      }
     },
     "D단지": {
      "59": {
       "median": 80000,
       "low": 79000,
       "high": 81000,
       "n": 9,
       "quartile": true
      }
     },
     "E단지": {
      "59": {
       "median": 69999,
       "low": 69000,
       "high": 71000,
       "n": 9,
       "quartile": true
      }
     },
     "F단지": {
      "59": {
       "median": 70000,
       "low": 69000,
       "high": 75000,
       "n": 4,
       "quartile": false
      }
     }
    }
   },
   {
    "district": "도봉구",
    "reference": "202609",
    "cells": {
     "G단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 12,
       "quartile": true
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 6곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 3 · 60~85㎡ 3 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 노원구 5 · 도봉구 1</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=A%EB%8B%A8%EC%A7%80\">A단지</a><span class=\"meta\">노원구 · 상계동 · 59㎡ · 2005년</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">가운데 절반 6억 9,000만원~7억 3,000만원 · 8건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=F%EB%8B%A8%EC%A7%80\">F단지</a><span class=\"meta\">노원구 · 59㎡</span><span class=\"amount\">7억원</span><span class=\"meta\">최저~최고 6억 9,000만원~7억 5,000만원 · 4건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=C%EB%8B%A8%EC%A7%80\">C단지</a><span class=\"meta\">노원구 · 59㎡</span><span class=\"amount\">7억 9,999만원</span><span class=\"meta\">최저~최고 7억 8,000만원~8억 500만원 · 3건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%8F%84%EB%B4%89%EA%B5%AC&amp;apt=G%EB%8B%A8%EC%A7%80\">G단지</a><span class=\"meta\">도봉구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억원~7억 4,000만원 · 12건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=A%EB%8B%A8%EC%A7%80\">A단지</a><span class=\"meta\">노원구 · 상계동 · 84㎡ · 2005년</span><span class=\"amount\">7억 5,000만원</span><span class=\"meta\">최저~최고 7억원~7억 9,000만원 · 12건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=B%EB%8B%A8%EC%A7%80\">B단지</a><span class=\"meta\">노원구 · 중계동 · 84㎡ · 1998년</span><span class=\"amount\">7억 4,000만원</span><span class=\"meta\">가운데 절반 7억 2,000만원~7억 6,000만원 · 5건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F12": {
  "cond": "후보 정확히 12곳(12 초과 아님 → 짧은 문구), 모두 60~85㎡",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "cells": {
     "단지00": {
      "84": {
       "median": 72000,
       "low": 71000,
       "high": 73000,
       "n": 30,
       "quartile": true
      }
     },
     "단지01": {
      "84": {
       "median": 72010,
       "low": 71010,
       "high": 73010,
       "n": 29,
       "quartile": false
      }
     },
     "단지02": {
      "84": {
       "median": 72020,
       "low": 71020,
       "high": 73020,
       "n": 28,
       "quartile": true
      }
     },
     "단지03": {
      "84": {
       "median": 72030,
       "low": 71030,
       "high": 73030,
       "n": 27,
       "quartile": false
      }
     },
     "단지04": {
      "84": {
       "median": 72040,
       "low": 71040,
       "high": 73040,
       "n": 26,
       "quartile": true
      }
     },
     "단지05": {
      "84": {
       "median": 72050,
       "low": 71050,
       "high": 73050,
       "n": 25,
       "quartile": false
      }
     },
     "단지06": {
      "84": {
       "median": 72060,
       "low": 71060,
       "high": 73060,
       "n": 24,
       "quartile": true
      }
     },
     "단지07": {
      "84": {
       "median": 72070,
       "low": 71070,
       "high": 73070,
       "n": 23,
       "quartile": false
      }
     },
     "단지08": {
      "84": {
       "median": 72080,
       "low": 71080,
       "high": 73080,
       "n": 22,
       "quartile": true
      }
     },
     "단지09": {
      "84": {
       "median": 72090,
       "low": 71090,
       "high": 73090,
       "n": 21,
       "quartile": false
      }
     },
     "단지10": {
      "84": {
       "median": 72100,
       "low": 71100,
       "high": 73100,
       "n": 20,
       "quartile": true
      }
     },
     "단지11": {
      "84": {
       "median": 72110,
       "low": 71110,
       "high": 73110,
       "n": 19,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 12곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 12 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 노원구 12</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8000\">단지00</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억 1,000만원~7억 3,000만원 · 30건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8001\">단지01</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,010만원</span><span class=\"meta\">최저~최고 7억 1,010만원~7억 3,010만원 · 29건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8002\">단지02</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,020만원</span><span class=\"meta\">가운데 절반 7억 1,020만원~7억 3,020만원 · 28건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8003\">단지03</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,030만원</span><span class=\"meta\">최저~최고 7억 1,030만원~7억 3,030만원 · 27건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8004\">단지04</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,040만원</span><span class=\"meta\">가운데 절반 7억 1,040만원~7억 3,040만원 · 26건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8005\">단지05</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,050만원</span><span class=\"meta\">최저~최고 7억 1,050만원~7억 3,050만원 · 25건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8006\">단지06</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,060만원</span><span class=\"meta\">가운데 절반 7억 1,060만원~7억 3,060만원 · 24건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8007\">단지07</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,070만원</span><span class=\"meta\">최저~최고 7억 1,070만원~7억 3,070만원 · 23건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8008\">단지08</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,080만원</span><span class=\"meta\">가운데 절반 7억 1,080만원~7억 3,080만원 · 22건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8009\">단지09</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,090만원</span><span class=\"meta\">최저~최고 7억 1,090만원~7억 3,090만원 · 21건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8010\">단지10</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,100만원</span><span class=\"meta\">가운데 절반 7억 1,100만원~7억 3,100만원 · 20건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8011\">단지11</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,110만원</span><span class=\"meta\">최저~최고 7억 1,110만원~7억 3,110만원 · 19건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F13": {
  "cond": "후보 13곳(12 초과 → 긴 문구, 12곳만 적음), 모두 60~85㎡",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "cells": {
     "단지00": {
      "84": {
       "median": 72000,
       "low": 71000,
       "high": 73000,
       "n": 30,
       "quartile": true
      }
     },
     "단지01": {
      "84": {
       "median": 72010,
       "low": 71010,
       "high": 73010,
       "n": 29,
       "quartile": false
      }
     },
     "단지02": {
      "84": {
       "median": 72020,
       "low": 71020,
       "high": 73020,
       "n": 28,
       "quartile": true
      }
     },
     "단지03": {
      "84": {
       "median": 72030,
       "low": 71030,
       "high": 73030,
       "n": 27,
       "quartile": false
      }
     },
     "단지04": {
      "84": {
       "median": 72040,
       "low": 71040,
       "high": 73040,
       "n": 26,
       "quartile": true
      }
     },
     "단지05": {
      "84": {
       "median": 72050,
       "low": 71050,
       "high": 73050,
       "n": 25,
       "quartile": false
      }
     },
     "단지06": {
      "84": {
       "median": 72060,
       "low": 71060,
       "high": 73060,
       "n": 24,
       "quartile": true
      }
     },
     "단지07": {
      "84": {
       "median": 72070,
       "low": 71070,
       "high": 73070,
       "n": 23,
       "quartile": false
      }
     },
     "단지08": {
      "84": {
       "median": 72080,
       "low": 71080,
       "high": 73080,
       "n": 22,
       "quartile": true
      }
     },
     "단지09": {
      "84": {
       "median": 72090,
       "low": 71090,
       "high": 73090,
       "n": 21,
       "quartile": false
      }
     },
     "단지10": {
      "84": {
       "median": 72100,
       "low": 71100,
       "high": 73100,
       "n": 20,
       "quartile": true
      }
     },
     "단지11": {
      "84": {
       "median": 72110,
       "low": 71110,
       "high": 73110,
       "n": 19,
       "quartile": false
      }
     },
     "단지12": {
      "84": {
       "median": 72120,
       "low": 71120,
       "high": 73120,
       "n": 18,
       "quartile": true
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 13곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 13 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 노원구 13</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8000\">단지00</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억 1,000만원~7억 3,000만원 · 30건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8001\">단지01</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,010만원</span><span class=\"meta\">최저~최고 7억 1,010만원~7억 3,010만원 · 29건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8002\">단지02</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,020만원</span><span class=\"meta\">가운데 절반 7억 1,020만원~7억 3,020만원 · 28건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8003\">단지03</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,030만원</span><span class=\"meta\">최저~최고 7억 1,030만원~7억 3,030만원 · 27건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8004\">단지04</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,040만원</span><span class=\"meta\">가운데 절반 7억 1,040만원~7억 3,040만원 · 26건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8005\">단지05</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,050만원</span><span class=\"meta\">최저~최고 7억 1,050만원~7억 3,050만원 · 25건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8006\">단지06</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,060만원</span><span class=\"meta\">가운데 절반 7억 1,060만원~7억 3,060만원 · 24건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8007\">단지07</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,070만원</span><span class=\"meta\">최저~최고 7억 1,070만원~7억 3,070만원 · 23건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8008\">단지08</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,080만원</span><span class=\"meta\">가운데 절반 7억 1,080만원~7억 3,080만원 · 22건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8009\">단지09</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,090만원</span><span class=\"meta\">최저~최고 7억 1,090만원~7억 3,090만원 · 21건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8010\">단지10</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,100만원</span><span class=\"meta\">가운데 절반 7억 1,100만원~7억 3,100만원 · 20건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8011\">단지11</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,110만원</span><span class=\"meta\">최저~최고 7억 1,110만원~7억 3,110만원 · 19건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형대마다 거래가 많은 곳을 고루 12곳만 적었습니다. 13곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →</a></p></section>"
 },
 "F14": {
  "cond": "후보 14곳(60㎡ 미만 2·60~85㎡ 6·85㎡ 초과 6) → 평형대별 4곳씩 10곳 + 부족분 2곳 채움",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "강남구",
    "reference": "202609",
    "cells": {
     "M49-0": {
      "49": {
       "median": 71040,
       "low": 70040,
       "high": 72040,
       "n": 40,
       "quartile": false
      }
     },
     "M49-1": {
      "49": {
       "median": 71039,
       "low": 70039,
       "high": 72039,
       "n": 39,
       "quartile": false
      }
     },
     "M84-0": {
      "84": {
       "median": 71038,
       "low": 70038,
       "high": 72038,
       "n": 38,
       "quartile": false
      }
     },
     "M84-1": {
      "84": {
       "median": 71037,
       "low": 70037,
       "high": 72037,
       "n": 37,
       "quartile": false
      }
     },
     "M84-2": {
      "84": {
       "median": 71036,
       "low": 70036,
       "high": 72036,
       "n": 36,
       "quartile": false
      }
     },
     "M84-3": {
      "84": {
       "median": 71035,
       "low": 70035,
       "high": 72035,
       "n": 35,
       "quartile": false
      }
     },
     "M84-4": {
      "84": {
       "median": 71034,
       "low": 70034,
       "high": 72034,
       "n": 34,
       "quartile": false
      }
     },
     "M84-5": {
      "84": {
       "median": 71033,
       "low": 70033,
       "high": 72033,
       "n": 33,
       "quartile": false
      }
     },
     "M114-0": {
      "114": {
       "median": 71032,
       "low": 70032,
       "high": 72032,
       "n": 32,
       "quartile": false
      }
     },
     "M114-1": {
      "114": {
       "median": 71031,
       "low": 70031,
       "high": 72031,
       "n": 31,
       "quartile": false
      }
     },
     "M114-2": {
      "114": {
       "median": 71030,
       "low": 70030,
       "high": 72030,
       "n": 30,
       "quartile": false
      }
     },
     "M114-3": {
      "114": {
       "median": 71029,
       "low": 70029,
       "high": 72029,
       "n": 29,
       "quartile": false
      }
     },
     "M114-4": {
      "114": {
       "median": 71028,
       "low": 70028,
       "high": 72028,
       "n": 28,
       "quartile": false
      }
     },
     "M114-5": {
      "114": {
       "median": 71027,
       "low": 70027,
       "high": 72027,
       "n": 27,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 14곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 2 · 60~85㎡ 6 · 85㎡ 초과 6</div><div class=\"budget-districts\">자치구별: 강남구 14</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M49-0\">M49-0</a><span class=\"meta\">강남구 · 49㎡</span><span class=\"amount\">7억 1,040만원</span><span class=\"meta\">최저~최고 7억 40만원~7억 2,040만원 · 40건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M49-1\">M49-1</a><span class=\"meta\">강남구 · 49㎡</span><span class=\"amount\">7억 1,039만원</span><span class=\"meta\">최저~최고 7억 39만원~7억 2,039만원 · 39건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-0\">M84-0</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,038만원</span><span class=\"meta\">최저~최고 7억 38만원~7억 2,038만원 · 38건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-1\">M84-1</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,037만원</span><span class=\"meta\">최저~최고 7억 37만원~7억 2,037만원 · 37건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-2\">M84-2</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,036만원</span><span class=\"meta\">최저~최고 7억 36만원~7억 2,036만원 · 36건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-3\">M84-3</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,035만원</span><span class=\"meta\">최저~최고 7억 35만원~7억 2,035만원 · 35건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-4\">M84-4</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,034만원</span><span class=\"meta\">최저~최고 7억 34만원~7억 2,034만원 · 34건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M84-5\">M84-5</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,033만원</span><span class=\"meta\">최저~최고 7억 33만원~7억 2,033만원 · 33건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M114-0\">M114-0</a><span class=\"meta\">강남구 · 114㎡</span><span class=\"amount\">7억 1,032만원</span><span class=\"meta\">최저~최고 7억 32만원~7억 2,032만원 · 32건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M114-1\">M114-1</a><span class=\"meta\">강남구 · 114㎡</span><span class=\"amount\">7억 1,031만원</span><span class=\"meta\">최저~최고 7억 31만원~7억 2,031만원 · 31건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M114-2\">M114-2</a><span class=\"meta\">강남구 · 114㎡</span><span class=\"amount\">7억 1,030만원</span><span class=\"meta\">최저~최고 7억 30만원~7억 2,030만원 · 30건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=M114-3\">M114-3</a><span class=\"meta\">강남구 · 114㎡</span><span class=\"amount\">7억 1,029만원</span><span class=\"meta\">최저~최고 7억 29만원~7억 2,029만원 · 29건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형대마다 거래가 많은 곳을 고루 12곳만 적었습니다. 14곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →</a></p></section>"
 },
 "F85": {
  "cond": "후보 14곳 모두 85㎡ 초과 → 4곳 + 부족분 8곳 채움 = 12곳",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "cells": {
     "단지00": {
      "114": {
       "median": 72000,
       "low": 71000,
       "high": 73000,
       "n": 30,
       "quartile": true
      }
     },
     "단지01": {
      "114": {
       "median": 72010,
       "low": 71010,
       "high": 73010,
       "n": 29,
       "quartile": false
      }
     },
     "단지02": {
      "114": {
       "median": 72020,
       "low": 71020,
       "high": 73020,
       "n": 28,
       "quartile": true
      }
     },
     "단지03": {
      "114": {
       "median": 72030,
       "low": 71030,
       "high": 73030,
       "n": 27,
       "quartile": false
      }
     },
     "단지04": {
      "114": {
       "median": 72040,
       "low": 71040,
       "high": 73040,
       "n": 26,
       "quartile": true
      }
     },
     "단지05": {
      "114": {
       "median": 72050,
       "low": 71050,
       "high": 73050,
       "n": 25,
       "quartile": false
      }
     },
     "단지06": {
      "114": {
       "median": 72060,
       "low": 71060,
       "high": 73060,
       "n": 24,
       "quartile": true
      }
     },
     "단지07": {
      "114": {
       "median": 72070,
       "low": 71070,
       "high": 73070,
       "n": 23,
       "quartile": false
      }
     },
     "단지08": {
      "114": {
       "median": 72080,
       "low": 71080,
       "high": 73080,
       "n": 22,
       "quartile": true
      }
     },
     "단지09": {
      "114": {
       "median": 72090,
       "low": 71090,
       "high": 73090,
       "n": 21,
       "quartile": false
      }
     },
     "단지10": {
      "114": {
       "median": 72100,
       "low": 71100,
       "high": 73100,
       "n": 20,
       "quartile": true
      }
     },
     "단지11": {
      "114": {
       "median": 72110,
       "low": 71110,
       "high": 73110,
       "n": 19,
       "quartile": false
      }
     },
     "단지12": {
      "114": {
       "median": 72120,
       "low": 71120,
       "high": 73120,
       "n": 18,
       "quartile": true
      }
     },
     "단지13": {
      "114": {
       "median": 72130,
       "low": 71130,
       "high": 73130,
       "n": 17,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 14곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 0 · 85㎡ 초과 14</div><div class=\"budget-districts\">자치구별: 노원구 14</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8000\">단지00</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억 1,000만원~7억 3,000만원 · 30건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8001\">단지01</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,010만원</span><span class=\"meta\">최저~최고 7억 1,010만원~7억 3,010만원 · 29건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8002\">단지02</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,020만원</span><span class=\"meta\">가운데 절반 7억 1,020만원~7억 3,020만원 · 28건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8003\">단지03</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,030만원</span><span class=\"meta\">최저~최고 7억 1,030만원~7억 3,030만원 · 27건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8004\">단지04</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,040만원</span><span class=\"meta\">가운데 절반 7억 1,040만원~7억 3,040만원 · 26건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8005\">단지05</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,050만원</span><span class=\"meta\">최저~최고 7억 1,050만원~7억 3,050만원 · 25건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8006\">단지06</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,060만원</span><span class=\"meta\">가운데 절반 7억 1,060만원~7억 3,060만원 · 24건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8007\">단지07</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,070만원</span><span class=\"meta\">최저~최고 7억 1,070만원~7억 3,070만원 · 23건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8008\">단지08</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,080만원</span><span class=\"meta\">가운데 절반 7억 1,080만원~7억 3,080만원 · 22건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8009\">단지09</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,090만원</span><span class=\"meta\">최저~최고 7억 1,090만원~7억 3,090만원 · 21건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8010\">단지10</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,100만원</span><span class=\"meta\">가운데 절반 7억 1,100만원~7억 3,100만원 · 20건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8B%A8%EC%A7%8011\">단지11</a><span class=\"meta\">노원구 · 114㎡</span><span class=\"amount\">7억 2,110만원</span><span class=\"meta\">최저~최고 7억 1,110만원~7억 3,110만원 · 19건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형대마다 거래가 많은 곳을 고루 12곳만 적었습니다. 14곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →</a></p></section>"
 },
 "F-TIE": {
  "cond": "구별 곳 수 3·2·2·1(같으면 가나다순), n 같으면 중앙값 낮은 순, 그것도 같으면 단지 이름순",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "cells": {
     "나단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 7,
       "quartile": false
      }
     },
     "가단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 7,
       "quartile": false
      }
     }
    }
   },
   {
    "district": "강남구",
    "reference": "202609",
    "cells": {
     "다단지": {
      "84": {
       "median": 73000,
       "low": 70000,
       "high": 76000,
       "n": 7,
       "quartile": false
      }
     },
     "라단지": {
      "84": {
       "median": 71000,
       "low": 70000,
       "high": 74000,
       "n": 7,
       "quartile": false
      }
     }
    }
   },
   {
    "district": "도봉구",
    "reference": "202609",
    "cells": {
     "마단지": {
      "84": {
       "median": 72500,
       "low": 71000,
       "high": 74000,
       "n": 9,
       "quartile": false
      }
     },
     "바단지": {
      "59": {
       "median": 72500,
       "low": 71000,
       "high": 74000,
       "n": 9,
       "quartile": false
      }
     },
     "사단지": {
      "84": {
       "median": 78000,
       "low": 71000,
       "high": 79000,
       "n": 3,
       "quartile": false
      }
     }
    }
   },
   {
    "district": "중랑구",
    "reference": "202609",
    "cells": {
     "아단지": {
      "84": {
       "median": 75000,
       "low": 71000,
       "high": 79000,
       "n": 2,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 8곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 1 · 60~85㎡ 7 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 도봉구 3 · 강남구 2 · 노원구 2 · 중랑구 1</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%8F%84%EB%B4%89%EA%B5%AC&amp;apt=%EB%B0%94%EB%8B%A8%EC%A7%80\">바단지</a><span class=\"meta\">도봉구 · 59㎡</span><span class=\"amount\">7억 2,500만원</span><span class=\"meta\">최저~최고 7억 1,000만원~7억 4,000만원 · 9건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%8F%84%EB%B4%89%EA%B5%AC&amp;apt=%EB%A7%88%EB%8B%A8%EC%A7%80\">마단지</a><span class=\"meta\">도봉구 · 84㎡</span><span class=\"amount\">7억 2,500만원</span><span class=\"meta\">최저~최고 7억 1,000만원~7억 4,000만원 · 9건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=%EB%9D%BC%EB%8B%A8%EC%A7%80\">라단지</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 7건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B0%80%EB%8B%A8%EC%A7%80\">가단지</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 7건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%82%98%EB%8B%A8%EC%A7%80\">나단지</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 7건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=%EB%8B%A4%EB%8B%A8%EC%A7%80\">다단지</a><span class=\"meta\">강남구 · 84㎡</span><span class=\"amount\">7억 3,000만원</span><span class=\"meta\">최저~최고 7억원~7억 6,000만원 · 7건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%8F%84%EB%B4%89%EA%B5%AC&amp;apt=%EC%82%AC%EB%8B%A8%EC%A7%80\">사단지</a><span class=\"meta\">도봉구 · 84㎡</span><span class=\"amount\">7억 8,000만원</span><span class=\"meta\">최저~최고 7억 1,000만원~7억 9,000만원 · 3건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%A4%91%EB%9E%91%EA%B5%AC&amp;apt=%EC%95%84%EB%8B%A8%EC%A7%80\">아단지</a><span class=\"meta\">중랑구 · 84㎡</span><span class=\"amount\">7억 5,000만원</span><span class=\"meta\">최저~최고 7억 1,000만원~7억 9,000만원 · 2건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F-AREA": {
  "cond": "평형 경계 59.99·60·85·85.01㎡",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "cells": {
     "경계가": {
      "59.99": {
       "median": 71000,
       "low": 70000,
       "high": 72000,
       "n": 4,
       "quartile": false
      }
     },
     "경계나": {
      "60": {
       "median": 71000,
       "low": 70000,
       "high": 72000,
       "n": 5,
       "quartile": false
      }
     },
     "경계다": {
      "85": {
       "median": 71000,
       "low": 70000,
       "high": 72000,
       "n": 6,
       "quartile": false
      }
     },
     "경계라": {
      "85.01": {
       "median": 71000,
       "low": 70000,
       "high": 72000,
       "n": 7,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 4곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 1 · 60~85㎡ 2 · 85㎡ 초과 1</div><div class=\"budget-districts\">자치구별: 노원구 4</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B2%BD%EA%B3%84%EA%B0%80\">경계가</a><span class=\"meta\">노원구 · 59.99㎡</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">최저~최고 7억원~7억 2,000만원 · 4건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B2%BD%EA%B3%84%EB%82%98\">경계나</a><span class=\"meta\">노원구 · 60㎡</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">최저~최고 7억원~7억 2,000만원 · 5건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B2%BD%EA%B3%84%EB%8B%A4\">경계다</a><span class=\"meta\">노원구 · 85㎡</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">최저~최고 7억원~7억 2,000만원 · 6건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B2%BD%EA%B3%84%EB%9D%BC\">경계라</a><span class=\"meta\">노원구 · 85.01㎡</span><span class=\"amount\">7억 1,000만원</span><span class=\"meta\">최저~최고 7억원~7억 2,000만원 · 7건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F-META": {
  "cond": "동·준공연도 없음/0, 사분위 참/거짓",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202609",
    "meta": {
     "갑단지": {
      "dong": "상계동",
      "buildYear": 0
     },
     "을단지": {
      "buildYear": 1999
     },
     "병단지": {
      "dong": ""
     }
    },
    "cells": {
     "갑단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 4,
       "quartile": true
      }
     },
     "을단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 5,
       "quartile": false
      }
     },
     "병단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 6,
       "quartile": true
      }
     },
     "정단지": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 7,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 4곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 4 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 노원구 4</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EC%A0%95%EB%8B%A8%EC%A7%80\">정단지</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 7건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%B3%91%EB%8B%A8%EC%A7%80\">병단지</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억원~7억 4,000만원 · 6건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EC%9D%84%EB%8B%A8%EC%A7%80\">을단지</a><span class=\"meta\">노원구 · 84㎡ · 1999년</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 5건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EA%B0%91%EB%8B%A8%EC%A7%80\">갑단지</a><span class=\"meta\">노원구 · 상계동 · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">가운데 절반 7억원~7억 4,000만원 · 4건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F-SPEC": {
  "cond": "단지·구 이름의 특수문자 & < > \" ' 와 이미 이스케이프된 글자",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "역삼 <구>",
    "reference": "202609",
    "meta": {
     "역삼I'PARK": {
      "dong": "A&B"
     }
    },
    "cells": {
     "역삼I'PARK": {
      "84": {
       "median": 72000,
       "low": 70000,
       "high": 74000,
       "n": 9,
       "quartile": false
      }
     },
     "A&B <i> \"q\" it's": {
      "84": {
       "median": 72500,
       "low": 70000,
       "high": 74000,
       "n": 8,
       "quartile": false
      }
     },
     "&amp;": {
      "84": {
       "median": 73000,
       "low": 70000,
       "high": 74000,
       "n": 7,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 3곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 3 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 역삼 &lt;구&gt; 3</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%97%AD%EC%82%BC%20%3C%EA%B5%AC%3E&amp;apt=%EC%97%AD%EC%82%BCI'PARK\">역삼I'PARK</a><span class=\"meta\">역삼 &lt;구&gt; · A&amp;B · 84㎡</span><span class=\"amount\">7억 2,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 9건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%97%AD%EC%82%BC%20%3C%EA%B5%AC%3E&amp;apt=A%26B%20%3Ci%3E%20%22q%22%20it's\">A&amp;B &lt;i&gt; &quot;q&quot; it's</a><span class=\"meta\">역삼 &lt;구&gt; · 84㎡</span><span class=\"amount\">7억 2,500만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 8건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%97%AD%EC%82%BC%20%3C%EA%B5%AC%3E&amp;apt=%26amp%3B\">&amp;amp;</a><span class=\"meta\">역삼 &lt;구&gt; · 84㎡</span><span class=\"amount\">7억 3,000만원</span><span class=\"meta\">최저~최고 7억원~7억 4,000만원 · 7건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "F-BIG": {
  "cond": "후보 1,234곳(천 단위 쉼표)",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": null,
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 7억대인 단지·평형은 서울에 1,234곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 0 · 60~85㎡ 1234 · 85㎡ 초과 0</div><div class=\"budget-districts\">자치구별: 노원구 1234</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800000\">대단지0000</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1234건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800001\">대단지0001</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 1만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1233건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800002\">대단지0002</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 2만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1232건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800003\">대단지0003</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 3만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1231건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800004\">대단지0004</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 4만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1230건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800005\">대단지0005</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 5만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1229건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800006\">대단지0006</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 6만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1228건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800007\">대단지0007</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 7만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1227건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800008\">대단지0008</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 8만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1226건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800009\">대단지0009</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 9만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1225건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800010\">대단지0010</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 10만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1224건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EB%85%B8%EC%9B%90%EA%B5%AC&amp;apt=%EB%8C%80%EB%8B%A8%EC%A7%800011\">대단지0011</a><span class=\"meta\">노원구 · 84㎡</span><span class=\"amount\">7억 11만원</span><span class=\"meta\">최저~최고 6억 9,000만원~9억원 · 1223건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=7&amp;group=1\">평형대마다 거래가 많은 곳을 고루 12곳만 적었습니다. 1234곳 전부와 평형·연식 조건은 실거래 검색에서 단지로 묶어 보세요 →</a></p></section>"
 },
 "N-REF01": {
  "cond": "기준 달 202601 → 1월(앞 0을 지움)",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202601",
    "cells": {
     "A": {
      "84": {
       "median": 90000,
       "low": 1,
       "high": 2,
       "n": 3,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 1월 값으로 고친 중앙값이 7억대인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.</p></section>"
 },
 "N-REF12": {
  "cond": "기준 달 202612 → 12월",
  "band": {
   "min10k": 70000,
   "max10k": 80000
  },
  "files": [
   {
    "district": "노원구",
    "reference": "202612",
    "cells": {}
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 12월 값으로 고친 중앙값이 7억대인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.</p></section>"
 },
 "FB16": {
  "cond": "16억대 후보 3곳(합성 본문에 넣는 용도), 구 둘",
  "band": {
   "min10k": 160000,
   "max10k": 170000
  },
  "files": [
   {
    "district": "서초구",
    "reference": "202609",
    "meta": {
     "래미안": {
      "dong": "반포동",
      "buildYear": 2009
     }
    },
    "cells": {
     "래미안": {
      "84": {
       "median": 165000,
       "low": 160000,
       "high": 168000,
       "n": 14,
       "quartile": true
      },
      "114": {
       "median": 169000,
       "low": 160000,
       "high": 175000,
       "n": 6,
       "quartile": false
      }
     },
     "자이": {
      "84": {
       "median": 161000,
       "low": 158000,
       "high": 163000,
       "n": 9,
       "quartile": true
      }
     }
    }
   },
   {
    "district": "강남구",
    "reference": "202609",
    "cells": {
     "아이파크": {
      "59": {
       "median": 160000,
       "low": 159000,
       "high": 162000,
       "n": 5,
       "quartile": false
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 16억대인 단지·평형은 서울에 4곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p><div class=\"budget-districts\">평형대별: 60㎡ 미만 1 · 60~85㎡ 2 · 85㎡ 초과 1</div><div class=\"budget-districts\">자치구별: 서초구 3 · 강남구 1</div><ul class=\"budget-deals\"><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EA%B0%95%EB%82%A8%EA%B5%AC&amp;apt=%EC%95%84%EC%9D%B4%ED%8C%8C%ED%81%AC\">아이파크</a><span class=\"meta\">강남구 · 59㎡</span><span class=\"amount\">16억원</span><span class=\"meta\">최저~최고 15억 9,000만원~16억 2,000만원 · 5건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%84%9C%EC%B4%88%EA%B5%AC&amp;apt=%EB%9E%98%EB%AF%B8%EC%95%88\">래미안</a><span class=\"meta\">서초구 · 반포동 · 84㎡ · 2009년</span><span class=\"amount\">16억 5,000만원</span><span class=\"meta\">가운데 절반 16억원~16억 8,000만원 · 14건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%84%9C%EC%B4%88%EA%B5%AC&amp;apt=%EC%9E%90%EC%9D%B4\">자이</a><span class=\"meta\">서초구 · 84㎡</span><span class=\"amount\">16억 1,000만원</span><span class=\"meta\">가운데 절반 15억 8,000만원~16억 3,000만원 · 9건</span></li><li class=\"budget-deal\"><a class=\"apt\" href=\"./deal-search.html?district=%EC%84%9C%EC%B4%88%EA%B5%AC&amp;apt=%EB%9E%98%EB%AF%B8%EC%95%88\">래미안</a><span class=\"meta\">서초구 · 반포동 · 114㎡ · 2009년</span><span class=\"amount\">16억 9,000만원</span><span class=\"meta\">최저~최고 16억원~17억 5,000만원 · 6건</span></li></ul><p class=\"budget-more\"><a href=\"./deal-search.html?budget=16&amp;group=1\">평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →</a></p></section>"
 },
 "NB10": {
  "cond": "10억대 후보 없음(칸은 있지만 다른 예산대)",
  "band": {
   "min10k": 100000,
   "max10k": 110000
  },
  "files": [
   {
    "district": "서초구",
    "reference": "202609",
    "cells": {
     "래미안": {
      "84": {
       "median": 165000,
       "low": 160000,
       "high": 168000,
       "n": 14,
       "quartile": true
      }
     }
    }
   }
  ],
  "expect": "<section class=\"budget-candidates\" data-prerendered=\"\"><h3>이 예산대의 단지 후보</h3><p>2026년 9월 값으로 고친 중앙값이 10억대인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.</p></section>"
 }
};
const BIG_FILES = [{ district: "노원구", reference: "202609", cells: Object.fromEntries(Array.from({ length: 1234 }, (_, i) => [`대단지${String(i).padStart(4, "0")}`, { 84: { median: 70_000 + (i % 9000), low: 69_000, high: 90_000, n: 1234 - i, quartile: false } }])) }];

// ===== 입력 틀 =====
const rows = [];
const add = (id, fn, cond, args, expect, extra = {}) => rows.push({ id, fn, cond, args, expect, ...extra });
const throwsRows = [];
const addThrow = (id, fn, cond, args, error = "TypeError") => throwsRows.push({ id, fn, cond, args, error });
const CA = "budgetCandidatesHtml";
const BO = "budgetBodyHtml";

const leafBand = (eok) => ({ min10k: eok * 10_000, max10k: eok * 10_000 + 10_000, count: 100 });
// 금리 근거: 한국은행 ECOS 평균금리 { rate, month }(#577). 잎 표(budget-leaves-branches)의 BASIS_STD 와 같은 값이라 leaf()가 그 행을 찾는다.
const RATES_STD = { rate: 5.25, month: "202608" };

// ----- PR A 분기 표에서 하위 조각의 기대값 찾기 -----
const trim = (a) => {
  const out = [...a];
  while (out.length && (out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
  return JSON.stringify(out);
};
const leaf = (fn, eok, ...rest) => {
  const want = trim([leafBand(eok), ...rest]);
  const hit = BUDGET_LEAVES_BRANCHES.find((r) => r.fn === fn && trim(r.args) === want);
  if (!hit) throw new Error(`PR A 분기 표에 ${fn} ${eok}억대 ${JSON.stringify(rest)} 행이 없다`);
  return hit.expect;
};
const leafArg = (id, i) => BUDGET_LEAVES_BRANCHES.find((r) => r.id === id).args[i];
const POLICY_COUNTS = leafArg("PO-B3", 1);
const CAP_STATS = leafArg("CP-H16s", 1);

// ----- 글자 틀(마크업) -----
const CAND_HEAD = `<section class="budget-candidates" data-prerendered=""><h3>이 예산대의 단지 후보</h3>`;
const CAND_EMPTY = (month, label) =>
  `${CAND_HEAD}<p>${month} 값으로 고친 중앙값이 ${label}인 단지·평형이 없습니다. 같은 평형이 6개월 동안 3번 이상 거래돼야 범위를 낼 수 있습니다.</p></section>`;
const MORE_SHORT = "평형·연식 조건을 더해 실거래 검색에서 단지로 묶어 보기 →";
const CAND_LI = (href, apt, facts, amount, meta) =>
  `<li class="budget-deal"><a class="apt" href="${href}">${apt}</a><span class="meta">${facts}</span><span class="amount">${amount}</span><span class="meta">${meta}</span></li>`;
const CAND_FULL = ({ month = "2026년 9월", label, n, bands, districts, items, more = label.replace("억대", ""), moreText = MORE_SHORT }) =>
  `${CAND_HEAD}<p>${month} 값으로 고친 중앙값이 ${label}인 단지·평형은 서울에 ${n}곳입니다. 같은 평형이 최근 6개월에 3번 이상 거래돼 범위를 낼 수 있었던 곳만 셉니다 — 거래가 드문 단지는 빠집니다.</p>` +
  `<div class="budget-districts">평형대별: ${bands}</div><div class="budget-districts">자치구별: ${districts}</div><ul class="budget-deals">${items.join("")}</ul>` +
  `<p class="budget-more"><a href="./deal-search.html?budget=${more}&amp;group=1">${moreText}</a></p></section>`;
const Q = {
  // encodeURIComponent 값(파이썬 urllib.parse.quote(safe="-_.!~*'()")로 따로 구했다)
  노원구: "%EB%85%B8%EC%9B%90%EA%B5%AC",
  A단지: "A%EB%8B%A8%EC%A7%80",
  B단지: "B%EB%8B%A8%EC%A7%80",
  X단지: "X%EB%8B%A8%EC%A7%80",
};
const href = (district, apt) => `./deal-search.html?district=${district}&amp;apt=${apt}`;

// ================= budgetCandidatesHtml: 빈 결과(""), 후보 없음, 후보 있음 =================
const BAND7 = { min10k: 70_000, max10k: 80_000 };
const FILES_D1 = CAND_GEN.F01.files;

// 예산대가 없거나 단지 파일이 없으면 빈 문자열("") - null이 아니다
[
  ["null", null],
  ["undefined", undefined],
  ["0", 0],
  ["빈 문자열", ""],
  ["false", false],
].forEach(([cond, value], i) => add(`CA-E${String(i + 1).padStart(2, "0")}`, CA, `예산대 없음(${cond}) → 빈 문자열`, [value, FILES_D1], "", { empty: "" }));
[
  ["null", null],
  ["undefined", undefined],
  ["빈 배열", []],
  ["빈 문자열", ""],
  ["0", 0],
  ["false", false],
  ["true", true],
  ["숫자 5", 5],
  ["빈 객체", {}],
  ["length 0 객체", { length: 0 }],
  ["length 없는 객체", { a: 1 }],
].forEach(([cond, value], i) => add(`CA-M${String(i + 1).padStart(2, "0")}`, CA, `단지 파일 없음(${cond}) → 빈 문자열`, [BAND7, value], "", { empty: "" }));
add("CA-E90", CA, "예산대도 단지 파일도 없음 → 빈 문자열", [null, null], "", { empty: "" });
add("CA-E91", CA, "인자가 아예 없음 → 빈 문자열", [], "", { empty: "" });
add("CA-E92", CA, "단지 파일 인자가 없음(undefined) → 빈 문자열", [BAND7], "", { empty: "" });

// 후보 없음 문장: 기준 달 표기와 예산대 이름(label은 min/10000억대)
const noCells = (reference) => [{ district: "노원구", ...(reference === undefined ? {} : { reference }), cells: { 가단지: { 84: { median: 90_000, low: 1, high: 2, n: 3, quartile: false } } } }];
add("CA-N01", CA, "후보 없음: 칸은 있지만 다른 예산대 → 안내 한 문장(기준 2026년 9월)", [BAND7, noCells("202609")], CAND_EMPTY("2026년 9월", "7억대"));
add("CA-N02", CA, "후보 없음: 파일에 cells가 아예 없음", [BAND7, [{ reference: "202609" }]], CAND_EMPTY("2026년 9월", "7억대"));
add("CA-N03", CA, "후보 없음: 기준 달(reference) 없음 → '기준 달'", [BAND7, [{ district: "노원구" }]], CAND_EMPTY("기준 달", "7억대"));
add("CA-N04", CA, "후보 없음: reference 빈 문자열 → '기준 달'", [BAND7, noCells("")], CAND_EMPTY("기준 달", "7억대"));
add("CA-N05", CA, "후보 없음: reference null → '기준 달'", [BAND7, noCells(null)], CAND_EMPTY("기준 달", "7억대"));
add("CA-N06", CA, "후보 없음: reference 202601 → 1월(앞 0을 지움)", [BAND7, noCells("202601")], CAND_EMPTY("2026년 1월", "7억대"));
add("CA-N07", CA, "후보 없음: reference 202612 → 12월", [BAND7, noCells("202612")], CAND_EMPTY("2026년 12월", "7억대"));
add("CA-N08", CA, "후보 없음: reference가 4글자(2026) → 월이 0", [BAND7, noCells("2026")], CAND_EMPTY("2026년 0월", "7억대"));
add("CA-N09", CA, "후보 없음: reference가 숫자 아닌 글자(abc) → 앞 4글자 그대로·월 0", [BAND7, noCells("abc")], CAND_EMPTY("abc년 0월", "7억대"));
add("CA-N10", CA, "후보 없음: reference가 특수문자 글자 → 앞 4글자 'A&B ' + 나머지가 숫자가 아니라 NaN월, 글자는 이스케이프", [BAND7, noCells(SP)], CAND_EMPTY("A&amp;B 년 NaN월", "7억대"));
add("CA-N19", CA, "후보 없음: reference가 배열(['202609'])이면 .slice가 배열을 내 글자로 이어진다 → '202609년 0월'", [BAND7, noCells(["202609"])], CAND_EMPTY("202609년 0월", "7억대"));
add("CA-N20", CA, "후보 없음: reference가 빈 배열([], 참)이면 앞 4글자가 빈 글자 → '년 0월'", [BAND7, noCells([])], CAND_EMPTY("년 0월", "7억대"));
add("CA-N11", CA, "후보 없음: 파일 배열의 첫 항목이 null이어도 던지지 않는다 → '기준 달'", [BAND7, [null]], CAND_EMPTY("기준 달", "7억대"));
add("CA-N12", CA, "후보 없음: 첫 파일이 null이고 둘째에 후보가 없어도 같다", [BAND7, [null, { district: "노원구", reference: "202609", cells: {} }]], CAND_EMPTY("기준 달", "7억대"));
add("CA-N13", CA, "후보 없음: 파일이 문자열 배열(['x'])이면 cells가 없어 후보 없음", [BAND7, ["x"]], CAND_EMPTY("기준 달", "7억대"));
add("CA-N14", CA, "후보 없음: 칸의 중앙값이 0·null·undefined이면 거른다(`!cell.median`)", [BAND7, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 0, n: 5 } }, 나: { 84: { median: null, n: 5 } }, 다: { 84: { n: 5 } }, 라: { 84: {} } } }]], CAND_EMPTY("2026년 9월", "7억대"));
add("CA-N15", CA, "후보 없음: 파일이 문자열('ab', 길이가 있으면 글자마다 훑지만 칸이 없다)", [BAND7, "ab"], CAND_EMPTY("기준 달", "7억대"));
add("CA-N16", CA, "예산대 경계: 중앙값이 하한과 같으면 들고(70000) 상한과 같으면 빠진다(80000)", [BAND7, [{ district: "노원구", reference: "202609", cells: { 하한: { 84: { median: 70_000, low: 69_000, high: 71_000, n: 5, quartile: true } }, 상한: { 84: { median: 80_000, low: 79_000, high: 81_000, n: 5, quartile: true } } } }]],
  CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%ED%95%98%ED%95%9C"), "하한", "노원구 · 84㎡", "7억원", "가운데 절반 6억 9,000만원~7억 1,000만원 · 5건")] }));
add("CA-N17", CA, "예산대 상한(max10k)이 없으면 하한+1억까지(undefined)", [{ min10k: 70_000 }, [{ district: "노원구", reference: "202609", cells: { 안: { 84: { median: 79_999, low: 79_000, high: 80_500, n: 4, quartile: false } }, 밖: { 84: { median: 80_000, low: 79_000, high: 81_000, n: 9, quartile: false } } } }]],
  CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EC%95%88"), "안", "노원구 · 84㎡", "7억 9,999만원", "최저~최고 7억 9,000만원~8억 500만원 · 4건")] }));
add("CA-N18", CA, "예산대 상한(max10k)이 null이어도 하한+1억까지(`??`)", [{ min10k: 70_000, max10k: null }, [{ district: "노원구", reference: "202609", cells: { 안: { 84: { median: 79_999, low: 79_000, high: 80_500, n: 4, quartile: false } }, 밖: { 84: { median: 80_000, low: 79_000, high: 81_000, n: 9, quartile: false } } } }]],
  CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EC%95%88"), "안", "노원구 · 84㎡", "7억 9,999만원", "최저~최고 7억 9,000만원~8억 500만원 · 4건")] }));
// 예산대 이름은 하한 / 10000 그대로다(반올림 없음): 0억대·0.5억대·7.5억대·30억대
add("CA-L01", CA, "예산대 하한 0 → '0억대'", [{ min10k: 0, max10k: 30_000 }, noCells("202609")], CAND_EMPTY("2026년 9월", "0억대"));
add("CA-L02", CA, "예산대 하한 5000 → '0.5억대'", [{ min10k: 5_000, max10k: 15_000 }, noCells("202609")], CAND_EMPTY("2026년 9월", "0.5억대"));
add("CA-L03", CA, "예산대 하한 75000 → '7.5억대'", [{ min10k: 75_000, max10k: 85_000 }, noCells("202609")], CAND_EMPTY("2026년 9월", "7.5억대"));
add("CA-L04", CA, "예산대 하한 300000, 상한 null('30억 이상' 장) → 이름은 '30억대'", [{ min10k: 300_000, max10k: null }, noCells("202609")], CAND_EMPTY("2026년 9월", "30억대"));
add("CA-L05", CA, "예산대 하한이 음수(방어) → '-1억대'", [{ min10k: -10_000, max10k: 0 }, noCells("202609")], CAND_EMPTY("2026년 9월", "-1억대"));
add("CA-L06", CA, "예산대 상한(max10k)이 0이면 null이 아니라 0 그대로다(`??`는 0을 안 바꾼다): 중앙값 -1000만 들고 2000은 빠진다, 이름 '-0.5억대'", [{ min10k: -5_000, max10k: 0 }, [{ district: "노원구", reference: "202609", cells: { 음: { 84: { median: -1_000, low: -2_000, high: 0, n: 5, quartile: false } }, 양: { 84: { median: 2_000, low: 1_000, high: 3_000, n: 4, quartile: false } } } }]],
  CAND_FULL({ label: "-0.5억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EC%9D%8C"), "음", "노원구 · 84㎡", "-1억 -1,000만원", "최저~최고 -1억 -2,000만원~0만원 · 5건")] }));
add("CA-W01", CA, "예산대 하한이 숫자 문자열 '70000'(엄격 판정 없음): 7억대로 읽고 상한도 문자열이 이어붙어 매우 커진다(70000+10000='7000010000')", [{ min10k: "70000" }, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 75_000, low: 74_000, high: 76_000, n: 5, quartile: true } }, 나: { 84: { median: 120_000, low: 119_000, high: 121_000, n: 4, quartile: true } }, 다: { 84: { median: 69_999, low: 1, high: 2, n: 9, quartile: true } } } }]],
  CAND_FULL({ label: "7억대", n: 2, bands: "60㎡ 미만 0 · 60~85㎡ 2 · 85㎡ 초과 0", districts: "노원구 2",
    items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 5,000만원", "가운데 절반 7억 4,000만원~7억 6,000만원 · 5건"), CAND_LI(href(Q.노원구, "%EB%82%98"), "나", "노원구 · 84㎡", "12억원", "가운데 절반 11억 9,000만원~12억 1,000만원 · 4건")] }));
add("CA-W02", CA, "예산대 하한이 숫자 문자열 '70000', 상한 '80000'이 문자열이어도 비교는 숫자로", [{ min10k: "70000", max10k: "80000" }, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 75_000, low: 74_000, high: 76_000, n: 5, quartile: true } }, 나: { 84: { median: 120_000, low: 119_000, high: 121_000, n: 4, quartile: true } } } }]],
  CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 5,000만원", "가운데 절반 7억 4,000만원~7억 6,000만원 · 5건")] }));
add("CA-W03", CA, "예산대 하한이 없음({}): 비교가 모두 거짓이라 중앙값이 있는 칸이 전부 후보, 이름은 'NaN억대'·링크도 budget=NaN", [{}, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 75_000, low: 74_000, high: 76_000, n: 5, quartile: true } }, 나: { 84: { median: 1_200_000, low: 1, high: 2, n: 4, quartile: false } } } }]],
  CAND_FULL({ label: "NaN억대", more: "NaN", n: 2, bands: "60㎡ 미만 0 · 60~85㎡ 2 · 85㎡ 초과 0", districts: "노원구 2",
    items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 5,000만원", "가운데 절반 7억 4,000만원~7억 6,000만원 · 5건"), CAND_LI(href(Q.노원구, "%EB%82%98"), "나", "노원구 · 84㎡", "120억원", "최저~최고 1만원~2만원 · 4건")] }));
add("CA-W04", CA, "예산대가 true(하한 없음)여도 던지지 않고 같은 'NaN억대' 갈래", [true, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 75_000, low: 74_000, high: 76_000, n: 5, quartile: true } } } }]],
  CAND_FULL({ label: "NaN억대", more: "NaN", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 5,000만원", "가운데 절반 7억 4,000만원~7억 6,000만원 · 5건")] }));
// 칸의 값이 이상할 때: n이 3 미만이어도(문턱은 빌더 몫) 중앙값이 범위에 들면 나온다 / 문자열 n / 이름 덮어쓰기
add("CA-W05", CA, "예산대 하한·상한이 NaN이어도 같은 갈래(비교가 모두 거짓이라 중앙값이 있는 칸이 전부 후보)", [{ min10k: NaN, max10k: NaN }, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 75_000, low: 74_000, high: 76_000, n: 5, quartile: true } } } }]],
  CAND_FULL({ label: "NaN억대", more: "NaN", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 5,000만원", "가운데 절반 7억 4,000만원~7억 6,000만원 · 5건")] }));
// 구 이름 정렬은 localeCompare(…, "ko")라 기계의 기본 로케일과 무관하다: 한글 음절은 한글끼리 가나다순이고, 한글이 로마자보다 앞이다(영어 로케일이면 반대) - 곳 수가 같은 구 다섯
const LOC = (cell) => ({ 84: { median: 72_000, low: 70_000, high: 74_000, n: cell, quartile: true } });
add("CA-W50", CA, "구 이름 정렬(곳 수가 같으면 'ko' 가나다): 한글(강남구·도봉구)이 로마자(alpha·Alpha·Zeta)보다 앞 - 기계 기본 로케일과 무관",
  [BAND7, [
    { district: "도봉구", reference: "202609", cells: { 가: LOC(9) } },
    { district: "Zeta", reference: "202609", cells: { 나: LOC(8) } },
    { district: "alpha", reference: "202609", cells: { 다: LOC(7) } },
    { district: "강남구", reference: "202609", cells: { 라: LOC(6) } },
    { district: "Alpha", reference: "202609", cells: { 마: LOC(5) } },
  ]],
  CAND_FULL({ label: "7억대", n: 5, bands: "60㎡ 미만 0 · 60~85㎡ 5 · 85㎡ 초과 0", districts: "강남구 1 · 도봉구 1 · alpha 1 · Alpha 1 · Zeta 1",
    items: [
      CAND_LI(href("%EB%8F%84%EB%B4%89%EA%B5%AC", "%EA%B0%80"), "가", "도봉구 · 84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 9건"),
      CAND_LI(href("Zeta", "%EB%82%98"), "나", "Zeta · 84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 8건"),
      CAND_LI(href("alpha", "%EB%8B%A4"), "다", "alpha · 84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 7건"),
      CAND_LI(href("%EA%B0%95%EB%82%A8%EA%B5%AC", "%EB%9D%BC"), "라", "강남구 · 84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 6건"),
      CAND_LI(href("Alpha", "%EB%A7%88"), "마", "Alpha · 84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 5건"),
    ] }));
add("CA-W12", CA, "문턱은 렌더 때가 아니다: n이 1이어도 중앙값이 범위에 들면 후보(빌더가 이미 거른 칸만 들어온다는 전제)", [BAND7, [{ district: "노원구", reference: "202609", cells: { 가: { 84: { median: 72_000, low: 72_000, high: 72_000, n: 1, quartile: false } } } }]],
  CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 84㎡", "7억 2,000만원", "최저~최고 7억 2,000만원~7억 2,000만원 · 1건")] }));
const weird = (meta, cell) => [{ district: "노원구", reference: "202609", meta: { 가: meta }, cells: { 가: { 84: { median: 72_000, low: 70_000, high: 74_000, n: 6, quartile: true, ...cell } } } }];
const W = (aptText, hrefApt, extra = "") => CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, hrefApt), aptText, "노원구 · 84㎡", "7억 2,000만원", `가운데 절반 7억원~7억 4,000만원 · 6건${extra}`)] });
// 단지 이름(apt)은 칸 이름(키)이 기본이지만 meta·cell이 apt를 덮어쓰면 그 값이 글자로 나온다(legacy escapeHtml(값 ?? "")) - 비문자열 값이 글자로 어떻게 나오는지 고정
add("CA-W20", CA, "meta가 apt를 false로 덮어씀 → 글자 'false', 주소 apt=false", [BAND7, weird({ apt: false }, {})], W("false", "false"));
add("CA-W21", CA, "meta가 apt를 null로 덮어씀 → 글자 '', 주소 apt=null(encodeURIComponent(null))", [BAND7, weird({ apt: null }, {})], W("", "null"));
add("CA-W22", CA, "meta가 apt를 숫자 123으로 덮어씀 → 글자 '123'", [BAND7, weird({ apt: 123 }, {})], W("123", "123"));
add("CA-W23", CA, "meta가 apt를 0으로 덮어씀 → 글자 '0'", [BAND7, weird({ apt: 0 }, {})], W("0", "0"));
add("CA-W24", CA, "meta가 apt를 {}로 덮어씀 → 글자 '[object Object]', 주소는 %5Bobject%20Object%5D", [BAND7, weird({ apt: {} }, {})], W("[object Object]", "%5Bobject%20Object%5D"));
add("CA-W25", CA, "meta가 apt를 [1,2]로 덮어씀 → 글자 '1,2', 주소 1%2C2", [BAND7, weird({ apt: [1, 2] }, {})], W("1,2", "1%2C2"));
add("CA-W26", CA, "meta가 apt를 true로 덮어씀 → 글자 'true'", [BAND7, weird({ apt: true }, {})], W("true", "true"));
add("CA-W27", CA, "meta가 apt를 undefined로 덮어씀 → 글자 '', 주소 apt=undefined", [BAND7, weird({ apt: undefined }, {})], W("", "undefined"));
add("CA-W28", CA, "meta가 apt를 특수문자 글자로 덮어씀 → 글자는 이스케이프(& < > \"), 작은따옴표는 그대로, 주소는 퍼센트 인코딩", [BAND7, weird({ apt: SP }, {})], W(SP_OUT, "A%26B%20%3Ci%3E%20%22q%22%20it's"));
add("CA-W29", CA, "meta가 apt를 이미 이스케이프된 글자(&amp;)로 덮어씀 → 한 번 더 이스케이프", [BAND7, weird({ apt: "&amp;" }, {})], W("&amp;amp;", "%26amp%3B"));
add("CA-W30", CA, "meta가 apt를 &#x27;로 덮어씀 → & 가 이스케이프돼 '&amp;#x27;'", [BAND7, weird({ apt: "&#x27;" }, {})], W("&amp;#x27;", "%26%23x27%3B"));
add("CA-W31", CA, "단지 이름에 작은따옴표(역삼I'PARK): 글자·주소 모두 그대로(작은따옴표는 encodeURIComponent도 이스케이프도 안 바꾼다)", [BAND7, weird({ apt: "역삼I'PARK" }, {})], W("역삼I'PARK", "%EC%97%AD%EC%82%BCI'PARK"));
add("CA-W32", CA, "cell이 n을 문자열('7')로 가짐 → '7건'", [BAND7, weird({}, { n: "7" })], W("가", "%EA%B0%80").replace("6건", "7건"));
add("CA-W33", CA, "cell이 n을 없앰(undefined) → 'undefined건'", [BAND7, weird({}, { n: undefined })], W("가", "%EA%B0%80").replace("6건", "undefined건"));
add("CA-W34", CA, "cell이 low·high를 없앰 → eokText(undefined)는 NaN만원('NaN만원~NaN만원')", [BAND7, weird({}, { low: undefined, high: undefined })], W("가", "%EA%B0%80").replace("7억원~7억 4,000만원", "NaN만원~NaN만원"));
add("CA-W35", CA, "cell이 low·high를 숫자 문자열('70000')로 가짐 → 숫자로 읽는다(7억원)", [BAND7, weird({}, { low: "70000", high: "74000" })], W("가", "%EA%B0%80"));
add("CA-W36", CA, "cell의 quartile이 문자열 'false'(참) → '가운데 절반'", [BAND7, weird({}, { quartile: "false" })], W("가", "%EA%B0%80"));
add("CA-W37", CA, "cell의 quartile이 0(거짓) → '최저~최고'", [BAND7, weird({}, { quartile: 0 })], W("가", "%EA%B0%80").replace("가운데 절반", "최저~최고"));
add("CA-W38", CA, "meta가 area를 덮어씀(86 → 85㎡ 초과 평형대, 글자 '86㎡')", [BAND7, weird({ area: 86 }, {})], CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 0 · 85㎡ 초과 1", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · 86㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 6건")] }));
add("CA-W39", CA, "meta가 dong·buildYear를 비문자열로 덮어씀: dong 0·buildYear '' 은 거르고, dong {}·buildYear 1999는 글자로", [BAND7, weird({ dong: {}, buildYear: 1999 }, {})], CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "노원구 1", items: [CAND_LI(href(Q.노원구, "%EA%B0%80"), "가", "노원구 · [object Object] · 84㎡ · 1999년", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 6건")] }));
add("CA-W40", CA, "meta가 dong 0·buildYear ''로 덮어씀 → 둘 다 거른다", [BAND7, weird({ dong: 0, buildYear: "" }, {})], W("가", "%EA%B0%80"));
add("CA-W41", CA, "meta가 district를 덮어씀(특수문자 구 이름): 글자·묶음 줄은 이스케이프, 주소는 인코딩", [BAND7, weird({ district: SP }, {})], CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: `${SP_OUT} 1`, items: [CAND_LI(href("A%26B%20%3Ci%3E%20%22q%22%20it's", "%EA%B0%80"), "가", `${SP_OUT} · 84㎡`, "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 6건")] }));
add("CA-W42", CA, "meta가 district를 덮어씀(undefined): 묶음 줄 'undefined 1', 글자 목록에서는 거름, 주소 district=undefined", [BAND7, weird({ district: undefined }, {})], CAND_FULL({ label: "7억대", n: 1, bands: "60㎡ 미만 0 · 60~85㎡ 1 · 85㎡ 초과 0", districts: "undefined 1", items: [CAND_LI(href("undefined", "%EA%B0%80"), "가", "84㎡", "7억 2,000만원", "가운데 절반 7억원~7억 4,000만원 · 6건")] }));

// 후보 있음(정상 입력, 파이썬 독립 계산)
for (const [sid, g] of Object.entries(CAND_GEN)) {
  add(`CA-${sid}`, CA, g.cond, [g.band, g.files ?? BIG_FILES], g.expect);
}

// 던지는 입력: 예전 코드가 던지는 입력은 legacy도 React 조각도 같이 던진다(조용히 빈 문단을 내지 않는다)
addThrow("CA-T01", CA, "단지 파일이 iterable이 아님({length: 1}) → 던진다", [BAND7, { length: 1 }]);
addThrow("CA-T02", CA, "칸이 null(cells: {가: null}) → 던진다", [BAND7, [{ district: "노원구", reference: "202609", cells: { 가: null } }]]);
addThrow("CA-T03", CA, "칸의 평형 값이 null(cells: {가: {84: null}}) → 던진다", [BAND7, [{ district: "노원구", reference: "202609", cells: { 가: { 84: null } } }]]);
addThrow("CA-T04", CA, "reference가 숫자(202609)면 .slice가 없어 던진다(후보가 없는 칸일 때도 월 표기를 먼저 만든다)", [BAND7, [{ district: "노원구", reference: 202609, cells: {} }]]);
addThrow("CA-T05", CA, "reference가 객체({})면 던진다", [BAND7, [{ district: "노원구", reference: {}, cells: {} }]]);
addThrow("CA-T06", CA, "reference가 true면 던진다", [BAND7, [{ district: "노원구", reference: true, cells: {} }]]);
addThrow("CA-T07", CA, "reference가 숫자 5여도 던진다", [BAND7, [{ district: "노원구", reference: 5, cells: {} }]]);
addThrow("CA-T08", CA, "후보가 있고 단지 이름이 외로운 서로게이트(\\ud800)면 encodeURIComponent가 URIError를 던진다(legacy도 React도 같은 오류)", [BAND7, [{ district: "노원구", reference: "202609", cells: { "\ud800": { 84: { median: 72_000, low: 70_000, high: 74_000, n: 5, quartile: true } } } }]], "URIError");

// ================= budgetBodyHtml: 합성 =================
// 예산대가 없으면 합성 조각만 null이다(잎 조각은 "") - 자리표시 치환(applyPrerender)에서 null은 틀의 내용을 그대로 두고 ""는 비운다.
const MORE =
  `<section class="budget-more-links" data-prerendered=""><h3>매물을 보러 가기 전에</h3><ul>` +
  `<li><a href="./floor-gap.html">1층·최상층은 얼마나 싸야 정상인가</a></li>` +
  `<li><a href="./record-high.html">신고가가 나왔다는데 그 값인가</a></li>` +
  `<li><a href="./switch-house.html">갈아타기 — 갈 동네는 얼마나 올랐나</a></li>` +
  `<li><a href="./price-outlook.html">3개월 뒤 아파트값과 그 오차</a></li>` +
  `<li><a href="./cancelled-deals.html#month-section">계약에서 등기(잔금)까지 걸리는 날</a></li>` +
  `</ul></section>`;
// 합성 순서: 거래 요약 → 한눈에 → 지역 줄 → 어디로 가는가 → 예산으로 찾기(제목+칩, 인자로 받은 마크업) → 후보 단지 → 대출 → 부대비용 → 최소 현금 → 상한 → 정책대출 → 다음 질문 → 거래 목록 (#460)
const BODY = ({ summary, span = "", districts = "", where = "", answers = "", finder = "", cands = "", loan = "", costs = "", mincash = "", cap = "", policy = "", deals = "" }) =>
  `<p class="budget-summary">${summary}${span ? ` <span class="when">${span}</span>` : ""}</p>` +
  answers + (districts ? `<div class="budget-districts">거래가 많은 지역: ${districts}</div>` : "") +
  where + (finder ? `<div data-prerendered="">${finder}</div>` : "") + cands + loan + costs + mincash + cap + policy + MORE + `<ul class="budget-deals">${deals}</ul>`;
const WHERE_P = (text) => `<p class="budget-where" data-prerendered="">${text}</p>`;
const DEAL = (place, spec, when, price) =>
  `<li class="budget-deal"><span class="place">${place}</span><span class="spec">${spec}</span><span class="when">${when}</span><span class="price">${price}</span></li>`;
const bb = (eok, extra = {}) => ({ min10k: eok * 10_000, max10k: eok * 10_000 + 10_000, count: 1234, deals: [], ...extra });
const SUM = (label, count = "1,234", direct = "") => `${label}에서 ${count}건이 거래됐습니다${direct ? `(직거래 ${direct}건 포함)` : ""}.`;

// 3억대 기본 입력: 금리 있음·정책대출 건수 있음(정책대출 문단 있음)·상한 문단 없음·후보 단지 없음
const P3 = {
  answers: leaf("budgetAnswersHtml", 3, RATES_STD),
  loan: leaf("budgetLoanHtml", 3, RATES_STD),
  costs: leaf("budgetCostsHtml", 3),
  mincash: leaf("budgetMinCashHtml", 3),
  policy: leaf("budgetPolicyHtml", 3, POLICY_COUNTS),
  cap: "", // 상한 문단은 14억대부터(CP-14*) - 3억대에는 없다
};
const a3 = (band, periods = null, extra = []) => [band, periods, RATES_STD, null, null, null, POLICY_COUNTS, ...extra];
const B3 = (over = {}) => BODY({ summary: SUM("3억대"), ...P3, ...over });

// 예산대 없음 → null(빈 문자열이 아니다). 엄격 비교로 고정한다.
[
  ["null", null],
  ["undefined", undefined],
  ["0", 0],
  ["빈 문자열", ""],
  ["false", false],
].forEach(([cond, value], i) => add(`BO-N0${i + 1}`, BO, `예산대 없음(${cond}) → null`, [value, ["202609"], RATES_STD], null, { nullOut: true }));
add("BO-N06", BO, "인자가 아예 없음 → null", [], null, { nullOut: true });
add("BO-N07", BO, "예산대 없음이면 다른 인자가 이상해도(신고분 {}·옛 금리 모양 {mortgage: {}}) 읽지 않고 null", [null, {}, { mortgage: {} }, null, { length: 1 }, null, null], null, { nullOut: true });

// 신고분 기준(periodList): 없으면 span이 없다. monthLabel이 거르는 값(월이 1~12가 아니거나 읽을 수 없음)은 빠진다.
add("BO-A01", BO, "신고분 한 달(202609) → '9월 신고분 기준', 3억대·금리·정책대출 있음, 거래 없음(빈 목록)", a3(bb(3), ["202609"]), B3({ span: "9월 신고분 기준" }));
add("BO-A02", BO, "신고분 없음(undefined) → span 없음", [bb(3), undefined, RATES_STD, null, null, null, POLICY_COUNTS], B3());
add("BO-A03", BO, "신고분 null → span 없음", a3(bb(3), null), B3());
add("BO-A04", BO, "신고분 빈 배열 → span 없음", a3(bb(3), []), B3());
add("BO-A05", BO, "신고분 두 달 → '9월, 8월 신고분 기준'", a3(bb(3), ["202609", "202608"]), B3({ span: "9월, 8월 신고분 기준" }));
add("BO-A06", BO, "신고분 값이 전부 읽을 수 없음(abc·null·202613·202600·5) → span 없음", a3(bb(3), ["abc", null, "202613", "202600", 5]), B3());
add("BO-A07", BO, "신고분 일부만 읽을 수 있음 → 읽을 수 있는 달만(9월, 12월)", a3(bb(3), ["202609", "abc", null, "202613", "202600", 5, "202612"]), B3({ span: "9월, 12월 신고분 기준" }));
add("BO-A08", BO, "신고분 1월·12월 경계 → '1월, 12월'", a3(bb(3), ["202601", "202612"]), B3({ span: "1월, 12월 신고분 기준" }));
add("BO-A09", BO, "신고분 값이 숫자(202609)여도 글자로 읽는다 → 9월", a3(bb(3), [202609]), B3({ span: "9월 신고분 기준" }));
add("BO-A10", BO, "신고분 값이 undefined·빈 문자열·객체면 거른다", a3(bb(3), [undefined, "", {}, []]), B3());

// 거래 요약: 직거래 있으면 '(직거래 N건 포함)', 건수는 천 단위 쉼표, 이상한 값은 글자로
add("BO-S01", BO, "직거래 5건 → '(직거래 5건 포함)'", a3(bb(3, { direct: 5 })), B3({ summary: SUM("3억대", "1,234", "5") }));
add("BO-S02", BO, "직거래 1234건 → '1,234건' 쉼표", a3(bb(3, { direct: 1234 })), B3({ summary: SUM("3억대", "1,234", "1,234") }));
for (const [i, [cond, value]] of [["0", 0], ["null", null], ["undefined", undefined], ["빈 문자열", ""], ["false", false], ["NaN", NaN]].entries()) {
  add(`BO-S1${i}`, BO, `직거래가 거짓(${cond}) → 직거래 글자 없음`, a3(bb(3, { direct: value })), B3());
}
add("BO-S20", BO, "직거래가 문자열 '7' → '(직거래 7건 포함)'", a3(bb(3, { direct: "7" })), B3({ summary: SUM("3억대", "1,234", "7") }));
add("BO-S21", BO, "직거래가 true → 'true건'", a3(bb(3, { direct: true })), B3({ summary: SUM("3억대", "1,234", "true") }));
add("BO-S22", BO, "직거래가 {} → '[object Object]건'", a3(bb(3, { direct: {} })), B3({ summary: SUM("3억대", "1,234", "[object Object]") }));
add("BO-S23", BO, "직거래가 [] (참) → 빈 글자('(직거래 건 포함)')", a3(bb(3, { direct: [] })), B3({ summary: "3억대에서 1,234건이 거래됐습니다(직거래 건 포함)." }));
add("BO-S24", BO, "직거래가 특수문자 글자 → 요약 문장 전체가 이스케이프(' 는 그대로)", a3(bb(3, { direct: SP })), B3({ summary: `3억대에서 1,234건이 거래됐습니다(직거래 ${SP_OUT}건 포함).` }));
add("BO-S25", BO, "직거래가 [1,2] → '1,2건'", a3(bb(3, { direct: [1, 2] })), B3({ summary: SUM("3억대", "1,234", "1,2") }));
for (const [id, cond, count, text] of [
  ["BO-C01", "건수 0 → '0건'(어디로 가는가는 건수가 0이면 없다)", 0, "0"],
  ["BO-C02", "건수 999 → 쉼표 없음", 999, "999"],
  ["BO-C03", "건수 1000 → '1,000건'", 1000, "1,000"],
  ["BO-C04", "건수 1234567 → '1,234,567건'", 1_234_567, "1,234,567"],
  ["BO-C05", "건수 소수 1234.567 → '1,234.567건'(소수 셋째 자리까지)", 1234.567, "1,234.567"],
  ["BO-C06", "건수 -5 → '-5건'", -5, "-5"],
  ["BO-C07", "건수 NaN → 'NaN건'", NaN, "NaN"],
  ["BO-C08", "건수 1e21 → 쉼표로 자릿수 전부", 1e21, "1,000,000,000,000,000,000,000"],
  ["BO-C09", "건수가 숫자 문자열 '1234' → 문자열 그대로(쉼표 없음)", "1234", "1234"],
  ["BO-C10", "건수가 true → 'true건'", true, "true"],
  ["BO-C11", "건수가 {} → '[object Object]건'", {}, "[object Object]"],
  ["BO-C12", "건수가 [1,2] → '1,2건'", [1, 2], "1,2"],
  ["BO-C13", "건수가 특수문자 글자 → 이스케이프", SP, SP_OUT],
  ["BO-C14", "건수가 이미 이스케이프된 글자(&amp;) → 한 번 더", "&amp;", "&amp;amp;"],
  ["BO-C15", "건수가 빈 문자열('') → 거짓이라 어디로 가는가 없음, 요약은 '건'만", "", ""],
]) {
  add(id, BO, cond, a3(bb(3, { count })), B3({ summary: SUM("3억대", text) }));
}

// 예산대 이름(요약의 첫머리): 억 단위 반올림, 위가 비면 이상, 아래가 0이면 미만 - 하위 조각(PR A 분기 표)의 같은 입력 행을 쓴다
add("BO-L01", BO, "예산대 0~3억(하한 0) → '3억 미만', 금리 없음(대출 문단 없음)", [{ min10k: 0, max10k: 30_000, count: 1234, deals: [] }, ["202609"]],
  BODY({ summary: SUM("3억 미만"), span: "9월 신고분 기준", answers: leaf("budgetAnswersHtml", 0), costs: leaf("budgetCostsHtml", 0), mincash: leaf("budgetMinCashHtml", 0) }));
add("BO-L02", BO, "예산대 24억~위 없음(max10k null) → '24억 이상', 상한 문단(통계 없음, 링크 있음)", [{ min10k: 240_000, max10k: null, count: 1234, deals: [] }, null, null, null, null, null, null],
  BODY({ summary: SUM("24억 이상"), answers: leaf("budgetAnswersHtml", 24), costs: leaf("budgetCostsHtml", 24), mincash: leaf("budgetMinCashHtml", 24), cap: leaf("budgetCapHtml", 24, null) }));
add("BO-L03", BO, "예산대 15억대 + 몰림 통계 → 상한 문단(대책 뒤 문장·링크 없음)", [bb(15), null, null, null, null, leafArg("CP-15a", 1), null],
  BODY({ summary: SUM("15억대"), answers: leaf("budgetAnswersHtml", 15), costs: leaf("budgetCostsHtml", 15), mincash: leaf("budgetMinCashHtml", 15), cap: leaf("budgetCapHtml", 15, leafArg("CP-15a", 1)) }));

// 지역 줄·어디로 가는가(budgetWhereHtml): 상위 세 구 몫이 0.5 이상이면 '몰렸다', 아니면 구가 10개 이상일 때만 '흩어졌다', 그 밖에는 문장 없음
const dist = (...pairs) => pairs.map(([name, count]) => ({ name, count }));
const D3 = dist(["노원구", 1200], ["도봉구", 800], ["중랑구", 500]);
const DIST_LINE_3 = "노원구 1,200 · 도봉구 800 · 중랑구 500";
const WHERE_HEAVY = (label, pct, names) => WHERE_P(`${label} 거래의 ${pct}%가 ${names} 세 곳에서 나왔습니다. 이 예산으로 서울에서 고를 수 있는 곳은 사실상 여기입니다.`);
const WHERE_SPREAD = (label, n, names, pct) => WHERE_P(`${label} 거래는 ${n}개 구에 흩어져 있고 상위 세 곳(${names})을 합쳐도 ${pct}%입니다. 이 예산에서는 지역이 아니라 단지가 선택을 가릅니다.`);
const filler = (k, count) => Array.from({ length: k }, (_, i) => ({ name: `구${i + 1}`, count }));
add("BO-G01", BO, "지역 세 곳(몫 2500/3000 = 83%) → 몰렸다 문장 + 지역 줄(천 단위 쉼표)", a3(bb(3, { count: 3000, districts: D3 })), B3({ summary: SUM("3억대", "3,000"), districts: DIST_LINE_3, where: WHERE_HEAVY("3억대", 83, "노원구·도봉구·중랑구") }));
add("BO-G02", BO, "몫이 정확히 0.5(50/100) → 몰렸다(경계 포함)", a3(bb(3, { count: 100, districts: dist(["가구", 20], ["나구", 15], ["다구", 15], ["라구", 10], ["마구", 10], ["바구", 10], ["사구", 10], ["아구", 10]) })),
  B3({ summary: SUM("3억대", "100"), districts: "가구 20 · 나구 15 · 다구 15 · 라구 10 · 마구 10 · 바구 10 · 사구 10 · 아구 10", where: WHERE_HEAVY("3억대", 50, "가구·나구·다구") }));
const TEN = dist(["가구", 20], ["나구", 15], ["다구", 14], ["라구", 7], ["마구", 7], ["바구", 7], ["사구", 7], ["아구", 7], ["자구", 7], ["차구", 7]);
const TEN_LINE = "가구 20 · 나구 15 · 다구 14 · 라구 7 · 마구 7 · 바구 7 · 사구 7 · 아구 7 · 자구 7 · 차구 7";
add("BO-G03", BO, "몫 49/100 = 0.49, 구 10개 → 흩어졌다(정확히 10개가 경계)", a3(bb(3, { count: 100, districts: TEN })), B3({ summary: SUM("3억대", "100"), districts: TEN_LINE, where: WHERE_SPREAD("3억대", 10, "가구·나구·다구", 49) }));
add("BO-G04", BO, "몫 0.49, 구 9개 → 문장 없음(지역 줄만)", a3(bb(3, { count: 100, districts: TEN.slice(0, 9) })), B3({ summary: SUM("3억대", "100"), districts: TEN_LINE.split(" · ").slice(0, 9).join(" · ") }));
add("BO-G05", BO, "몫 0.49, 구 11개 → 흩어졌다('11개 구')", a3(bb(3, { count: 100, districts: [...TEN, { name: "카구", count: 1 }] })), B3({ summary: SUM("3억대", "100"), districts: `${TEN_LINE} · 카구 1`, where: WHERE_SPREAD("3억대", 11, "가구·나구·다구", 49) }));
add("BO-G06", BO, "구가 둘이면 몫이 1이어도 문장 없음(세 곳 미만)", a3(bb(3, { count: 100, districts: dist(["가구", 60], ["나구", 40]) })), B3({ summary: SUM("3억대", "100"), districts: "가구 60 · 나구 40" }));
add("BO-G07", BO, "구가 하나 → 지역 줄만", a3(bb(3, { count: 100, districts: dist(["가구", 100]) })), B3({ summary: SUM("3억대", "100"), districts: "가구 100" }));
add("BO-G08", BO, "구 목록이 없음(undefined) → 지역 줄·문장 모두 없음", a3(bb(3, { districts: undefined })), B3());
add("BO-G09", BO, "구 목록이 null → 없음", a3(bb(3, { districts: null })), B3());
add("BO-G10", BO, "구 목록이 빈 배열 → 없음", a3(bb(3, { districts: [] })), B3());
add("BO-G11", BO, "건수가 0이면 구가 많아도 어디로 가는가 문장 없음(지역 줄은 있음)", a3(bb(3, { count: 0, districts: D3 })), B3({ summary: SUM("3억대", "0"), districts: DIST_LINE_3 }));
add("BO-G12", BO, "몫이 0.4951(4951/10000), 구 10개 → '50%입니다'(0.5 미만인데 반올림해 50, 흩어졌다 갈래)", a3(bb(3, { count: 10000, districts: dist(["가구", 2000], ["나구", 1500], ["다구", 1451], ["라구", 7], ["마구", 7], ["바구", 7], ["사구", 7], ["아구", 7], ["자구", 7], ["차구", 7]) })),
  B3({ summary: SUM("3억대", "10,000"), districts: "가구 2,000 · 나구 1,500 · 다구 1,451 · 라구 7 · 마구 7 · 바구 7 · 사구 7 · 아구 7 · 자구 7 · 차구 7", where: WHERE_SPREAD("3억대", 10, "가구·나구·다구", 50) }));
add("BO-G22", BO, "몰렸다 퍼센트는 반올림이다: 2510/3000 = 83.67% → 84%(내림이면 83)", a3(bb(3, { count: 3000, districts: dist(["노원구", 1300], ["도봉구", 800], ["중랑구", 410]) })),
  B3({ summary: SUM("3억대", "3,000"), districts: "노원구 1,300 · 도봉구 800 · 중랑구 410", where: WHERE_HEAVY("3억대", 84, "노원구·도봉구·중랑구") }));
add("BO-G13", BO, "구 이름의 특수문자 → 지역 줄·문장 모두 이스케이프(' 는 그대로)", a3(bb(3, { count: 1000, districts: dist([SP, 300], ["&amp;", 200], ["x", 100]) })),
  B3({ summary: SUM("3억대", "1,000"), districts: `${SP_OUT} 300 · &amp;amp; 200 · x 100`, where: WHERE_HEAVY("3억대", 60, `${SP_OUT}·&amp;amp;·x`) }));
add("BO-G14", BO, "구 이름이 비문자열(false·null·{}) → 줄은 'false'·''·'[object Object]', 문장의 join은 null을 빈 글자로", a3(bb(3, { count: 1000, districts: dist([false, 300], [null, 200], [{}, 100]) })),
  B3({ summary: SUM("3억대", "1,000"), districts: "false 300 ·  200 · [object Object] 100", where: WHERE_HEAVY("3억대", 60, "false··[object Object]") }));
add("BO-G15", BO, "구 이름이 undefined·0·true → 줄은 ''·'0'·'true'", a3(bb(3, { count: 1000, districts: dist([undefined, 300], [0, 200], [true, 100]) })),
  B3({ summary: SUM("3억대", "1,000"), districts: " 300 · 0 200 · true 100", where: WHERE_HEAVY("3억대", 60, "·0·true") }));
add("BO-G16", BO, "구 이름이 [1,2]·숫자 → '1,2'·'5'", a3(bb(3, { count: 1000, districts: dist([[1, 2], 300], [5, 200], ["x", 100]) })),
  B3({ summary: SUM("3억대", "1,000"), districts: "1,2 300 · 5 200 · x 100", where: WHERE_HEAVY("3억대", 60, "1,2·5·x") }));
add("BO-G17", BO, "구 건수가 쉼표 없는 큰 수·소수·0 → toLocaleString 서식(1,000,000·0.5·0)", a3(bb(3, { count: 2000000, districts: dist(["가구", 1000000], ["나구", 0.5], ["다구", 0]) })),
  B3({ summary: SUM("3억대", "2,000,000"), districts: "가구 1,000,000 · 나구 0.5 · 다구 0", where: WHERE_HEAVY("3억대", 50, "가구·나구·다구") }));
add("BO-G18", BO, "구 건수가 숫자 문자열('60'): 지역 줄은 '60', 합산이 글자 이어붙이기라 몫이 비정상('602010%')", a3(bb(3, { count: 100, districts: dist(["가구", "60"], ["나구", "20"], ["다구", "10"]) })),
  B3({ summary: SUM("3억대", "100"), districts: "가구 60 · 나구 20 · 다구 10", where: WHERE_HEAVY("3억대", 602010, "가구·나구·다구") }));
add("BO-G19", BO, "구 건수가 true·{}·[1,2] → 'true'·'[object Object]'·'1,2'", a3(bb(3, { count: 100, districts: dist(["가구", true], ["나구", {}], ["다구", [1, 2]]) })),
  B3({ summary: SUM("3억대", "100"), districts: "가구 true · 나구 [object Object] · 다구 1,2" }));
add("BO-G20", BO, "구 건수가 NaN → 'NaN', 몫이 NaN이라 몰렸다 거짓·구 3개라 흩어졌다도 거짓", a3(bb(3, { count: 100, districts: dist(["가구", NaN], ["나구", 20], ["다구", 10]) })),
  B3({ summary: SUM("3억대", "100"), districts: "가구 NaN · 나구 20 · 다구 10" }));
add("BO-G21", BO, "구 건수가 NaN이고 구가 10개 → 흩어졌다 문장에 'NaN%'", a3(bb(3, { count: 100, districts: [{ name: "가구", count: NaN }, ...TEN.slice(1)] })),
  B3({ summary: SUM("3억대", "100"), districts: `가구 NaN · ${TEN_LINE.split(" · ").slice(1).join(" · ")}`, where: WHERE_SPREAD("3억대", 10, "가구·나구·다구", "NaN") }));

// 후보 단지가 본문 안에 들어가는 자리(한눈에 다음, 대출 앞)와 그 밖의 문단 순서
const P16 = {
  answers: leaf("budgetAnswersHtml", 16, RATES_STD),
  loan: leaf("budgetLoanHtml", 16, RATES_STD),
  costs: leaf("budgetCostsHtml", 16),
  mincash: leaf("budgetMinCashHtml", 16),
  cap: leaf("budgetCapHtml", 16, CAP_STATS),
  policy: "",
};
add("BO-K01", BO, "16억대: 후보 단지 있음·금리 있음·상한 문단(링크) 있음·정책대출 없음 → 문단이 모두 순서대로", [bb(16), ["202609"], RATES_STD, null, CAND_GEN.FB16.files, CAP_STATS, null],
  BODY({ summary: SUM("16억대"), span: "9월 신고분 기준", ...P16, cands: CAND_GEN.FB16.expect }));
add("BO-K02", BO, "10억대: 후보 없음 안내가 본문 안에 들어간다(한눈에 다음), 상한·정책대출 없음", [bb(10), null, RATES_STD, null, CAND_GEN.NB10.files, null, POLICY_COUNTS],
  BODY({ summary: SUM("10억대"), answers: leaf("budgetAnswersHtml", 10, RATES_STD), cands: CAND_GEN.NB10.expect, loan: leaf("budgetLoanHtml", 10, RATES_STD), costs: leaf("budgetCostsHtml", 10), mincash: leaf("budgetMinCashHtml", 10) }));
add("BO-K12", BO, "옛 금감원 금리 모양({mortgage: {}})은 읽지 않는다 → 금리 줄·대출 문단만 빠진다(전에는 던졌다: BO-T19, #577)", [bb(3), null, { mortgage: {} }], B3({ answers: leaf("budgetAnswersHtml", 3), loan: "", policy: "" }));
add("BO-K03", BO, "단지 파일이 빈 배열이면 후보 절이 없다(빈 문자열)", [bb(3), null, RATES_STD, null, [], null, POLICY_COUNTS], B3());
add("BO-K04", BO, "3억대에 정책대출 건수가 없으면(null) 정책대출 문단만 빠진다", [bb(3), null, RATES_STD, null, null, null, null], B3({ policy: "" }));
add("BO-K05", BO, "금리가 없으면(null) 한눈에의 1억당 줄과 대출 문단이 빠진다", [bb(3), null, null, null, null, null, POLICY_COUNTS],
  BODY({ summary: SUM("3억대"), answers: leaf("budgetAnswersHtml", 3), costs: P3.costs, mincash: P3.mincash, policy: P3.policy }));
add("BO-K06", BO, "셋째 인자(mortgageSeries)는 읽지 않는다 - 무엇이든 같은 출력", [bb(3), null, RATES_STD, { x: 1 }, null, null, POLICY_COUNTS], B3());
add("BO-K07", BO, "인자를 하나만(예산대) 주면 기본값(null) 갈래: 금리·후보·상한·정책대출 없음", [bb(3)], BODY({ summary: SUM("3억대"), answers: leaf("budgetAnswersHtml", 3), costs: P3.costs, mincash: P3.mincash }));
add("BO-K08", BO, "예산대에 다른 필드(facts·extra)가 있어도 본문은 읽지 않는다", [bb(3, { facts: { total: 5 }, extra: SP }), null, RATES_STD, null, null, null, POLICY_COUNTS], B3());
add("BO-K09", BO, "여덟째 인자(제목+칩 마크업)가 있으면 어디로 가는가 뒤 후보 앞에 data-prerendered 덩어리로 놓인다(마크업은 그대로)", [bb(3), null, RATES_STD, null, null, null, POLICY_COUNTS, '<h2 id="budget-heading">예산으로 찾기</h2><nav class="budget-chips" aria-label="예산대"><a href="./budget-3eok.html" aria-current="page">3억</a><a href="./budget-4eok.html">4억</a></nav>'],
  B3({ finder: '<h2 id="budget-heading">예산으로 찾기</h2><nav class="budget-chips" aria-label="예산대"><a href="./budget-3eok.html" aria-current="page">3억</a><a href="./budget-4eok.html">4억</a></nav>' }));
add("BO-K10", BO, "여덟째 인자가 빈 문자열이면 덩어리가 없다(인자를 안 준 것과 같다)", [bb(3), null, RATES_STD, null, null, null, POLICY_COUNTS, ""], B3());
add("BO-K11", BO, "여덟째 인자와 후보 단지 둘 다 있으면 후보 단지 앞에 선다 - 지역 줄·어디로 가는가 뒤", [bb(16, { count: 1000, districts: dist(["노원구", 300], ["도봉구", 200], ["중랑구", 100]) }), ["202609"], RATES_STD, null, CAND_GEN.FB16.files, CAP_STATS, null, "<h2>f</h2>"],
  BODY({ summary: SUM("16억대", "1,000"), span: "9월 신고분 기준", ...P16, districts: "노원구 300 · 도봉구 200 · 중랑구 100", where: WHERE_HEAVY("16억대", 60, "노원구·도봉구·중랑구"), finder: "<h2>f</h2>", cands: CAND_GEN.FB16.expect }));

// 거래 목록(budgetDealHtml, 맨 뒤): 네 칸(장소·규격·날짜·금액)
add("BO-D01", BO, "거래 없음 → 빈 목록 <ul class=\"budget-deals\"></ul>", a3(bb(3, { deals: [] })), B3({ deals: "" }));
add("BO-D02", BO, "거래 하나(전부 있음): 장소 '구 동 단지', 규격 '84.97㎡ · 12층', 날짜 9/5, 금액 7억 5,000만원", a3(bb(3, { deals: [{ district: "노원구", dong: "상계동", apt: "A단지", area: 84.97, floor: 12, date: "2026-09-05", amount10k: 75_000 }] })),
  B3({ deals: DEAL("노원구 상계동 A단지", "84.97㎡ · 12층", "9/5", "7억 5,000만원") }));
add("BO-D03", BO, "거래 순서는 입력 순서 그대로(정렬 없음)", a3(bb(3, { deals: [{ district: "가구", area: 59, date: "2026-01-02", amount10k: 30_000 }, { district: "나구", area: 59, date: "2026-12-31", amount10k: 100_000 }] })),
  B3({ deals: DEAL("가구", "59㎡", "1/2", "3억원") + DEAL("나구", "59㎡", "12/31", "10억원") }));
add("BO-D10", BO, "장소: 일부만 있으면 있는 것만 공백으로(구만·동만·단지만·구+단지·없음)", a3(bb(3, { deals: [{ district: "가구", area: 1 }, { dong: "나동", area: 1 }, { apt: "다단지", area: 1 }, { district: "라구", apt: "마단지", area: 1 }, { area: 1 }] })),
  B3({ deals: ["가구", "나동", "다단지", "라구 마단지", ""].map((p) => DEAL(p, "1㎡", "", "-")).join("") }));
add("BO-D11", BO, "장소 값이 거짓(0·false·null·빈 문자열)이면 거른다", a3(bb(3, { deals: [{ district: 0, dong: false, apt: "단지", area: 1 }, { district: null, dong: "", apt: undefined, area: 1 }] })),
  B3({ deals: DEAL("단지", "1㎡", "", "-") + DEAL("", "1㎡", "", "-") }));
add("BO-D12", BO, "장소 값이 비문자열(true·{}·[1,2]·5)이면 글자로(true·[object Object]·1,2·5)", a3(bb(3, { deals: [{ district: true, dong: {}, apt: [1, 2], area: 1 }, { district: 5, area: 1 }] })),
  B3({ deals: DEAL("true [object Object] 1,2", "1㎡", "", "-") + DEAL("5", "1㎡", "", "-") }));
add("BO-D13", BO, "장소의 특수문자 → 이스케이프(' 는 그대로), 이미 이스케이프된 글자는 한 번 더", a3(bb(3, { deals: [{ district: SP, dong: "&amp;", apt: "&#x27;", area: 1 }] })),
  B3({ deals: DEAL(`${SP_OUT} &amp;amp; &amp;#x27;`, "1㎡", "", "-") }));
add("BO-D14", BO, "작은따옴표 단지(역삼I'PARK) → 그대로(&#x27; 로 나오지 않는다)", a3(bb(3, { deals: [{ district: "강남구", dong: "역삼동", apt: "역삼I'PARK", area: 84, floor: 3, date: "2026-09-15", amount10k: 250_000 }] })),
  B3({ deals: DEAL("강남구 역삼동 역삼I'PARK", "84㎡ · 3층", "9/15", "25억원") }));
add("BO-D20", BO, "규격: 층이 없거나 0이면 면적만, 층이 문자열 '3'이면 '3층'", a3(bb(3, { deals: [{ area: 84 }, { area: 84, floor: 0 }, { area: 84, floor: null }, { area: 84, floor: "" }, { area: 84, floor: "3" }, { area: 84, floor: -1 }] })),
  B3({ deals: ["84㎡", "84㎡", "84㎡", "84㎡", "84㎡ · 3층", "84㎡ · -1층"].map((s) => DEAL("", s, "", "-")).join("") }));
add("BO-D21", BO, "규격: 면적이 없으면 'undefined㎡', null이면 'null㎡', NaN이면 'NaN㎡', 문자열 '84'면 '84㎡'", a3(bb(3, { deals: [{}, { area: null }, { area: NaN }, { area: "84" }, { area: 0 }, { area: 84.5 }] })),
  B3({ deals: ["undefined㎡", "null㎡", "NaN㎡", "84㎡", "0㎡", "84.5㎡"].map((s) => DEAL("", s, "", "-")).join("") }));
add("BO-D22", BO, "규격: 층이 true·{}·[]·[1,2]이면 글자로('true층'·'[object Object]층'·'층'·'1,2층')", a3(bb(3, { deals: [{ area: 1, floor: true }, { area: 1, floor: {} }, { area: 1, floor: [] }, { area: 1, floor: [1, 2] }] })),
  B3({ deals: ["1㎡ · true층", "1㎡ · [object Object]층", "1㎡ · 층", "1㎡ · 1,2층"].map((s) => DEAL("", s, "", "-")).join("") }));
add("BO-D23", BO, "규격의 특수문자(면적·층) → 이스케이프", a3(bb(3, { deals: [{ area: SP, floor: SP }, { area: "<b>", floor: "&amp;" }] })),
  B3({ deals: DEAL("", `${SP_OUT}㎡ · ${SP_OUT}층`, "", "-") + DEAL("", "&lt;b&gt;㎡ · &amp;amp;층", "", "-") }));
add("BO-D30", BO, "날짜: 연-월-일이면 'M/D'(앞 0 지움), 월·일이 모자라면 빈 글자", a3(bb(3, { deals: [{ date: "2026-09-05" }, { date: "2026-9-5" }, { date: "2026-12-31" }, { date: "2026-09" }, { date: "2026-09-" }, { date: "2026" }, { date: "" }] })),
  B3({ deals: ["9/5", "9/5", "12/31", "", "", "", ""].map((w) => DEAL("", "undefined㎡", w, "-")).join("") }));
add("BO-D31", BO, "날짜: 읽을 수 없는 값 → 빈 글자(null·undefined·숫자 20260905·true·{}·[])", a3(bb(3, { deals: [{ date: null }, { date: undefined }, { date: 20260905 }, { date: true }, { date: {} }, { date: [] }] })),
  B3({ deals: ["", "", "", "", "", ""].map((w) => DEAL("", "undefined㎡", w, "-")).join("") }));
add("BO-D32", BO, "날짜: 숫자가 아닌 월·일은 'NaN', 00월은 '0/5', 줄이 넷이면 둘째·셋째만", a3(bb(3, { deals: [{ date: "2026-ab-cd" }, { date: "2026-00-05" }, { date: "2026-9-5-7" }, { date: "x-y-z" }, { date: "2026- -5" }] })),
  B3({ deals: ["NaN/NaN", "0/5", "9/5", "NaN/NaN", "0/5"].map((w) => DEAL("", "undefined㎡", w, "-")).join("") }));
add("BO-D33", BO, "날짜: 배열 ['2026-09-05']는 글자로 바뀌어 읽힌다 → '9/5'", a3(bb(3, { deals: [{ date: ["2026-09-05"] }] })), B3({ deals: DEAL("", "undefined㎡", "9/5", "-") }));
add("BO-D40", BO, "금액: 억 단위·만원 단위·정확히 1억·1억 미만·0·음수·반올림", a3(bb(3, { deals: [75_000, 9_999, 10_000, 100_000, 123_456, 0, -5_000, 75_000.6, 0.4].map((amount10k) => ({ amount10k })) })),
  B3({ deals: ["7억 5,000만원", "9,999만원", "1억원", "10억원", "12억 3,456만원", "0만원", "-1억 -5,000만원", "7억 5,001만원", "0만원"].map((p) => DEAL("", "undefined㎡", "", p)).join("") }));
add("BO-D41", BO, "금액: 숫자가 아니면 '-'(없음·null·문자열 '75000'·NaN·Infinity·true·{}·[])", a3(bb(3, { deals: [{}, { amount10k: null }, { amount10k: "75000" }, { amount10k: NaN }, { amount10k: Infinity }, { amount10k: true }, { amount10k: {} }, { amount10k: [] }, { amount10k: SP }] })),
  B3({ deals: Array.from({ length: 9 }, () => DEAL("", "undefined㎡", "", "-")).join("") }));
add("BO-D50", BO, "거래가 12줄보다 많아도 그대로 전부(자르지 않는다 - 자르는 것은 빌더 몫)", a3(bb(3, { deals: Array.from({ length: 15 }, (_, i) => ({ district: `구${i + 1}`, area: 59, date: "2026-09-05", amount10k: 30_000 + i * 10 })) })),
  B3({ deals: Array.from({ length: 15 }, (_, i) => DEAL(`구${i + 1}`, "59㎡", "9/5", i === 0 ? "3억원" : `3억 ${i * 10}만원`)).join("") }));

// 던지는 입력: 예전 코드가 던지는 입력은 legacy도 React 조각도 같이 던진다(조용히 빈 본문을 내지 않는다)
addThrow("BO-T01", BO, "건수(count)가 없음(undefined) → 던진다", [{ min10k: 30_000, max10k: 40_000, deals: [] }]);
addThrow("BO-T02", BO, "건수가 null이면 던진다", [bb(3, { count: null })]);
addThrow("BO-T03", BO, "거래 목록(deals)이 없음 → 하위 조각을 다 부른 뒤에 던진다", [{ min10k: 30_000, max10k: 40_000, count: 5 }]);
addThrow("BO-T04", BO, "거래 목록이 null이면 던진다", [bb(3, { deals: null })]);
addThrow("BO-T05", BO, "거래 목록이 문자열이면 .map이 없어 던진다", [bb(3, { deals: "ab" })]);
addThrow("BO-T06", BO, "거래 목록이 객체({})면 던진다", [bb(3, { deals: {} })]);
addThrow("BO-T07", BO, "거래가 null이면 던진다", [bb(3, { deals: [null] })]);
addThrow("BO-T08", BO, "거래가 undefined면 던진다", [bb(3, { deals: [undefined] })]);
addThrow("BO-T09", BO, "구 목록의 항목이 null이면 던진다", [bb(3, { districts: [null] })]);
addThrow("BO-T10", BO, "구의 건수가 없음(undefined)이면 던진다", [bb(3, { districts: [{ name: "가구" }] })]);
addThrow("BO-T11", BO, "구의 건수가 null이면 던진다", [bb(3, { districts: [{ name: "가구", count: null }] })]);
addThrow("BO-T12", BO, "구 목록이 문자열이면 .map이 없어 던진다", [bb(3, { districts: "abc" })]);
addThrow("BO-T13", BO, "구 목록이 숫자면 던진다", [bb(3, { districts: 5 })]);
addThrow("BO-T14", BO, "신고분(periodList)이 문자열이면 .map이 없어 던진다", [bb(3), "202609"]);
addThrow("BO-T15", BO, "신고분이 객체({})면 던진다", [bb(3), {}]);
addThrow("BO-T16", BO, "신고분이 0이면(`?? []`는 0을 그대로 둔다) 던진다", [bb(3), 0]);
addThrow("BO-T17", BO, "신고분이 빈 문자열이면 던진다", [bb(3), ""]);
addThrow("BO-T18", BO, "신고분이 true·false면 던진다", [bb(3), true]);
addThrow("BO-T20", BO, "단지 파일이 iterable이 아님({length: 1}) → 후보 조각에서 던진다", [bb(3), null, null, null, { length: 1 }]);
addThrow("BO-T21", BO, "단지 파일의 칸이 null이면 던진다", [bb(3), null, null, null, [{ district: "노원구", reference: "202609", cells: { 가: null } }]]);
addThrow("BO-T22", BO, "예산대가 true(건수 없음)면 던진다", [true]);
addThrow("BO-T23", BO, "예산대가 문자열('x')이면 건수가 없어 던진다", ["x"]);
addThrow("BO-T24", BO, "예산대가 숫자(5)면 던진다", [5]);
addThrow("BO-T25", BO, "예산대가 배열이면 건수가 없어 던진다", [[]]);
addThrow("BO-T26", BO, "구 이름이 있고 건수가 객체지만 toLocaleString이 없는(Object.create(null)) 값이면 던진다", [bb(3, { districts: [{ name: "가구", count: Object.create(null) }] })]);

// 고정할 출력: 구 건수(count)가 숫자가 아니라 & < > " 가 든 문자열이면 React는 지역 줄의 건수를 텍스트로(이스케이프해서) 낸다.
// (옛 legacy는 이 건수를 이스케이프 없이 끼웠다 - `${districts}`의 raw 자리.)
// 실데이터(docs/data)의 구 건수는 전부 숫자라 닿지 않는다(PR 본문의 직접 센 값).
export const BUDGET_BODY_KNOWN_DIFFS = [
  { id: "KD-01", fn: BO, cond: "구 건수가 문자열 '<b>'", args: a3(bb(3, { districts: [{ name: "가구", count: "<b>" }] })), react: `<div class="budget-districts">거래가 많은 지역: 가구 &lt;b&gt;</div>` },
  { id: "KD-02", fn: BO, cond: "구 건수가 문자열 'A&B'", args: a3(bb(3, { districts: [{ name: "가구", count: "A&B" }] })), react: `<div class="budget-districts">거래가 많은 지역: 가구 A&amp;B</div>` },
  { id: "KD-03", fn: BO, cond: "구 건수가 문자열 '\"q\"'", args: a3(bb(3, { districts: [{ name: "가구", count: '"q"' }] })), react: `<div class="budget-districts">거래가 많은 지역: 가구 &quot;q&quot;</div>` },
  { id: "KD-04", fn: BO, cond: "구 건수가 객체이고 toLocaleString이 '<i>'를 돌려줌", args: a3(bb(3, { districts: [{ name: "가구", count: { toLocaleString: () => "<i>" } }] })), react: `<div class="budget-districts">거래가 많은 지역: 가구 &lt;i&gt;</div>` },
];

// ================= 내보내기 =================
export const BUDGET_CB_BRANCHES = rows;
export const BUDGET_CB_THROWS = throwsRows;
export const BUDGET_CB_FNS = [CA, BO].sort();
export const BUDGET_CB_CAND_GEN = CAND_GEN;
