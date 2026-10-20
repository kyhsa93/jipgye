/**
 * 공시가격 칸 키 (#68). 실거래 원본(raw/sale·raw/rent)과 공시가격 CSV가 같은 칸을 가리키게 하는
 * 함수 하나다. 접기(official-price-fold.mjs)·data-analyst의 분모·#23 비율 빌더가 모두 이걸
 * import한다 - 두 곳에서 따로 정규화하면 매칭률이 조용히 갈린다.
 *
 * 칸 = (시군구, 법정동, 지번 정규화, 전용면적 0.1㎡).
 */

/**
 * 지번 정규화. 실거래는 `199`·`62-2`(숫자 또는 문자열), 공시가격은 본번·부번이 따로 올 수 있어
 * 둘 다 "본번[-부번]"으로 맞춘다. 앞자리 0은 지우고, 부번 0은 없는 것으로 본다. 산 지번은 `산` 접두.
 * 읽을 수 없으면 null.
 */
export function normalizeJibun(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  const m = /^(산)?0*(\d+)(?:-0*(\d+))?$/.exec(text);
  if (!m) return null;
  const [, san, main, sub] = m;
  const bon = String(Number(main));
  const bu = sub === undefined ? "0" : String(Number(sub));
  return `${san ?? ""}${bon}${bu === "0" ? "" : `-${bu}`}`;
}

/** 본번·부번 열이 따로 있는 파일용. 부번이 비었으면 0. */
export function joinJibun(main, sub) {
  const bon = String(main ?? "").trim();
  if (!bon) return null;
  const bu = String(sub ?? "").trim();
  return normalizeJibun(bu ? `${bon}-${bu}` : bon);
}

/** 전용면적(㎡)을 0.1㎡ 칸으로. 양수가 아니면 null. 문자열 "84.9700"도 받는다. */
export function areaKey(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  if (!(n > 0)) return null;
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** 시군구 코드는 앞 5자리(법정동코드 10자리가 와도 같은 값). */
export function sigunguOf(value) {
  const text = String(value ?? "").trim();
  return /^\d{5}/.test(text) ? text.slice(0, 5) : null;
}

/** 지번 단위 키 - 호수 집계용. 하나라도 못 읽으면 null. */
export function parcelKey(sigungu, dong, jibun) {
  const s = sigunguOf(sigungu);
  const d = String(dong ?? "").trim();
  const j = normalizeJibun(jibun);
  if (!s || !d || !j) return null;
  return `${s}|${d}|${j}`;
}

/** 칸 키. 면적을 못 읽으면 null. */
export function cellKey(sigungu, dong, jibun, area) {
  const p = parcelKey(sigungu, dong, jibun);
  const a = areaKey(area);
  if (!p || !a) return null;
  return `${p}|${a}`;
}

/** 실거래 원본 한 줄(sale·rent 공통 필드)의 지번 키. */
export function parcelKeyOfDeal(item) {
  return parcelKey(item?.sggCd, item?.umdNm, item?.jibun);
}

/** 실거래 원본 한 줄의 칸 키. */
export function cellKeyOfDeal(item) {
  return cellKey(item?.sggCd, item?.umdNm, item?.jibun, item?.excluUseAr);
}
