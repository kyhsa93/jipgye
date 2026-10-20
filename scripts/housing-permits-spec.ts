/**
 * 건축HUB 주택인허가(HsPmsHubService) 수집·접기가 기대는 가정 한 곳 (#130, #58 단계 A).
 *
 * 응답 필드 이름은 명세와 실제 응답 키로 확인돼 PREREG 5절이 고정했다(아래 FIELDS). 오퍼레이션 이름·쪽 크기는
 * 첫 실호출 전의 가정이 남아 있다. 틀리면 수집기는 아무것도 쓰지 않고 실패한다(housing-permits-fold.mjs의 필드 검사).
 * 고칠 것은 여기 한 곳만 고친다 - 접기·수집기·시험은 이 상수를 거쳐 쓴다.
 */

/** 공개 주소다(키 아님). 최종 값과 상수/환경변수 선택은 cto 결정 - 환경변수 BUILDINGHUB_API_ENDPOINT가 덮어쓴다. */
export const DEFAULT_ENDPOINT = "https://apis.data.go.kr/1613000/HsPmsHubService";

/** [가정] 사업 단위 목록을 주는 오퍼레이션(주택인허가 기본개요). sigunguCd·bjdongCd 필수는 전략 회의(10-04)에서 확인된 사실. */
export const OPERATION = "getHpBasisOulnInfo";

/**
 * 응답 항목의 필드 이름. PREREG 5절(명확화 2)이 고정한 매핑이다 - 명세(data.go.kr 15136560 swagger)와 실제 응답
 * item 30개 키(#133 진단 로그 run 38025773084·38026334171·38027776105)로 확인했고 값은 보지 않았다.
 * 코드가 PREREG를 따른다: 여기를 PREREG와 다르게 고치려면 PREREG 개정이 먼저다.
 */
export const FIELDS = {
  id: "mgmHsrgstPk", // 관리주택대장PK(숫자). 접기 키 단독 (PREREG 5절 「접기 키와 단위」)
  sigungu: "sigunguCd", // 시군구 코드 5자리
  units: "totHhldCnt", // 총세대수(숫자). 0·비숫자는 호수 합에 0, n에는 센다 (PREREG 5절 「호수」)
  version: "crtnDay", // '그 행의 생성일'이지 신고 판 날짜가 아니다. 같은 PK 중복의 우선 기준일 뿐 (PREREG 「접기 키와 단위」)
  tieBreak: "apprvDay", // crtnDay·totHhldCnt까지 같을 때의 셋째 기준 (PREREG 「접기 키와 단위」)
  dates: {
    permit: "apprvDay", // 건축허가일. 결과 문장에서는 '건축허가일 기준 인허가'
    start: "stcnsDay", // 착공일
    // 아직 정해지지 않았다(null). PREREG 「complete 필드 해소 규칙」이 전수 진단의 두 지표로만 정한다 - 명세가 두 필드의
    // 이름과 뜻을 뒤바꿔 적어 어느 쪽도 먼저 믿지 않는다. 정해지기 전에는 complete 계열을 만들지 않는다.
    // 규칙이 한 필드를 고르면 이 한 줄만 그 필드 이름으로 바꾼다. 못 고르면 null로 두고 후보 ②는 시험 불가다.
    complete: null,
  },
};

/** complete 필드 후보 둘(PREREG 「complete 필드 해소 규칙」). 보관만 한다 - 어느 쪽도 고르지 않았다. */
export const COMPLETE_CANDIDATES = ["useInsptDay", "useInsptSchedDay"];

/**
 * 취소는 이 응답에서 관측할 수 없다(PREREG 5절 「취소 판정」 4항, A안): 응답 item 30개 키에 취소·폐기·판·상태를 뜻하는
 * 필드가 없다. 그래서 접기는 취소를 구분하지 않고, "0건"이라 부르지도 않는다. 취소 필드를 추측해 넣지 않는다.
 */
export const CANCELLATION = "관측 불가";

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

/**
 * [가정] 한 쪽 건수. 쪽 크기를 올릴 수 있는지는 이 저장소에서 확인되지 않았고 이 값은 올리지 않았다(#141).
 *  - [사실] 법정동이 467곳이라 호출은 최소 467건이고, 동마다 마지막 쪽이 남아 쪽 크기가 클수록 호출이 준다.
 *    수집기는 환경변수 BUILDINGHUB_PAGE_SIZE로 값을 바꿀 수 있고(0·비수는 이 기본값), 시험 호출 모드의 요약에
 *    "요청 쪽 크기"와 "한 쪽 최대 수신 항목"이 같이 남는다.
 *  - [추정] 서버가 numOfRows 상한을 걸어 요청보다 적게 돌려줄 수 있다(data.go.kr 일반 관행). 이 서비스의 상한은
 *    명세를 열어 보지 못해 모른다. 요약의 두 수가 다르면 그 수가 상한의 하한 증거다.
 *  - 상향하려면 data.go.kr 15136560 명세(오퍼레이션 요청 변수 numOfRows 설명)를 사람이 열어 상한을 확인한 뒤
 *    이 상수 한 곳만 고친다. 호출량(일 한도 5000)에 직접 걸리므로 상향 자체는 호출 수를 줄이는 쪽이다.
 */
export const PAGE_SIZE = 100;

/**
 * 접기에 필요한 필드. 응답 항목은 이 필드만 남기고 나머지(사업명·지번 등)는 받자마자 버린다 -
 * 사업 단위 원본을 메모리에도 오래 두지 않고 소유자 조건 1을 코드로 지킨다. 식별·시군구·호수·crtnDay·apprvDay·
 * stcnsDay와 complete 후보 둘, 모두 8개다. complete 후보는 해소 전이라 둘 다 남긴다. 취소 필드는 응답에 없어 없다.
 */
export const PROJECTED_FIELDS = [
  ...new Set([FIELDS.id, FIELDS.sigungu, FIELDS.units, FIELDS.version, FIELDS.tieBreak, ...Object.values(FIELDS.dates).filter(Boolean), ...COMPLETE_CANDIDATES]),
];
