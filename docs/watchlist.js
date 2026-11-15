// 설명: test/watchlist.test.mjs
(() => {
const CAP = 10;
const M = {
  ko: {
    h: "관심 단지",
    b: ["관심 단지 담기", "관심 단지 빼기"],
    n: (k) => (k ? `지난 방문 뒤 새 신고 ${k}건` : "지난 방문 뒤 새 신고 없음"),
    cap: `관심 단지는 ${CAP}곳까지 담을 수 있습니다.`,
    fail: "저장소를 쓸 수 없어 바꾸지 못했습니다.",
    note: "이 브라우저에만 저장합니다.",
    s: "여러 동 합산",
  },
  en: {
    h: "Watchlist",
    b: ["Watch this complex", "Unwatch"],
    n: (k) => (k ? `${k} new report${k > 1 ? "s" : ""} since your last visit` : "No new reports since your last visit"),
    cap: `You can watch up to ${CAP} complexes.`,
    fail: "Storage is unavailable, so nothing changed.",
    note: "Stored in this browser only.",
    s: "dongs combined",
  },
};
const ok = (e) => Array.isArray(e) && typeof e[0] == "string" && typeof e[1] == "string" && Array.isArray(e[2]);
function get() {
  try {
    var s = localStorage.getItem("watchlist");
  } catch {
    return null;
  }
  try {
    s = JSON.parse(s);
  } catch {}
  return Array.isArray(s) ? s.filter(ok).slice(0, CAP) : [];
}
const put = (l) => {
  try {
    return !localStorage.setItem("watchlist", JSON.stringify(l));
  } catch {}
};
const D = {}, N = {};
let L, msg = "";
const id = (gu, apt) => `${gu}|${squash(apt)}`;
const same = (e, gu, apt) => id(...e) == id(gu, apt);
const under = (x, apt) => String(x).startsWith(`${apt} (`);
const keys = (list, apt) => list.filter((d) => squash(d?.apt) === squash(apt) || under(d?.apt, apt)).map((d) => `${d.date}|${d.area}|${d.floor}|${d.amount10k}`);

function deals(gu) {
  const f = fullDeals.get(gu);
  if (Array.isArray(f)) return f;
  if (gu in D) return D[gu];
  const slug = cache.search?.slugs?.[gu];
  if (!slug) return (D[gu] = 0);
  D[gu] = undefined;
  loadJson(`deals-${slug}`).then((f) => f?.deals || 0, () => 0).then((v) => ((D[gu] = v), draw()));
}

function count(e) {
  const k = id(...e);
  if (k in N) return N[k];
  const list = deals(e[0]);
  if (!Array.isArray(list)) return;
  const c = get(), now = keys(list, e[1]), old = c?.find((x) => same(x, ...e)), seen = new Set(old ? old[2] : now);
  N[k] = now.filter((x) => !seen.has(x)).length;
  e[2] = now;
  c && put(c.map((x) => (same(x, ...e) ? e : x)));
  return N[k];
}

function save(f, r) {
  const c = get(), next = c && f(c);
  msg = next?.length > CAP ? m().cap : next && put(next) ? "" : m().fail;
  msg || window.analytics?.event(r ? "watchlist_remove" : "watchlist_add", { watchlist_count: next.length });
  draw();
}

function toggle() {
  const apt = window.cardApt, n = [district, apt, keys(fullDeals.get(district) || [], apt)], r = L.some((x) => same(x, ...n));
  r || (N[id(...n)] = 0);
  save((c) => c.filter((x) => !same(x, ...n) && (r || x[0] !== district || !under(apt, x[1]))).concat(r ? [] : [n]), r);
}

const m = () => M[locale] || M.ko;

function draw() {
  if (!(L = get() || L)) return;
  const t = m(), box = document.getElementById("watch-list");
  const li = L.map((e, i) => {
    const n = count(e);
    const a = (apt) => `<a href="${escapeHtml(`./deal-search.html?${new URLSearchParams({ district: e[0], apt })}`)}">${escapeHtml(apt)}</a>`;
    const u = [...new Set((deals(e[0]) || []).map((d) => d.apt).filter((x) => under(x, e[1])))];
    return `${a(e[1])}${u.length ? ` <span class="count">${t.s}</span> ${u.map(a).join(", ")}` : ""}${n == null ? "" : ` <span class="count">${t.n(n)}</span>`} <button type="button" class="chip" data-w="${i}" aria-label="${t.b[1]} ${escapeHtml(e[1])}">×</button>`;
  });
  box.innerHTML = li.length ? `<p class="content-notice"><strong>${t.h}</strong> · ${li.join(" · ")} · ${t.note}${window.cardApt || !msg ? "" : ` <span role="status">${msg}</span>`}</p>` : "";
  box.onclick = (v) => {
    const e = L[v.target.dataset.w];
    e && save((c) => c.filter((x) => !same(x, ...e)), 1);
  };
  const el = document.getElementById("card-watch"), apt = window.cardApt;
  if (!el || !apt) return;
  const e = L.find((x) => same(x, district, apt)), n = e && count(e);
  el.innerHTML =
    `<p><button type="button" class="chip" id="watch-toggle" aria-pressed="${!!e}">${t.b[+!!e]}</button>` +
    (n == null ? "" : ` <span class="count">${t.n(n)}</span>`) +
    (msg ? ` <span role="status">${msg}</span>` : "") +
    `</p>`;
  document.getElementById("watch-toggle").onclick = toggle;
}

window.cardWatch = onstorage = draw;
draw();
})();

