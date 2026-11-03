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
  let s;
  try {
    s = localStorage.getItem("watchlist");
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
    localStorage.setItem("watchlist", JSON.stringify(l));
    return 1;
  } catch {
    return 0;
  }
};
const B = get();
let L = B && B.map((e) => e.slice());
const D = {}, N = {};
let msg = "";
const same = (e, gu, apt) => e[0] === gu && squash(e[1]) === squash(apt);
const id = (gu, apt) => `${gu}|${squash(apt)}`;
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
  const k = id(e[0], e[1]);
  if (k in N) return N[k];
  const list = deals(e[0]);
  if (!Array.isArray(list)) return;
  const now = keys(list, e[1]);
  const old = B.find((b) => same(b, e[0], e[1]));
  const seen = new Set(old ? old[2] : now);
  N[k] = now.filter((x) => !seen.has(x)).length;
  e[2] = now;
  put(L);
  return N[k];
}

function save(next) {
  msg = "";
  if (next.length > CAP) msg = m().cap;
  else if (put(next)) {
    window.analytics?.event(next.length < L.length ? "watchlist_remove" : "watchlist_add", { watchlist_count: next.length });
    L = next;
  } else msg = m().fail;
  draw();
}

function toggle() {
  const apt = window.cardApt;
  const rest = L.filter((e) => !same(e, district, apt));
  if (rest.length < L.length) return save(rest);
  N[id(district, apt)] = 0;
  save([...L.filter((e) => e[0] !== district || !under(apt, e[1])), [district, apt, keys(fullDeals.get(district) || [], apt)]]);
}

const m = () => M[locale] || M.ko;

function draw() {
  if (!L) return;
  const t = m();
  const box = document.getElementById("watch-list");
  const li = L.map((e, i) => {
    const n = count(e);
    const a = (apt) => `<a href="${escapeHtml(`./deal-search.html?${new URLSearchParams({ district: e[0], apt })}`)}">${escapeHtml(apt)}</a>`;
    const u = [...new Set((deals(e[0]) || []).map((d) => d.apt).filter((x) => under(x, e[1])))];
    return `${a(e[1])}${u.length ? ` <span class="count">${t.s}</span> ${u.map(a).join(", ")}` : ""}${n === undefined ? "" : ` <span class="count">${t.n(n)}</span>`} <button type="button" class="chip" data-w="${i}" aria-label="${t.b[1]} ${escapeHtml(e[1])}">×</button>`;
  });
  box.innerHTML = li.length ? `<p class="content-notice"><strong>${t.h}</strong> · ${li.join(" · ")} · ${t.note}${window.cardApt || !msg ? "" : ` <span role="status">${msg}</span>`}</p>` : "";
  box.onclick = (v) => {
    const e = L[v.target.dataset.w];
    e && save(L.filter((x) => x !== e));
  };
  const el = document.getElementById("card-watch");
  const apt = window.cardApt;
  if (!el || !apt) return;
  const e = L.find((x) => same(x, district, apt));
  const n = e && count(e);
  el.innerHTML =
    `<p><button type="button" class="chip" id="watch-toggle" aria-pressed="${!!e}">${t.b[+!!e]}</button>` +
    (n === undefined ? "" : ` <span class="count">${t.n(n)}</span>`) +
    (msg ? ` <span role="status">${msg}</span>` : "") +
    `</p>`;
  document.getElementById("watch-toggle").onclick = toggle;
}

window.cardWatch = draw;
draw();
})();

