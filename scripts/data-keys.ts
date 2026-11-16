// 데이터 요청의 판 키 (#695). 나가는 사본에서만 `?_=${Date.now()}` 를 `?v=<8자>` 로 바꾼다.
//
// 왜: 장과 장 전용 JS 는 데이터를 `./data/<이름>.json?_=${Date.now()}` 로 받았다 - 주소가 방문마다 달라 브라우저 HTTP 캐시가 한 번도 맞지 않는다
// (realestate 는 방문마다 realestate-trend.json 419KB + budget-deals.json 144KB 를 새로 받았다). 키를 데이터 내용의 해시로 바꾸면
// 같은 데이터 판 안의 재방문은 HTTP 캐시(Pages 의 max-age=600 + ETag 재검증)로 끝나고, 내용이 바뀐 배포 뒤에는 주소가 바뀌어 새로 받는다.
//
// 소스(docs/*.html·scripts/realestate-template.html·docs/*.js)는 `?_=${Date.now()}` 그대로 둔다 - docs/ 를 바로 띄우면 전처럼 늘 새로 받는다.
// 치환은 렌더 마지막 단계(build-updated-stamp)가 출력 디렉터리에서만 한다(style.css `?v=` 의 page-assets.ts 와 같은 자리). 출력이 docs/ 자신이면 아무것도 안 한다.
//
// 키 두 가지:
//  - 정적 이름 `./data/realestate-trend.json?_=…` -> 출력 사본 `<siteRoot>/data/realestate-trend.json` 바이트의 sha256 앞 8자.
//  - 동적 이름 `./data/${name}.json?_=…` -> 그 장의 로더가 받을 수 있는 파일 집합(아래 PAGE_SETS)의 「정렬한 경로 + 파일별 sha256」 목록의 sha256 앞 8자.
//    파일별 키를 쓰려면 장마다 이름->해시 표를 인라인으로 실어야 한다(deal-search 는 100개가 넘어 장당 +400 B 를 넘는다). Daily 가 데이터 185개 중
//    181개를 매일 바꾸므로 파일별과 집합 키가 실제로 갈리는 건 Summarize(뉴스·요약)뿐이다(cto 착수 판정, #695).
//
// 렌더를 실패시키는 셋(종료 1, 폴백 없음): 치환 뒤 `?_=${Date.now()}` 가 남은 출력, 동적 로더가 있는데 표에 없는 장, 맞는 파일이 0개인 집합.
// 집합이 파일 하나를 빠뜨려도 피해는 HTTP 재검증까지(≤600 s)의 묵은 값이다 - 영구 고착은 없다. 표가 소스와 맞는지는 test/data-keys.test.mjs 가 본다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pageScripts } from "./page-assets.ts";
import { DOCS_DIR } from "./site-dir.ts";

/** 소스의 캐시 무력화 글자(16 B). 나가는 사본에는 1곳도 남지 않는다. */
export const BUST = "?_=${Date.now()}";
const BUST_RE = String.raw`\?_=\$\{Date\.now\(\)\}`;
const STATIC_RE = new RegExp(String.raw`\./data/([\w-]+(?:/[\w-]+)*)\.json` + BUST_RE, "g");
const DYNAMIC_RE = new RegExp(String.raw`\./data/[^\x60"'\s]*\$\{[^}\x60]*\}[^\x60"'\s]*?\.json` + BUST_RE, "g");

/**
 * 동적 이름 로더의 파일 집합. 키는 소스 파일 이름, 값은 `<siteRoot>/data/` 기준 경로이고 한 경로 조각 안의 `*` 글롭을 허용한다.
 * 장의 로더가 받는 이름이 늘면 여기에 더한다 - 소스 스캔 시험(test/data-keys.test.mjs (d))이 빠진 이름을 알려 준다.
 */
export const PAGE_SETS: Record<string, readonly string[]> = {
  "cancelled-deals.html": ["direct-deals.json", "cancellation.json"],
  "deal-search.html": ["budget-deals.json", "deal-search.json", "rent-preview.json", "deals-*.json", "rents-*.json", "complex-price-*.json"],
  "floor-gap.html": ["floor-gap.json"],
  "index.html": ["market.json", "realestate.json", "realestate-trend.json"],
  "jeonse-vs-wolse.html": ["conversion.json"],
  "news.html": ["news.json", "summary.json", "news-history.json", "summary-history.json", "news-day/*.json"],
  "price-outlook.html": ["outlook.json", "outlook-indicators.json", "move-in.json"],
  "record-high.html": ["record-high.json"],
  "renewal-vs-new.html": ["renewal-facts.json", "renewal-cells-*.json"],
  "switch-house.html": ["district-change.json"],
  "renewal-convert.js": ["conversion.json", "market.json"],
};

/** 생성 장은 자기 틀의 집합을 물려받는다(build-news-pages 가 news.html 로 찍는 셋). 시세 틀 47장은 정적 이름뿐이다. */
export const DERIVED: Record<string, string> = {
  "rate-news.html": "news.html",
  "realestate-news.html": "news.html",
  "stock-news.html": "news.html",
};

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const globRe = (pattern: string) => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);

type Io = { read: (file: string) => string; write: (file: string, text: string) => void; bytes?: (file: string) => Buffer };

/** 집합 표 한 줄이 출력 사본에서 맞는 파일(데이터 폴더 기준 상대 경로, 정렬). */
export function setFiles(dataDir: string, patterns: readonly string[]) {
  const files = new Set<string>();
  for (const pattern of patterns) {
    const dir = path.posix.dirname(pattern);
    const full = path.join(dataDir, dir);
    if (!existsSync(full)) continue;
    const re = globRe(path.posix.basename(pattern));
    for (const name of readdirSync(full)) if (re.test(name)) files.add(dir === "." ? name : `${dir}/${name}`);
  }
  return [...files].sort();
}

/**
 * 나가는 장(.html)과 장 전용 JS 의 데이터 주소에 판 키를 박는다. 바꾼 파일 수와 키 수를 돌려준다.
 * `io.read`·`io.write` 는 build-updated-stamp 의 쓰기 묶음(앞 단계가 올려 둔 것을 이어 받는다)이고, 데이터 바이트는 `io.bytes`(기본 디스크)로 읽는다.
 */
export function stampDataKeys({ siteRoot, io }: { siteRoot: string; io: Io }) {
  if (path.resolve(siteRoot) === DOCS_DIR) return { files: 0, keys: 0, missing: [] as string[] };
  const bytes = io.bytes ?? ((file: string) => readFileSync(file));
  const dataDir = path.join(siteRoot, "data");
  const fileHash = new Map<string, string | null>();
  const hashOf = (rel: string) => {
    if (!fileHash.has(rel)) {
      const full = path.join(dataDir, rel);
      fileHash.set(rel, existsSync(full) ? sha(bytes(full)) : null);
    }
    return fileHash.get(rel);
  };
  const missing = new Set<string>();
  const setKey = new Map<string, string>();
  const keyForSet = (source: string, where: string) => {
    if (!setKey.has(source)) {
      const patterns = PAGE_SETS[source];
      if (!patterns) throw new Error(`[data-keys] ${where}: 동적 이름 데이터 로더가 있는데 집합 표(scripts/data-keys.ts PAGE_SETS)에 ${source} 가 없다`);
      const files = setFiles(dataDir, patterns);
      if (files.length === 0) throw new Error(`[data-keys] ${where}: 집합 ${source} (${patterns.join(", ")}) 에 맞는 데이터 파일이 0개다`);
      setKey.set(source, sha(files.map((f) => `${f} ${hashOf(f)}\n`).join("")).slice(0, 8));
    }
    return setKey.get(source);
  };

  const pages = readdirSync(siteRoot).filter((name) => name.endsWith(".html")).sort();
  const scripts = pageScripts(siteRoot, io.read);
  let files = 0;
  let keys = 0;
  for (const name of [...pages, ...scripts]) {
    const full = path.join(siteRoot, name);
    const before = io.read(full);
    if (!before.includes(BUST)) continue;
    const after = before
      .replace(STATIC_RE, (_m, rel: string) => {
        keys++;
        const hash = hashOf(`${rel}.json`);
        // 출력에 없는 파일은 브라우저도 404 를 받는다 - 키는 「없음」 판(0 8자)이고, 파일이 생기는 배포에서 바뀐다.
        if (hash === null) missing.add(`${rel}.json`);
        return `./data/${rel}.json?v=${hash === null ? "00000000" : hash.slice(0, 8)}`;
      })
      .replace(DYNAMIC_RE, (m) => {
        keys++;
        return m.replace(BUST, `?v=${keyForSet(DERIVED[name] ?? name, name)}`);
      });
    if (after !== before) {
      io.write(full, after);
      files++;
    }
  }
  // 모르는 모양(정적·동적 어느 쪽에도 안 맞는 주소)으로 남은 것까지 막는다: 장 전체와 모든 .js(셸 JS 포함)를 다시 훑는다.
  const left = [...pages, ...readdirSync(siteRoot).filter((name) => name.endsWith(".js")).sort()].filter((name) => io.read(path.join(siteRoot, name)).includes(BUST));
  if (left.length) throw new Error(`[data-keys] 치환 뒤에도 ${BUST} 가 남았다: ${left.join(", ")}`);
  return { files, keys, missing: [...missing].sort() };
}
