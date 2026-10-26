// 기사 제목 → 분류(규칙 기반, 유료 API 없음). 키워드가 제목에 들어 있으면 그 분류이고, 앞 분류가 먼저 이긴다.
// exclude 는 키워드를 품었지만 뜻이 다른 말이다(#745 PR6) - 제목에서 먼저 지운 뒤 키워드를 찾는다.
// 예: 「전세계」의 「전세」(「전세계약」은 지키려고 정규식), 「차익매물」의 「매물」(증시 기사). 「세제」는 세법 전반이라 키워드에서 뺐다.
// 수집기(fetch-news)와 빌드(build-news-pages)가 같은 규칙을 쓴다. 빌드는 이미 모은 news.json 의 분류를 이 규칙으로 다시 매긴다.
// 실제 오분류 회귀 사례는 test/news-categories.test.mjs 가 지킨다.
export const CATEGORIES = [
  {
    key: "rates",
    name: "금리·예금·투자상품",
    nameEn: "Rates, Deposits & Investment Products",
    keywords: ["금리", "예금", "저축", "IMA", "발행어음", "펀드", "채권", "증권사"],
    exclude: [],
  },
  {
    key: "realestate",
    name: "부동산",
    nameEn: "Real Estate",
    keywords: ["아파트", "부동산", "전세", "월세", "매물", "분양", "주택", "재건축", "재개발", "청약", "집값", "종부세", "보유세", "오피스텔"],
    exclude: [/전세계(?!약)/g, /전세기(?!간)/g, "전세버스", "전세 버스", "차익매물", "이익매물", "차익 매물", "매물 출회", "매물폭탄", "매물 폭탄"],
  },
  {
    key: "stocks",
    name: "증시·환율",
    nameEn: "Stocks & FX",
    keywords: ["코스피", "코스닥", "증시", "주가", "환율", "달러", "원화"],
    exclude: [],
  },
];

export const FALLBACK_CATEGORY = {
  key: "other",
  name: "기타 경제 소식",
  nameEn: "Other Economic News",
  keywords: [],
  exclude: [],
};

const BY_KEY = new Map([...CATEGORIES, FALLBACK_CATEGORY].map((c) => [c.key, c]));

const matches = (c, title) => {
  const t = c.exclude.reduce((s, x) => s.replaceAll(x, " "), title); // 문자열 또는 g 정규식
  return c.keywords.some((k) => t.includes(k));
};

export function categorizeTitle(title) {
  return CATEGORIES.find((c) => matches(c, title ?? "")) ?? FALLBACK_CATEGORY;
}

export function categoryOf(item) {
  return (item.category && BY_KEY.get(item.category)) || categorizeTitle(item.title);
}
