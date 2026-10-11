// 이식된 조각의 목록 (#237). 이 PR 시점에는 비어 있다 - #240(금리 4개 상품군)과 #241~#243이 채운다.
// 이름은 prerender.mjs의 `*Html()` 함수 이름 그대로, 값은 같은 인자를 받아 React 요소를 돌려주는 함수다.
// 여기서 `scripts/renderer.mjs`·`scripts/prerender.mjs`를 불러오면 안 된다(로더가 막는다).
export const fragments = {};
