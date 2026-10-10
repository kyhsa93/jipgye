/**
 * 건축HUB 주택인허가(HsPmsHubService) 수집·접기가 기대는 가정 한 곳 (#130, #58 단계 A).
 *
 * 이 파일의 이름들은 전부 **가정**이다 - 2026-10-10 기준으로 data.go.kr 15136560 페이지 요약만 봤고
 * 오퍼레이션 정확한 이름과 응답 필드 명세는 열어 보지 못했다(ceo 계획 2026-10-10 절 10). 첫 실호출에서
 * 틀리면 수집기는 아무것도 쓰지 않고 실패한다(housing-permits-fold.mjs의 필드 검사). 명세를 읽은 뒤
 * 틀린 것은 여기 한 곳만 고친다 - 접기·수집기·시험은 이 상수를 거쳐 쓴다.
 */

/** 공개 주소다(키 아님). 최종 값과 상수/환경변수 선택은 cto 결정 - 환경변수 BUILDINGHUB_API_ENDPOINT가 덮어쓴다. */
export const DEFAULT_ENDPOINT = "https://apis.data.go.kr/1613000/HsPmsHubService";

/** [가정] 사업 단위 목록을 주는 오퍼레이션(주택인허가 기본개요). sigunguCd·bjdongCd 필수는 전략 회의(10-04)에서 확인된 사실. */
export const OPERATION = "getHpBasisOulnInfo";

/** [가정] 응답 항목의 필드 이름. */
export const FIELDS = {
  id: "mgmPmsrgstPk", // 사업 식별(관리번호). 같은 사업의 변경·재신고는 같은 값
  sigungu: "sigunguCd", // 시군구 코드 5자리
  units: "hhldCnt", // 세대·호수
  cancel: "cnclDay", // 취소·소멸일. 값이 있으면 취소 사업
  version: "crtnDay", // 신고 판 날짜(같은 사업의 여러 판 중 최신을 고르는 기준)
  dates: {
    permit: "archPmsDay", // 사업승인(인허가)일
    start: "stcnsDay", // 착공일
    complete: "useAprDay", // 사용승인(준공)일
  },
};

/** 접는 날짜 계열. FIELDS.dates의 키와 같다. */
export const SERIES = ["permit", "start", "complete"];

/**
 * 일 호출 한도. 개발계정 일 10,000건(data.go.kr 페이지 표기, 계정 종류는 미확인)의 절반 이하만 쓴다 -
 * 소유자 조건 5(#133 댓글 2026-10-10). 환경변수 BUILDINGHUB_DAILY_LIMIT은 이보다 낮게만 줄일 수 있다.
 */
export const DAILY_LIMIT = 5000;

/**
 * 이용허락범위. 응답에는 없고 data.go.kr 포털 페이지 속성이라 응답만으로 확인할 수 없다 - 그래서
 * 사람이 페이지에서 읽은 문자열을 dispatch 입력(--license)으로 받아 이 값과 견주고, 다르면 호출 전에 멈춘다
 * (소유자 조건 4, official-price 선례). checkedOn은 이 상수를 정한 근거를 확인한 날이다:
 * clo #132의 1~3 결론이 "제한 없음"으로 돌아온 것을 #133 본문이 적은 날(2026-10-10). 약관 원문 조항은 미확인.
 */
export const LICENSE = { text: "제한 없음", checkedOn: "2026-10-10" };

/** [가정] 한 쪽 건수. 서버 상한은 미확인. */
export const PAGE_SIZE = 100;

/**
 * 접기에 필요한 필드. 응답 항목은 이 필드만 남기고 나머지(사업주체명·지번·사업명 등)는 받자마자 버린다 -
 * 사업 단위 원본을 메모리에도 오래 두지 않고 소유자 조건 1을 코드로 지킨다. 8개다(cto 항목은 "7개"라 적었으나
 * 시군구 코드까지 세면 사업 식별·시군구·호수·취소·판·날짜 셋으로 8개이고, 시군구는 응답 검증에도 쓴다).
 */
export const PROJECTED_FIELDS = [FIELDS.id, FIELDS.sigungu, FIELDS.units, FIELDS.cancel, FIELDS.version, ...Object.values(FIELDS.dates)];
