import { marketHtml } from "../../../scripts/prerender.ts";
export const fragments = { x: () => <p>{String(typeof marketHtml)}</p> };
