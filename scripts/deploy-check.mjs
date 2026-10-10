/**
 * 배포본 대조 - Pages에 올라간 것이 main의 docs/ 와 같은가 (#99).
 *
 * 읽기 전용이다. 게이트가 아니고 `npm test`·워크플로 실패 조건에 넣지 않는다(#8: 네트워크·배포 시점에
 * 따라 갈리는 검사는 그날 배포를 멈춘다). 이 파일의 시험은 가짜 fetch로만 돈다. 종료 코드는 항상 0이다.
 * 합격선(N1)은 해시 불일치 0·깨진 링크 0이고, 판정은 이 출력을 읽는 사람(qa)이 한다.
 *
 * 하는 일 (모두 GET):
 * - docs/ 전 파일을 배포본에서 받아 상태 코드(200)와 SHA-256을 대조한다. index.html 은 루트 URL로 받는다.
 * - 배포본 sitemap.xml 의 <loc> 전수: 200인가, 그 페이지의 canonical 이 loc 과 같은가, 대응 파일이 docs/ 에 있는가.
 *   sitemap 이 없으면(404 등) 없다고 적고 loc 0으로 센다. 있는 척하지 않는다.
 * - docs/*.html 의 내부 링크(href·src) 대상이 배포본에서 200인가. 파일 대조에서 이미 받은 URL은 다시 받지 않는다.
 *
 * 요청 대상은 --base 와 같은 출처이고 그 경로 아래인 URL뿐이다(소유자 사이트 외 제3자 요청 금지).
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
 *   node scripts/deploy-check.mjs
 *   node scripts/deploy-check.mjs --base=https://kyhsa93.github.io/jipgye/ --docs=docs --gap=20
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { todayKst } from "./source-age.mjs";

export const DEFAULT_BASE = "https://kyhsa93.github.io/jipgye/";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** docs/ 아래 모든 파일의 상대 경로(/ 구분), 이름 순. */
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

/** HTML에서 <link rel="canonical"> 의 href. 없으면 null. */
export function canonicalOf(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel=["']?canonical["']?/i.test(tag)) return tag.match(/\bhref=["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

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
  const local = new Map(files.map((rel) => [urlOf(base, rel), { rel, buf: readFileSync(join(docsDir, rel)) }]));
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
  const sitemapUrl = base + "sitemap.xml";
  const sitemapRes = await fetchWithBody(fetchImpl, sitemapUrl, timeoutMs);
  const locs = sitemapRes.status === 200 ? locsOf(sitemapRes.text) : [];
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
        const path = loc.slice(base.length);
        if (!local.has(loc) && !(path === "" && local.has(base))) note("sitemap", loc, "docs/ 에 대응 파일 없음", loc);
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
  const locNoFile = locs.filter((l) => l.startsWith(base) && !local.has(l) && !(l === base && local.has(base))).length;
  const locSet = new Set(locs);
  const htmlNotInSitemap = htmlFiles.filter((f) => !locSet.has(urlOf(base, f))).length;
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
      htmlNotInSitemap,
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

const KIND_LABEL = { hash: "해시 불일치", status: "상태 이상", sitemap: "sitemap 이상", canonical: "canonical 불일치", link: "깨진 링크" };

/** 결과 -> 출력 줄들 (source-age 와 같은 모양: 머리, 항목, 요약). */
export function render({ problems, counts, unchecked }, { base, today, seconds }) {
  const lines = [`배포본 ${base} (KST ${today})`];
  for (const p of problems) lines.push(`${KIND_LABEL[p.kind].padEnd(10)}  ${p.target}  ${p.detail}  (${p.persisted === null ? "재확인 못 함" : p.persisted ? "재현" : "1회만"})`);
  const n = (k) => problems.filter((p) => p.kind === k && p.persisted !== false).length;
  const once = problems.filter((p) => p.persisted === false).length;
  const sitemap = counts.sitemapStatus === 200 ? `sitemap loc ${counts.locs} 대 html 파일 ${counts.html} (파일 없는 loc ${counts.locNoFile}, loc에 없는 html ${counts.htmlNotInSitemap})` : `sitemap 없음(${counts.sitemapStatus}) - loc 0 대 html 파일 ${counts.html}`;
  lines.push(
    `파일 ${counts.files}개 대조: 해시 불일치 ${n("hash")} · 상태 이상 ${n("status")} · 깨진 링크 ${n("link")}(대상 ${counts.linkTargets}개, 범위 밖 ${counts.externalSkipped}건 건너뜀) · canonical 불일치 ${n("canonical")} · sitemap 이상 ${n("sitemap")} · 1회만 ${once} · 미확인 ${unchecked} · ${sitemap} · ${seconds.toFixed(1)}초`,
  );
  const bad = problems.filter((p) => p.persisted !== false).length;
  lines.push(bad || unchecked ? `재현된 이상 ${bad}건, 미확인 ${unchecked}건` : "이상 없음");
  return lines;
}

async function main(argv) {
  const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const base = (arg("base") ?? DEFAULT_BASE).replace(/\/?$/, "/");
  const t0 = Date.now();
  const result = await checkDeploy({
    base,
    docsDir: arg("docs") ?? join(root, "docs"),
    concurrency: Number(arg("concurrency") ?? 16),
    timeoutMs: Number(arg("timeout") ?? 15) * 1000,
    budgetMs: Number(arg("budget") ?? 240) * 1000,
    gapMs: Number(arg("gap") ?? 20) * 1000,
  });
  for (const line of render(result, { base, today: arg("today") ?? todayKst(), seconds: (Date.now() - t0) / 1000 })) console.log(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
