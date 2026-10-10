/**
 * 실제 응답 item 모양의 합성 항목 (#133). 키 30개와 값의 타입(숫자·문자열)은 실제 응답 진단 로그(run 38025773084·38026334171·
 * 38027776105)에서 읽은 모양이고, 값은 전부 지어낸 것이다. 필드 이름을 FIELDS 상수 거쳐 쓰지 않고 실제 이름을 그대로 적어,
 * spec의 매핑이 실제 이름에서 벗어나면(예: 옛 가정 mgmPmsrgstPk) 시험이 빨개지게 한다.
 */
export const REAL_KEYS = [
  "apprvDay", "bjdongCd", "bldNm", "block", "bun", "crtnDay", "demolEndDay", "demolExtngDay", "demolExtngGbCd", "demolExtngGbCdNm",
  "demolStrtDay", "ji", "lot", "mainBldCnt", "mgmHsrgstPk", "platGbCd", "platPlc", "purpsCd", "purpsCdNm", "rnum",
  "sigunguCd", "splotNm", "stcnsDay", "stcnsSchedDay", "strctCd", "strctCdNm", "totArea", "totHhldCnt", "useInsptDay", "useInsptSchedDay",
];

let seq = 0;

/** 실제 키 30개를 모두 가진 항목. mgmHsrgstPk·totHhldCnt는 숫자, 나머지는 문자열(실제 응답과 같다). */
export function realItem(over = {}) {
  seq += 1;
  return {
    apprvDay: "20240315", bjdongCd: "10100", bldNm: `합성단지${seq}`, block: "", bun: "0001", crtnDay: "20240320",
    demolEndDay: "", demolExtngDay: "", demolExtngGbCd: "", demolExtngGbCdNm: "", demolStrtDay: "", ji: "0000", lot: "",
    mainBldCnt: "1", mgmHsrgstPk: 900000 + seq, platGbCd: "0", platPlc: "서울특별시 합성구 합성동", purpsCd: "01000", purpsCdNm: "단독주택",
    rnum: seq, sigunguCd: "11110", splotNm: "", stcnsDay: "20240601", stcnsSchedDay: "", strctCd: "11", strctCdNm: "벽돌구조",
    totArea: "100.5", totHhldCnt: 10, useInsptDay: "", useInsptSchedDay: "", ...over,
  };
}
