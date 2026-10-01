// 3차 후보 계열을 처음부터 받는다(매일 수집은 최근 14개월만 다시 받으므로, 긴 머리는 여기서 한 번).
// node research/indicators-3/fetch.mjs → research/indicators-3/cache/series.json
import { mkdir, writeFile } from "node:fs/promises";
import { fetchEcos, fetchRone } from "../../scripts/fetch-indicators.mjs";
import { ecosKey } from "../../scripts/ecos.mjs";

const out = {};
const key = ecosKey();
const jobs = {
  // 서울 아파트 매매 - 매입자 거주지(전체 / 서울 밖). 부동산원, 2006~.
  buyer_total_seoul: () => fetchRone({ statbl: "A_2024_00609", grp: 900002, cls: 500001, itm: 100001 }, "200601", "202609"),
  buyer_outside_seoul: () => fetchRone({ statbl: "A_2024_00609", grp: 900002, cls: 500005, itm: 100001 }, "200601", "202609"),
  // 예금은행 주택관련대출 잔액 - 전국(151Y005), 서울(151Y003).
  mort_bal: () => fetchEcos({ stat: "151Y005", item: "11110A0" }, "200512", "202609", key),
  mort_bal_seoul: () => fetchEcos({ stat: "151Y003", item: "11110A0/A00" }, "200310", "202609", key),
  // 주택건설 인허가 - 서울(호), 2007~.
  permits_seoul: () => fetchEcos({ stat: "901Y105", item: "SEO" }, "200701", "202609", key),
};
for (const [name, job] of Object.entries(jobs)) {
  try {
    out[name] = await job();
    console.log(name, out[name].length, out[name][0], out[name].at(-1));
  } catch (e) {
    console.log(name, "실패", e.message);
  }
}
await mkdir(new URL("./cache/", import.meta.url), { recursive: true });
await writeFile(new URL("./cache/series.json", import.meta.url), JSON.stringify(out));
