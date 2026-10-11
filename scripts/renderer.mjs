// 렌더러 스위치 (#237). `JIPGYE_RENDERER=legacy|react`로 조각 함수(`prerender.mjs`의 `*Html()`)를 어느 쪽이 그릴지 고른다.
//
// - 기본값은 legacy다(미설정·빈 문자열). 이 경우 로더·esbuild·react를 import하지 않는다 - 아래 동적 import가 react일 때만 돈다.
// - react 모드는 이식된 조각(`render/entry.jsx`의 `fragments`)만 React로 그리고, 나머지는 legacy에 맡긴다.
//   이 PR 시점에는 이식된 조각이 없어서 두 모드의 출력이 같다.
// - 로더·진입 모듈·조각 렌더의 오류는 예외로 올라간다. react가 실패했다고 조용히 legacy로 넘기지 않는다(폴백은 #238, 워크플로 쪽).
// - 읽을 수 없는 값은 legacy로 넘기지 않고 멈춘다(`buildNowMs`와 같은 원칙: 틀린 값이 조용히 기본 동작이 되면 비교가 거짓이 된다).
//
// 모듈 최상위에서 await한다: 조각 함수는 동기라서 로더(비동기)가 import 시점에 끝나 있어야 한다.

export function rendererMode(env = process.env) {
  const value = env.JIPGYE_RENDERER;
  if (value === undefined || value === "") return "legacy";
  if (value === "legacy" || value === "react") return value;
  throw new Error(`JIPGYE_RENDERER를 읽을 수 없습니다(legacy 또는 react): ${JSON.stringify(value)}`);
}

export const RENDERER = rendererMode();

const react = RENDERER === "react" ? await (await import("./render/react.mjs")).createReactRenderer() : null;

/** 이식된 조각 이름. legacy 모드에서는 로더를 부르지 않으므로 항상 빈 배열이다. */
export const portedFragments = () => (react ? react.names() : []);

/**
 * 조각 함수 래퍼를 만드는 공장. 이름과 인자는 legacy 함수와 같고, 이식된 조각만 React로 그린다.
 * 원본은 `.legacy`로 남긴다(parity 시험이 같은 입력으로 둘을 견준다). 렌더러를 받는 것은 시험이 가짜·fixture 렌더러를 끼우기 위해서다.
 */
export const makeFragment = (renderer) => (name, legacy) => {
  const wrapped = (...args) => (renderer?.has(name) ? renderer.render(name, args) : legacy(...args));
  Object.defineProperty(wrapped, "name", { value: name });
  wrapped.legacy = legacy;
  return wrapped;
};

/** `prerender.mjs`가 `*Html()` 하나하나를 감싸는 래퍼. 모드는 import 때 정해진 하나다. */
export const fragment = makeFragment(react);
