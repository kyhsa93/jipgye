/**
 * 단지 칸의 키 (#821). 칸을 이름으로 묶는 빌더와 화면이 모두 이 키를 쓴다 - 파일끼리 키가 어긋나면 카드가 칸을 못 찾는다.
 *
 * 이름은 구 안에서도 유일하지 않다. 성동구 「벽산」은 금호동1가 17.9~20.0억, 사근동 10.2~10.8억, 하왕십리동 16.8~17.1억이
 * 한 중앙값으로 묶였다(n≥3 칸 3,051개 중 68개, 2026-11-03 원본). 그 68개 가운데 64개는 동이 갈리고, 나머지 4개는 강동리버스트
 * 4·8단지뿐인데 지번은 둘이어도 전월세 원본의 aptSeq 가 하나인 한 단지다. 그래서 **동으로만** 가른다. 원본 24개월에서 같은 aptSeq 가
 * 두 동에 걸친 이름은 0개라 동으로 가르다 한 단지를 쪼개는 일은 없다. 같은 동 안에서 지번이 갈리는 이름 33개(aptSeq 하나 4개)는
 * 지번만으로 한 단지인지 가를 수 없어 그대로 두고, 위치 키 전체와 별칭표를 만들 때 함께 본다.
 *
 * 이름이 구 안에서 한 동에만 있으면 키는 이름 그대로다 - 그 칸의 키·값·원장 해시가 바뀌지 않는다. 둘 이상의 동에 있으면 「이름 (동)」이고,
 * 이 글자가 화면의 단지 이름이기도 하다. 브라우저는 키를 계산하지 않고 받은 글자를 쓰므로 드리프트 검사가 필요 없다.
 *
 * 어느 이름이 갈리는지는 창마다 따로 세지 않고 그 구의 원본 전체(매매+전월세, 보관 24개월)로 한 번만 정한다. 6개월 창으로 세면 지금은 한 동만
 * 거래된 이름이 위치 파일에선 「벽산」, 24개월 추이와 재계약 파일에선 「벽산 (사근동)」이 되어 맞물리지 않고, 1년 전 값과 추이에는 다른 동이 섞인다.
 *
 * 저장 ID (#816 충돌 A). 위 키는 화면의 단지 이름이고, 근거표(reco-*.json)가 저장에 쓰는 ID 는 따로 위치 키(`구코드|법정동|지번|단지명`)다. 관심 단지·주소·재방문 비교에 남는 값이라
 * 창이 굴러도, 다른 데이터가 들어와도 바뀌면 안 되고, 정의가 공개되지 않은 값에 혼자 기대서도 안 된다. 전월세 원본의 aptSeq 를 ID 로 쓰면 셋에 다 걸린다 - 공식 정의를 못 찾았고,
 * 전월세가 창에서 끊긴 단지는 ID 가 바뀐다. 그래서 aptSeq 는 별칭을 찾을 때만 쓰고(aliasCandidates), 찾은 것은 아래 추가 전용 표에 옮겨 적는다.
 */

import { normalizeJibun } from "./official-price-key.ts";

/** 원본 줄들에서 둘 이상의 동에 나타나는 단지명. seen 을 넘기면 파일을 나눠 읽어도 이어서 센다. */
export function sameNames(items, seen = new Map<string, string>(), out = new Set<string>()) {
  for (const item of items ?? []) {
    const name = String(item?.aptNm ?? "").trim();
    const dong = String(item?.umdNm ?? "").trim();
    if (!name || !dong) continue;
    if (!seen.has(name)) seen.set(name, dong);
    else if (seen.get(name) !== dong) out.add(name);
  }
  return out;
}

/** 칸 키. same: 그 구의 sameNames 결과. 이름이 유일하면 받은 글자를 그대로 돌려준다. */
export function complexKey(apt, dong, same) {
  const name = String(apt ?? "").trim();
  const place = String(dong ?? "").trim();
  return place && same?.has(name) ? `${name} (${place})` : apt;
}

/** 키에서 동을 뗀 이름. 동을 바로 앞에 따로 적는 문장(자치구 해설)에서 쓴다. */
export function complexName(key, dong) {
  const tail = ` (${dong})`;
  return String(key ?? "").endsWith(tail) ? key.slice(0, -tail.length) : key;
}

/** 칸으로 묶기 전 거래({ apt, dong }). 이름이 유일하면 그 객체를 그대로 돌려준다 - 값도 순서도 그대로다. */
export function keyedDeal(deal, same) {
  const apt = complexKey(deal.apt, deal.dong, same);
  return apt === deal.apt ? deal : { ...deal, apt };
}

/**
 * 원본 한 줄(sale·rent 공통 필드)의 위치 키. 지번은 공시가격 칸과 같은 정규화이고, 못 읽는 지번은 받은 글자 그대로 둔다 - 칸이 사라지면 그 거래가 뺀 곳에도 안 잡힌다.
 * 표본 등급 사전 등록의 칸 키와 같은 모양이다(research/sample-grade-2026-11/PREREG.md 2절).
 */
export function locationKey(item) {
  const jibun = String(item?.jibun ?? "").trim();
  return [String(item?.sggCd ?? "").trim(), String(item?.umdNm ?? "").trim(), normalizeJibun(jibun) ?? jibun, String(item?.aptNm ?? "").trim()].join("|");
}

/**
 * 위치 키 → 그 단지의 저장 ID. **추가 전용이다.** 저장된 ID 를 깨지 않으려면 줄을 지우거나 오른쪽을 바꾸면 안 된다. 입력을 받지 않는 상수라 전월세 창이 줄어도 ID 가 그대로다.
 * 같은 aptSeq 인데 매매가 둘 다에 있는 위치 키만 적었다(raw/rent 24개월 + raw/sale, 2026-11-03, scripts/dev/complex-alias-candidates.mjs). 오른쪽은 그때 매매가 많은 쪽이고 그 뒤로 고정이다.
 * 같은 aptSeq 인데 매매가 한 ID 이하에만 있는 3건(래미안라그란데 432, 이랜드PEERDMC, 학마을3단지아파트)은 합칠 칸이 없어 아직 적지 않았다.
 */
export const COMPLEX_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "11440|신수동|462|신촌숲아이파크": "11440|신수동|462|마포아이파크포레",
  "11740|강일동|742|강동리버스트4단지": "11740|강일동|114|강동리버스트4단지",
  "11740|강일동|66|강동리버스트8단지": "11740|강일동|746|강동리버스트8단지",
});

/** 위치 키의 저장 ID. 표에 없으면 위치 키 그대로다. */
export function stableId(key, aliases = COMPLEX_ALIASES) {
  return aliases[key] ?? key;
}

/** 저장 ID 에 묶인 다른 위치 키들(사전순). 옛 키로 저장한 관심 단지를 찾는 쪽이 쓴다. */
export function aliasesOf(id, aliases = COMPLEX_ALIASES) {
  return Object.keys(aliases).filter((key) => aliases[key] === id).sort();
}

/**
 * 별칭 후보: 같은 aptSeq 에 저장 ID 가 둘 이상 남는 묶음. 사람이 보고 표에 옮긴다 - 빌더가 쓰지 않는다(ID 가 전월세 입력에 기대게 되므로).
 * 한 위치 키에 aptSeq 가 둘인 줄(2026-11-03에 6곳, 대개 한쪽이 몇 건)은 위치 키가 그대로 ID 라 여기서 문제가 되지 않는다.
 */
export function aliasCandidates(items, aliases = COMPLEX_ALIASES) {
  const bySeq = new Map<string, Set<string>>();
  for (const item of items ?? []) {
    const seq = String(item?.aptSeq ?? "").trim();
    if (!seq || !String(item?.aptNm ?? "").trim()) continue;
    if (!bySeq.has(seq)) bySeq.set(seq, new Set());
    bySeq.get(seq).add(stableId(locationKey(item), aliases));
  }
  return [...bySeq]
    .filter(([, ids]) => ids.size > 1)
    .map(([seq, ids]) => ({ seq, ids: [...ids].sort() }))
    .sort((a, b) => (a.seq < b.seq ? -1 : 1));
}
