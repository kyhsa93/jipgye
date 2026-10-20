// `node --import <이 파일>`로 미리 읽혀 Date.now()를 GOLDEN_MOCK_NOW(ISO) 하나로 고정한다.
// BUILD_NOW 주입 전·후 코드를 "같은 Date.now 값"에서 견주는 시험(#236 완료 조건 2)에 쓴다.
// Date.now만 바꾼다(`new Date()` 인자 없는 호출은 그대로다 — 렌더 단계 코드에는 그 호출이 없다).
const raw = process.env.GOLDEN_MOCK_NOW;
if (raw) {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new Error(`GOLDEN_MOCK_NOW를 읽을 수 없습니다: ${raw}`);
  Date.now = () => t;
}
