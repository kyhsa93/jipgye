/**
 * 공시가격 API 수집의 대상 지번 (#68 E1). 대상 = `--raw-commit`(3a92151)의 raw/sale 에 한 번이라도 나온
 * 서울 (시군구, 법정동, 지번). 전월세만 있는 지번은 1차 범위 밖(pm 판정). 지번 단위 값만 다루고 호 단위 값은 없다.
 *
 * 건축HUB는 법정동을 이름이 아니라 코드(bjdongCd 5자리)로 받는다. 실거래 원본에는 동 이름만 있어서
 * 행정표준코드관리시스템 「법정동코드 전체자료」의 서울 현존 467동(research/official-price/bjdong-names-seoul.json,
 * 코드 467개가 research/housing-permits/bjdong-seoul.json과 같음을 대조해 만들었다)으로 이름 -> 코드를 푼다.
 * 풀리지 않는 줄·"산" 지번·4자리를 넘는 번지는 버리고 그 줄 수만 센다(시험 때와 같은 규칙: 매매 6,764지번).
 *
 * 순서는 고정 시드의 해시 정렬이다 - 앞쪽 N지번이 무작위 표본이 되어 어느 시점에 멈춰도 편향이 없다.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.ts";
import { parcelKey } from "./official-price-key.ts";

/** 바꾸면 모든 진행 상태의 순서 의미가 바뀐다 - 이어 받는 도중에 바꾸지 않는다. */
export const SHUFFLE_SEED = "official-price-api-v1";

const SGG_NAME = new Map(DISTRICTS.map((d) => [d.code, d.name]));

/** 이름 -> 10자리 코드 표를 검사해 돌려준다. */
export function checkNames(table: Record<string, string>) {
  if (!table || typeof table !== "object") throw new Error("법정동 이름표가 객체가 아니다");
  for (const [name, code] of Object.entries(table)) {
    if (!/^서울특별시 \S+ \S+$/.test(name) || !/^11\d{8}$/.test(code)) throw new Error("법정동 이름표 형식이 다르다");
  }
  return table;
}

/**
 * raw/sale 슬롯 파일에서 대상 지번을 모은다.
 * 반환: { targets: Map<parcelKey, {s,d,j,sigunguCd,bjdongCd,bun,ji,saleDeals}>, unmappedRows }
 */
export async function loadTargets({ rawDir, names }) {
  checkNames(names);
  const targets = new Map();
  let unmappedRows = 0;
  let files;
  try { files = (await readdir(path.join(rawDir, "sale"))).filter((n) => n.endsWith(".json")).sort(); } catch { files = []; }
  for (const name of files) {
    const doc = JSON.parse(await readFile(path.join(rawDir, "sale", name), "utf8"));
    for (const it of doc.items ?? []) {
      const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(String(it.jibun));
      const sgg = String(it.sggCd);
      const code10 = names[`서울특별시 ${SGG_NAME.get(sgg)} ${it.umdNm}`];
      const key = parcelKey(sgg, it.umdNm, it.jibun);
      if (!m || !code10 || !key || !code10.startsWith(sgg)) { unmappedRows += 1; continue; }
      let t = targets.get(key);
      if (!t) {
        const [s, d, j] = key.split("|");
        t = { s, d, j, sigunguCd: sgg, bjdongCd: code10.slice(5), bun: m[1].padStart(4, "0"), ji: (m[2] ?? "0").padStart(4, "0"), saleDeals: 0 };
        targets.set(key, t);
      }
      t.saleDeals += 1;
    }
  }
  return { targets, unmappedRows };
}

/** 고정 시드 해시 정렬. 같은 입력이면 같은 순서. 반환: [[parcelKey, target], ...] */
export function orderTargets(targets, seed = SHUFFLE_SEED) {
  const h = (k) => createHash("sha256").update(`${seed}|${k}`).digest("hex");
  return [...targets].map(([k, t]) => [k, t, h(k)]).sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)).map(([k, t]) => [k, t]);
}
