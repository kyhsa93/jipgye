// 관심 단지(#732). 설명은 test/watchlist.test.mjs 머리 주석.
(() => {
  const K = "watchlist", CAP = 10;
  const M = {
    ko: {
      h: "관심 단지",
      b: ["관심 단지 담기", "관심 단지 빼기"],
      n: (k) => (k ? `지난 방문 뒤 새 신고 ${k}건` : "지난 방문 뒤 새 신고 없음"),
      cap: `관심 단지는 ${CAP}곳까지 담을 수 있습니다.`,
      fail: "저장소를 쓸 수 없어 바꾸지 못했습니다.",
      note: "이 브라우저에만 저장합니다.",
    },
    en: {
      h: "Watchlist",
      b: ["Watch this complex", "Unwatch"],
      n: (k) => (k ? `${k} new report${k > 1 ? "s" : ""} since your last visit` : "No new reports since your last visit"),
      cap: `You can watch up to ${CAP} complexes.`,
      fail: "Storage is unavailable, so nothing changed.",
      note: "Stored in this browser only.",
    },
  };
  const ok = (e) => Array.isArray(e) && typeof e[0] == "string" && typeof e[1] == "string" && Array.isArray(e[2]);
  function get() {
    let s;
    try {
      s = localStorage.getItem(K);
    } catch {
      return null;
    }
    try {
      const v = JSON.parse(s || "[]");
      return Array.isArray(v) ? v.filter(ok).slice(0, CAP) : [];
    } catch {
      return [];
    }
  }
  const put = (l) => {
    try {
      localStorage.setItem(K, JSON.stringify(l));
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
  const keys = (list, apt) => list.filter((d) => squash(d?.apt) === squash(apt)).map((d) => `${d.date}|${d.area}|${d.floor}|${d.amount10k}`);

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
    const w = L.find((b) => same(b, e[0], e[1]));
    if (w) (w[2] = now), put(L);
    return N[k];
  }

  function toggle() {
    const apt = window.cardApt;
    const on = L.some((e) => same(e, district, apt));
    const next = on ? L.filter((e) => !same(e, district, apt)) : [...L, [district, apt, keys(fullDeals.get(district) || [], apt)]];
    msg = "";
    if (!on && L.length >= CAP) msg = m().cap;
    else if (put(next)) {
      L = next;
      N[id(district, apt)] = 0;
    } else msg = m().fail;
    draw();
  }

  const m = () => M[locale === "en" ? "en" : "ko"];

  function draw() {
    if (!L) return;
    const t = m();
    const box = document.getElementById("watch-list");
    if (box) {
      const li = L.map((e) => {
        const n = count(e);
        const href = `./deal-search.html?${new URLSearchParams({ district: e[0], apt: e[1] })}`;
        return `<a href="${escapeHtml(href)}">${escapeHtml(e[1])}</a>${n === undefined ? "" : ` <span class="count">${escapeHtml(t.n(n))}</span>`}`;
      });
      box.innerHTML = li.length ? `<p class="content-notice"><strong>${t.h}</strong> · ${li.join(" · ")} · ${t.note}</p>` : "";
    }
    const el = document.getElementById("card-watch");
    const apt = window.cardApt;
    if (!el || !apt) return;
    const e = L.find((x) => same(x, district, apt));
    const n = e && count(e);
    el.innerHTML =
      `<p><button type="button" class="chip" id="watch-toggle" aria-pressed="${!!e}">${t.b[+!!e]}</button>` +
      (n === undefined ? "" : ` <span class="count">${escapeHtml(t.n(n))}</span>`) +
      (msg ? ` <span role="status">${msg}</span>` : "") +
      `</p>`;
    document.getElementById("watch-toggle").onclick = toggle;
  }

  window.cardWatch = draw;
  draw();
})();
