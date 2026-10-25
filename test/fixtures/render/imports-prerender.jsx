import { summaryHtml } from "../../../scripts/prerender.ts";
export const fragments = { x: () => <p>{String(typeof summaryHtml)}</p> };
