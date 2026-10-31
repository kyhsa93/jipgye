/**
 * 배포본 대조 - Pages에 올라간 것이 같은 HEAD 를 지금 만든 사이트(build/site)와 같은가 (#99, B5 #511 에서 대조 대상을 docs/ → build/site 로 옮김).
 *
 * 컷오버(#510) 뒤 main 의 docs/ 는 손으로 쓴 틀 14장·정적 자산·data 뿐이고 생성 53장은 배포 때 build/site 로 만들어진다. 그래서 docs/ 와 대조하면 생성 장이 전부 "배포본에만 있음"으로 나온다.
 * 이 도구는 먼저 같은 HEAD 로 build/site 를 만들어 놓고 부른다: `BUILD_NOW="$(git log -1 --format=%cI HEAD)" node scripts/render-pipeline.ts --out=build/site`
 * (deploy.yml 과 같은 입력이다 - BUILD_NOW 를 안 맞추면 예산 장·방법 장의 건수가 하루치 어긋날 수 있다).
 * 그 HEAD 가 배포된 HEAD 가 아니면(그 뒤 병합·수집이 있었으면) 불일치는 정상이다. 배포본끼리의 전후 대조는 site-snapshot.ts 다.
 *
 * 읽기 전용이다. 게이트가 아니고 `npm test`·워크플로 실패 조건에 넣지 않는다(#8: 네트워크·배포 시점에
 * 따라 갈리는 검사는 그날 배포를 멈춘다). 이 파일의 시험은 가짜 fetch로만 돈다. 종료 코드는 항상 0이다.
 * 합격선(N1)은 해시 불일치 0·깨진 링크 0이고, 판정은 이 출력을 읽는 사람(qa)이 한다.
 *
 * 하는 일 (모두 GET):
 * - 대조 디렉터리(기본 build/site) 전 파일을 배포본에서 받아 상태 코드(200)와 SHA-256을 대조한다. index.html 은 루트 URL로 받는다.
 * - 배포본 sitemap 둘(출처 루트 /sitemap.xml 은 블로그 저장소 소유, base 아래 /jipgye/sitemap.xml 은 이 저장소의 렌더 산출물 #769; index 면 하위까지)의 base 아래 <loc> 전수(합집합):
 *   200인가, 그 페이지의 canonical 이 loc 과 같은가, noindex 장이 섞였는가, 대응 파일이 대조 디렉터리에 있는가. 둘 다 있으면 한쪽에만 있는 loc 도 적는다(두 사이트맵이 어긋나면 안 된다).
 *   sitemap 이 둘 다 없으면(404 등) 없다고 적고 loc 0으로 센다. 있는 척하지 않는다.
 * - 대조 디렉터리 *.html 의 내부 링크(href·src) 대상이 배포본에서 200인가. 파일 대조에서 이미 받은 URL은 다시 받지 않는다.
 *
 * 요청 대상은 --base 와 같은 출처이고 그 경로 아래인 URL뿐이다(소유자 사이트 외 제3자 요청 금지). 예외는 sitemap 뿐으로,
 * 같은 출처의 루트(/sitemap.xml)와 두 sitemap 의 index 가 가리키는 같은 출처 하위 sitemap 도 받는다.
 * 리다이렉트는 따라가지 않는다(3xx 는 상태 이상으로 적힌다) - 따라가면 다른 출처로 나갈 수 있다.
 *
 * 2회 재현: 첫 대조에서 이상이 나온 URL만 --gap 초 뒤 한 번 더 받아 다시 판정한다. 출력의 "재현"은 두 번 다
 * 이상인 것, "1회만"은 두 번째에 사라진 것이다. 배포가 끝나기 전에 돌리면 1회만이 나올 수 있다.
 *
 * 시간: 병렬(--concurrency, 기본 16)로 받고 --budget 초(기본 240)를 넘기면 남은 요청을 중단하고 "미확인"으로
 * 센다. 명령 하나가 5분 안에 끝나게 하는 상한이다. 요청 하나는 --timeout 초(기본 15)에서 끊는다.
 *
 * 출력 형식은 source-age.mjs 를 따른다: 머리 한 줄, 이상 항목 줄, 요약 한 줄.
 *
 * 사용:
 *   node scripts/deploy-check.ts
 *   node scripts/deploy-check.ts --base=https://kyhsa93.github.io/jipgye/ --docs=build/site --gap=20
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { todayKst } from "./source-age.ts";
import { canonicalOf, isNoindex } from "./sitemap.ts";

export const DEFAULT_BASE = "https://kyhsa93.github.io/jipgye/";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** 대조 디렉터리 아래 모든 파일의 상대 경로(/ 구분), 이름 순. */
export function listFiles(docsDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(docsDir, p).split(sep).join("/"));
    }
  };
  walk(docsDir);
  return out;
}

/** 파일 경로 -> 배포본 URL. index.html 은 루트 URL. */
export function urlOf(base, rel) {
  return rel === "index.html" ? base : base + rel.split("/").map(encodeURIComponent).join("/");
}

// canonical·noindex 읽기는 사이트맵을 만드는 쪽(scripts/sitemap.ts, #769)과 한 벌이다 - 만드는 눈과 점검하는 눈이 갈리면 한쪽만 통과한다.
export { canonicalOf, isNoindex } from "./sitemap.ts";

/** sitemap.xml 의 <loc> 목록. */
export function locsOf(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map((m) => m[1]);
}

/**
 * 한 HTML의 내부 링크 대상 URL(쿼리·해시 제거, 중복 제거). base 밖(다른 출처·다른 경로)은 건너뛰고 skipped 로 센다.
 * 템플릿 조각(`${`)·태그 조각이 든 값은 링크가 아니라 스크립트 문자열이라 뺀다.
 */
export function linksOf(html, pageUrl, base) {
  const targets = new Set();
  let skipped = 0;
  for (const m of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(raw) || /[${}<>]/.test(raw)) continue;
    let u;
    try {
      u = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (!u.href.startsWith(base)) {
      skipped += 1;
      continue;
    }
    u.hash = "";
    u.search = "";
    targets.add(u.href);
  }
  return { targets: [...targets], skipped };
}

/** 병렬 풀. 한도 시각(deadline, ms)을 넘으면 새 일을 시작하지 않는다. 시작 못 한 개수를 돌려준다. */
async function pool(items, limit, deadline, now, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && now() < deadline) await work(items[next++]);
    }),
  );
  return items.length - next;
}

/** URL 하나를 GET. { status, hash, canonical } 또는 { error }. 본문은 보관하지 않는다. */
async function fetchOne(fetchImpl, url, timeoutMs, wantCanonical) {
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, hash: sha256(buf), canonical: wantCanonical && res.status === 200 ? canonicalOf(buf.toString("utf8")) : undefined };
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "시간 초과" : (e?.message ?? String(e)) };
  }
}

/**
 * 대조 전체. fetchImpl·now·sleep 을 주입할 수 있다(시험용). 반환은 { problems, counts, unchecked }.
 * problems: [{ kind, target, detail }] kind 는 hash|status|sitemap|canonical|link. persisted 는 2회 재현 여부.
 */
export async function checkDeploy({ base = DEFAULT_BASE, docsDir, fetchImpl = fetch, concurrency = 16, timeoutMs = 15000, budgetMs = 240000, gapMs = 20000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!base.endsWith("/")) base += "/";
  const deadline = now() + budgetMs;
  const files = listFiles(docsDir);
  const local = new Map<string, { rel: string; buf: Buffer; hash?: string }>(files.map((rel) => [urlOf(base, rel), { rel, buf: readFileSync(join(docsDir, rel)) }]));
  for (const v of local.values()) v.hash = sha256(v.buf);
  const htmlFiles = files.filter((f) => f.endsWith(".html"));

  // 링크 대상(파일 대조에 없는 URL만 추가로 받는다). 대상은 클론의 HTML에서 뽑는다 - 배포본과 해시가 같으면 같은 것이다.
  const linkRefs = new Map(); // 대상 URL -> 그 링크를 건 페이지 rel 목록
  let externalSkipped = 0;
  for (const rel of htmlFiles) {
    const { targets, skipped } = linksOf(local.get(urlOf(base, rel)).buf.toString("utf8"), urlOf(base, rel), base);
    externalSkipped += skipped;
    for (const t of targets) linkRefs.set(t, [...(linkRefs.get(t) ?? []), rel]);
  }

  const cache = new Map();
  const sitemapRes = await resolveSitemap(fetchImpl, base, timeoutMs);
  const locs = sitemapRes.locs;
  // 파일 대조 + 파일 대조에 없는 링크 대상 + 파일이 아닌 loc. HTML 과 loc 은 canonical 도 같이 뽑는다.
  const locUrls = locs.filter((l) => l.startsWith(base) && !local.has(l));
  const wantCanonical = new Set([...htmlFiles.map((f) => urlOf(base, f)), ...locUrls]);
  const all = [...new Set([...local.keys(), ...linkRefs.keys(), ...locUrls])];
  const fetchAll = (urls) => pool(urls, concurrency, deadline, now, async (u) => cache.set(u, await fetchOne(fetchImpl, u, timeoutMs, wantCanonical.has(u))));
  await fetchAll(all);

  const evaluate = () => {
    const found = [];
    const note = (kind, target, detail, url) => found.push({ kind, target, detail, url });
    for (const [url, { rel, hash }] of local) {
      const r = cache.get(url);
      if (!r) continue; // 미확인(한도 초과)
      if (r.error) note("status", rel, `요청 실패: ${r.error}`, url);
      else if (r.status !== 200) note("status", rel, `상태 ${r.status}`, url);
      else if (r.hash !== hash) note("hash", rel, "해시 불일치", url);
    }
    if (sitemapRes.status === 200) {
      for (const loc of locs) {
        if (!loc.startsWith(base)) continue; // 제3자 URL은 받지 않는다
        const r = cache.get(loc);
        if (!r) continue;
        if (r.error || r.status !== 200) note("sitemap", loc, r.error ? `요청 실패: ${r.error}` : `상태 ${r.status}`, loc);
        else if (r.canonical !== undefined && r.canonical !== loc) note("canonical", loc, `canonical ${r.canonical ?? "없음"}`, loc);
        const f = local.get(loc) ?? (loc === base ? local.get(base) : undefined);
        if (f && f.rel.endsWith(".html") && isNoindex(f.buf.toString("utf8"))) note("sitemap", loc, "noindex 페이지가 sitemap 에 있음", loc);
        const path = loc.slice(base.length);
        if (!local.has(loc) && !(path === "" && local.has(base))) note("sitemap", loc, "대조 디렉터리에 대응 파일 없음", loc);
      }
    }
    for (const [url, pages] of linkRefs) {
      const r = cache.get(url);
      if (!r) continue;
      if (r.error || r.status !== 200) note("link", url, `${r.error ? `요청 실패: ${r.error}` : `상태 ${r.status}`}  ← ${pages.slice(0, 3).join(", ")}${pages.length > 3 ? ` 외 ${pages.length - 3}` : ""}`, url);
    }
    return found;
  };

  const first = evaluate();
  let persisted = null; // null = 재확인 못 함(한도 초과)
  // 두 번째 대조는 한도가 남았을 때만 한다. 한도를 넘겼으면 전부 1회만으로 남는 대신 "미확인"이 알린다.
  if (first.length && now() < deadline) {
    await sleep(gapMs);
    await fetchAll([...new Set(first.map((p) => p.url))].filter((u) => cache.has(u)));
    const second = new Set(evaluate().map((p) => `${p.kind} ${p.target}`));
    persisted = first.filter((p) => second.has(`${p.kind} ${p.target}`));
  }
  const persistedKeys = new Set((persisted ?? []).map((p) => `${p.kind} ${p.target}`));
  const problems = first.map(({ url, ...p }) => ({ ...p, persisted: persisted === null ? null : persistedKeys.has(`${p.kind} ${p.target}`) }));

  const htmlLocal = htmlFiles.length;
  const locCount = locs.length;
  const locNoFile = locs.filter((l) => !local.has(l)).length;
  const locSet = new Set(locs);
  // noindex 페이지는 sitemap 에 없는 것이 맞다(검색 제외). 없어도 이상이 아니라 따로 센다.
  const noindexHtml = new Set(htmlFiles.filter((f) => isNoindex(local.get(urlOf(base, f)).buf.toString("utf8"))));
  const htmlNotInSitemapList = htmlFiles.filter((f) => !locSet.has(urlOf(base, f)) && !noindexHtml.has(f));
  const locNoFileList = locs.filter((l) => !local.has(l));
  return {
    problems,
    unchecked: all.filter((u) => !cache.has(u)).length,
    counts: {
      files: files.length,
      html: htmlLocal,
      linkTargets: linkRefs.size,
      externalSkipped,
      sitemapStatus: sitemapRes.error ? `요청 실패: ${sitemapRes.error}` : sitemapRes.status,
      locs: locCount,
      locNoFile,
      htmlNotInSitemap: htmlNotInSitemapList.length,
      htmlNotInSitemapList,
      noindexNotInSitemap: htmlFiles.filter((f) => noindexHtml.has(f) && !locSet.has(urlOf(base, f))).length,
      locNoFileList,
      sitemapUrl: sitemapRes.url,
      // 두 sitemap 이 다 읽혔을 때 한쪽에만 있는 base 아래 loc(#769 「관계」: 루트 sitemap 의 집계 URL 과 집계 전용 sitemap 이 어긋나면 안 된다). 하나만 읽혔으면 빈 목록.
      sitemapOnlyIn: sitemapRes.found.length === 2 ? sitemapRes.found.map((f, i) => ({ url: f.url, locs: f.locs.filter((l) => !sitemapRes.found[1 - i].locs.includes(l)) })) : [],
    },
  };
}

async function fetchWithBody(fetchImpl, url, timeoutMs) {
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, text: res.status === 200 ? await res.text() : (await res.arrayBuffer(), "") };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

/** sitemap index(<sitemapindex>)면 true. */
export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/i.test(xml);

/**
 * sitemap 둘을 받아 base(/jipgye/) 아래 loc 의 합집합을 돌려준다. 하나는 소유자 사이트 루트(https://kyhsa93.github.io/sitemap.xml) - 블로그 저장소가 만들고
 * 다른 프로젝트 URL도 섞여 있다(2026-10-11 GET 200 확인). 다른 하나는 base 아래(/jipgye/sitemap.xml) - 이 저장소의 렌더가 만드는 집계 전용 사이트맵(#769, 전에는 404 였다).
 * 200 인 것은 전부 읽는다(전에는 처음 200 인 것 하나만 썼다). index 면 같은 출처의 하위 sitemap 을 한 단계 따라간다(제3자 출처는 받지 않는다).
 * 둘 다 못 찾으면 첫 후보의 상태를 돌려준다. locs 는 중복 제거이고 found 는 읽힌 sitemap 별 loc 이다(한쪽에만 있는 loc 을 적는 데 쓴다).
 */
export async function resolveSitemap(fetchImpl, base, timeoutMs) {
  const origin = new URL(base).origin;
  const candidates = [...new Set([`${origin}/sitemap.xml`, `${base}sitemap.xml`])];
  const found = [];
  let firstFail = null;
  for (const url of candidates) {
    const res = await fetchWithBody(fetchImpl, url, timeoutMs);
    if (res.status !== 200) {
      firstFail ??= { ...res, url };
      continue;
    }
    let all = [];
    if (isSitemapIndex(res.text)) {
      for (const child of locsOf(res.text)) {
        if (!child.startsWith(`${origin}/`)) continue;
        const c = await fetchWithBody(fetchImpl, child, timeoutMs);
        if (c.status === 200) all.push(...locsOf(c.text));
      }
    } else all = locsOf(res.text);
    found.push({ url, locs: [...new Set(all.filter((l) => l.startsWith(base)))] });
  }
  if (found.length === 0) return { status: firstFail?.status, error: firstFail?.error, url: firstFail?.url ?? candidates[0], locs: [], found };
  return { status: 200, url: found.map((f) => f.url).join(" + "), locs: [...new Set(found.flatMap((f) => f.locs))], found };
}

const KIND_LABEL = { hash: "해시 불일치", status: "상태 이상", sitemap: "sitemap 이상", canonical: "canonical 불일치", link: "깨진 링크" };

/** 결과 -> 출력 줄들 (source-age 와 같은 모양: 머리, 항목, 요약). */
export function render({ problems, counts, unchecked }, { base, today, seconds }) {
  const lines = [`배포본 ${base} (KST ${today})`];
  for (const p of problems) lines.push(`${KIND_LABEL[p.kind].padEnd(10)}  ${p.target}  ${p.detail}  (${p.persisted === null ? "재확인 못 함" : p.persisted ? "재현" : "1회만"})`);
  const n = (k) => problems.filter((p) => p.kind === k && p.persisted !== false).length;
  const once = problems.filter((p) => p.persisted === false).length;
  const sitemap = counts.sitemapStatus === 200 ? `sitemap(${counts.sitemapUrl}) loc ${counts.locs} 대 html 파일 ${counts.html} (파일 없는 loc ${counts.locNoFile}, loc에 없는 html ${counts.htmlNotInSitemap}, noindex 라 빠진 html ${counts.noindexNotInSitemap})` : `sitemap 없음(${counts.sitemapStatus}) - loc 0 대 html 파일 ${counts.html}`;
  lines.push(
    `파일 ${counts.files}개 대조: 해시 불일치 ${n("hash")} · 상태 이상 ${n("status")} · 깨진 링크 ${n("link")}(대상 ${counts.linkTargets}개, 범위 밖 ${counts.externalSkipped}건 건너뜀) · canonical 불일치 ${n("canonical")} · sitemap 이상 ${n("sitemap")} · 1회만 ${once} · 미확인 ${unchecked} · ${sitemap} · ${seconds.toFixed(1)}초`,
  );
  const bad = problems.filter((p) => p.persisted !== false).length;
  if (counts.sitemapStatus === 200) {
    if (counts.locNoFileList.length) lines.push(`sitemap 에만 있음(대조 디렉터리에 파일 없음) ${counts.locNoFileList.length}: ${counts.locNoFileList.join(", ")}`);
    if (counts.htmlNotInSitemapList.length) lines.push(`대조 디렉터리 html 인데 sitemap loc 에 없음 ${counts.htmlNotInSitemapList.length}: ${counts.htmlNotInSitemapList.join(", ")}`);
    for (const { url, locs } of counts.sitemapOnlyIn ?? []) if (locs.length) lines.push(`${url} 에만 있는 loc ${locs.length}: ${locs.join(", ")}`);
  }
  lines.push(bad || unchecked ? `재현된 이상 ${bad}건, 미확인 ${unchecked}건` : "이상 없음");
  return lines;
}

async function main(argv) {
  const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = (arg("base") ?? DEFAULT_BASE).replace(/\/?$/, "/");
  const t0 = Date.now();
  const docsDir = arg("docs") ?? join(root, "build", "site");
  if (!existsSync(docsDir)) {
    console.error(`대조할 사이트 디렉터리가 없다: ${docsDir} - 먼저 build/site 를 만든다(이 파일 머리 주석의 render-pipeline 명령).`);
    process.exit(2);
  }
  const result = await checkDeploy({
    base,
    docsDir,
    concurrency: Number(arg("concurrency") ?? 16),
    timeoutMs: Number(arg("timeout") ?? 15) * 1000,
    budgetMs: Number(arg("budget") ?? 240) * 1000,
    gapMs: Number(arg("gap") ?? 20) * 1000,
  });
  for (const line of render(result, { base, today: arg("today") ?? todayKst(), seconds: (Date.now() - t0) / 1000 })) console.log(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
