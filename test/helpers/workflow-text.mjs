// 워크플로 문자열 시험이 "렌더 단계가 이 순서로 돈다"를 읽는 길. 두 워크플로는 여섯(summarize는 다섯) 렌더 스크립트를
// 한 줄씩 부르지 않고 `node scripts/render-pipeline.mjs [단계…]` 한 줄로 부른다(#238 F1 최소판) - 그 한 줄을 안 쪽 스크립트
// 호출로 펼쳐서, 순서·포함을 보는 기존 시험이 워크플로 구조가 바뀌어도 같은 말을 하게 한다. 인자가 없으면 기본 단계다.
import { RENDER_STEPS } from "../../scripts/render-pipeline.mjs";

// 스크립트 확장자는 .mjs 하나로 박지 않는다(#418, #316 0단계) - 개명이 호출 줄을 조용히 놓치지 않게 한다.
const CALL = /node scripts\/render-pipeline\.(?:mjs|ts)((?:[ \t]*\\?\s*scripts\/[a-z-]+\.(?:mjs|ts))*)/g;

export function expandRenderPipeline(text) {
  return text.replace(CALL, (_, args) => {
    const given = [...args.matchAll(/scripts\/[a-z-]+\.(?:mjs|ts)/g)].map((m) => m[0]);
    return (given.length ? given : RENDER_STEPS).map((s) => `node ${s}`).join("\n");
  });
}
