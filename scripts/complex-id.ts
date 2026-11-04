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
 */

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

/**
 * 원본 한 줄의 단지 키. 구를 가로질러 한 줄씩 칸을 묶는 통계 빌더(#843)가 쓴다 - 줄의 sggCd 로 그 구의 동명 단지를 찾는다.
 * sameByCode: readSameNames 결과(구 코드 → 동명 단지). 없으면 aptNm 그대로라 칸 키가 #843 전과 같다.
 */
export function itemComplexKey(item, sameByCode) {
  return complexKey(item?.aptNm, item?.umdNm, sameByCode?.[item?.sggCd]);
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
