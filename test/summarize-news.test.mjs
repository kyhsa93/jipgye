import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeKoreanAmounts, pickHighlights, summaryNow } from "../scripts/summarize-news.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(import.meta.dirname, "../scripts/summarize-news.mjs");

function startOllamaStub(reply) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(raw);
      const kind = /고유명사/.test(prompt)
        ? "entities"
        : /^Translate the following Korean/m.test(prompt)
          ? "translate"
          : /한 문장 요약:$/.test(prompt)
            ? "single"
            : "paragraph";
      calls.push({ kind, prompt });
      const response = reply({ kind, prompt });
      if (response === null) {
        res.writeHead(500).end("boom");
        return;
      }

      const payload =
        [...response].map((ch) => `${JSON.stringify({ response: ch, done: false })}\n`).join("") +
        `${JSON.stringify({ response: "", done: true })}\n`;
      const cut = Math.floor(payload.length / 2);

      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(payload.slice(0, cut));
      res.end(payload.slice(cut));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// 시험은 실제 시계를 읽지 않는다(#258). 스크립트의 "오늘"은 SUMMARY_NOW로 고정한 이 시각이고(KST 2026-10-11 14:00 —
// 자정 경계에서 멀다), news.json·본문 캐시의 날짜도 같은 값에서 만든다. 전에는 시험 파일이 읽힐 때 한 번 정한 KST 오늘을
// 박았기 때문에, 스크립트가 도는 순간이 KST 자정(UTC 15:00)을 넘으면 둘이 갈려 요약이 생략되고 summary.json이 없었다.
const NOW = "2026-10-11T05:00:00Z";
const NEWS_DATE = "2026-10-11";

const NEWS_ITEMS = [
  {
    title: "국토부, 신규 택지 후보지 발표",
    link: "https://example.com/a",
    source: "가상경제",
    category: "realestate",
    dupes: [{ title: "택지 발표", link: "https://example.com/a2", source: "다른매체" }],
  },
  {
    title: "코스피 하락 마감",
    link: "https://example.com/b",
    source: "가상경제",
    category: "stocks",
    dupes: [],
  },
];

const BODIES = {
  "https://example.com/a":
    "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다. 정부는 연내 추가 발표를 예고했다. ".repeat(5),
  "https://example.com/b":
    "코스피가 전 거래일보다 12.5포인트 내린 채 거래를 마쳤다. 미국 7월 물가지수 둔화가 영향을 줬다. 외국인이 순매도를 이어갔다. ".repeat(5),
};

// `now`는 자식 프로세스에만 env(SUMMARY_NOW)로 넘긴다. `expectSkip`이면 summary.json이 없는 것이 기대(요약 생략)다.
async function runSummarize(reply, { now = NOW, newsDate = NEWS_DATE, expectSkip = false } = {}) {
  const stub = await startOllamaStub(reply);
  const dir = await mkdtemp(path.join(tmpdir(), "digest-"));
  const dataDir = path.join(dir, "data");
  const bodiesFile = path.join(dir, "bodies.json");

  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "news.json"),
    JSON.stringify({ updatedAt: new Date(now).toISOString(), date: newsDate, items: NEWS_ITEMS })
  );
  await writeFile(bodiesFile, JSON.stringify({ date: newsDate, bodies: BODIES }));

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SUMMARY_DATA_DIR: dataDir,
        NEWS_BODIES_FILE: bodiesFile,
        OLLAMA_URL: stub.url,
        OLLAMA_MODEL: "stub",
        SUMMARY_NOW: now,
      },
    });
    const summary = expectSkip ? null : JSON.parse(await readFile(path.join(dataDir, "summary.json"), "utf8"));
    return { summary, stdout, stderr, calls: stub.calls, dataDir };
  } finally {
    await stub.close();
  }
}

const KO_REALESTATE =
  "국토교통부는 14일 신규 공공택지 후보지를 발표했다. 이번 후보지에는 3만 가구가 들어선다. 정부는 연내 추가 발표를 예고했다.";
const KO_STOCKS =
  "코스피가 전 거래일보다 12.5포인트 내린 채 거래를 마쳤다. 미국 7월 물가지수 둔화가 영향을 줬다. 외국인이 순매도를 이어갔다.";
const EN_OK = "The ministry announced 30,000 new homes. The index fell.";
const goodKo = (prompt) => (/코스피/.test(prompt) ? KO_STOCKS : KO_REALESTATE);

test("본문이 있으면 문단 요약과 핵심 기사가 함께 나온다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return /코스피/.test(prompt) ? "코스피" : "국토교통부";
    if (kind === "translate") return EN_OK;
    return goodKo(prompt);
  });

  assert.equal(stderr, "", `폴백 로그가 남았다:\n${stderr}`);
  assert.ok(summary.highlights.length > 0, "핵심 기사가 비었다");
  assert.ok(summary.categories.every((c) => !c.isFallback), "폴백이 섞였다");

  for (const category of summary.categories) {
    assert.ok(category.lineKo.length > 60, `카테고리 요약이 너무 짧다: ${category.lineKo}`);
  }
  for (const highlight of summary.highlights) {
    assert.ok(highlight.textKo.length > 40, `핵심 요약이 너무 짧다: ${highlight.textKo}`);
    assert.ok(highlight.textEn, "영어 요약이 없다");
  }
  assert.match(summary.summary.ko, /국토교통부/);
});

test("원문에 없는 숫자를 지어내면 그 요약은 버린다", async () => {
  let paragraphCalls = 0;
  const { summary, stderr } = await runSummarize(({ kind }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "Translated.";
    if (kind === "single") return "국토교통부가 신규 택지를 발표했다.";
    paragraphCalls += 1;
    return "국토교통부는 신규 택지 99만 가구를 공급한다고 발표했다. 분양가는 4억 5000만원으로 정해졌다.";
  });

  assert.match(stderr, /원문에 없는 숫자/);
  assert.ok(paragraphCalls >= 2, "온도를 낮춘 재시도가 없었다");
  const degraded = summary.categories.filter((c) => c.degraded);
  assert.ok(degraded.length > 0, "한 문장 폴백이 동작하지 않았다");
  assert.ok(
    degraded.every((c) => !c.isFallback && !c.lineKo.includes("99만")),
    "검증에 걸린 문장이 그대로 실렸다"
  );
});

test("원문에 없는 고유명사를 지어내면 그 요약은 버린다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "국민의당";
    if (kind === "translate") return "Translated.";
    if (kind === "single") return null;
    return goodKo(prompt);
  });

  assert.match(stderr, /원문에 없는 고유명사/);
  assert.ok(
    summary.categories.some((c) => c.isFallback && c.fallbackReason === "unverified-entity"),
    "환각이 걸러지지 않았다"
  );
});

test("모델이 죽어도 파일은 남고 폴백 이유가 기록된다", async () => {
  const { summary, stdout } = await runSummarize(() => null);

  assert.ok(summary.categories.length > 0);
  assert.ok(summary.categories.every((c) => c.isFallback && c.fallbackReason === "generation-failed"));
  assert.equal(summary.highlights.length, 0);
  assert.match(stdout, /폴백/);
});

test("잘린 문장은 내보내지 않는다", async () => {
  const { summary } = await runSummarize(({ kind }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "The ministry announced new sites.";
    if (kind === "single") return "국토교통부가 신규 택지를 발표했다.";
    return "국토교통부는 신규 공공택지 후보지를 발표했다. 정부는 연내 추가 발표를 예고했으며 구체적인 위치는";
  });

  for (const category of summary.categories) {
    assert.doesNotMatch(category.lineKo, /구체적인 위치는$/, "잘린 꼬리가 남았다");
    assert.match(category.lineKo, /[.!?]$/, "종결부호 없이 끝났다");
  }
});

test("번역이 검증에 걸리면 영어 화면은 한국어를 그대로 쓴다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "The ministry 발표했다.";
    return goodKo(prompt);
  });

  assert.match(stderr, /번역 검증 실패/);
  assert.ok(summary.categories.every((c) => c.lineEn === c.lineKo));
});

test("핵심 기사는 여러 매체가 다룬 순으로 뽑되 한 주제가 독차지하지 않는다", () => {
  const bodies = {};
  const items = [];
  for (let i = 0; i < 6; i += 1) {
    const link = `https://example.com/re${i}`;
    items.push({ title: `부동산 ${i}`, link, category: "realestate", dupes: [{}, {}] });
    bodies[link] = "가".repeat(400);
  }
  const stockLink = "https://example.com/stock";
  items.push({ title: "증시", link: stockLink, category: "stocks", dupes: [] });
  bodies[stockLink] = "나".repeat(400);

  const picked = pickHighlights(items, bodies);
  assert.equal(picked.length, 3);
  const realestate = picked.filter((p) => p.item.category === "realestate");
  assert.ok(realestate.length <= 2, "한 카테고리가 핵심을 독차지했다");
});

test("본문이 짧은 기사는 핵심으로 뽑지 않는다", () => {
  const items = [{ title: "속보", link: "https://example.com/x", category: "stocks", dupes: [{}, {}] }];
  assert.deepEqual(pickHighlights(items, { "https://example.com/x": "짧다" }), []);
});

test("숫자가 떨어져 나간 고유명사를 환각으로 몰지 않는다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return /코스피|물가지수/.test(prompt) ? "월 물가지수" : "없음";
    if (kind === "translate") return EN_OK;
    return goodKo(prompt);
  });

  assert.doesNotMatch(stderr, /원문에 없는 고유명사/, "숫자 차이를 환각으로 판정했다");
  assert.ok(summary.categories.every((c) => !c.isFallback && !c.degraded));
});

test("정말 다른 이름으로 바꿔 쓴 건 여전히 걸러낸다", async () => {
  const { stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "국민의당";
    if (kind === "translate") return "Translated.";
    if (kind === "single") return "국토교통부가 발표했다.";
    return goodKo(prompt);
  });

  assert.match(stderr, /원문에 없는 고유명사\(국민의당\)/);
});

test("반려된 번역은 한 번 더 시도한다", async () => {
  let attempts = 0;
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") {
      attempts += 1;
      return attempts === 1 ? `The 公示 price rose. ${EN_OK}` : EN_OK;
    }
    return goodKo(prompt);
  });

  assert.doesNotMatch(stderr, /번역 검증 실패/, "재시도 없이 포기했다");
  assert.ok(
    summary.categories.every((c) => c.lineEn !== c.lineKo),
    "영어 화면에 한국어가 남았다"
  );
});

test("조·억이 이어 붙은 금액도 온전히 숫자로 바꾼다", () => {
  assert.equal(normalizeKoreanAmounts("6조5천470억원 순매수"), "6,547,000,000,000원 순매수");
  assert.equal(normalizeKoreanAmounts("가계대출은 1천865조8천억원"), "가계대출은 1,865,800,000,000,000원");
  assert.equal(normalizeKoreanAmounts("3개월 만에 12조9천억원 증가"), "3개월 만에 12,900,000,000,000원 증가");
  assert.equal(normalizeKoreanAmounts("공시가 14억5000만원 주택"), "공시가 1,450,000,000원 주택");
  assert.equal(normalizeKoreanAmounts("약 209만원"), "약 2,090,000원");
});

test("금액이 아닌 숫자는 건드리지 않는다", () => {
  for (const text of ["2026년 세제개편안", "분양가의 25%만 먼저 낸다", "8월 둘째주", "순매수 1, 2위"]) {
    assert.equal(normalizeKoreanAmounts(text), text);
  }
});

test("일반 경제 용어는 고유명사 대조에서 빼고 본다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "월 물가지수";
    if (kind === "translate") return EN_OK;
    return goodKo(prompt);
  });

  assert.doesNotMatch(stderr, /원문에 없는 고유명사/, "일반 용어를 환각으로 판정했다");
  assert.ok(summary.categories.every((c) => !c.isFallback && !c.degraded));
});

test("번역 재시도에는 무엇이 걸렸는지 알려준다", async () => {
  const hints = [];
  await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") {
      hints.push(prompt);
      return hints.length === 1 ? `The 公示 price rose. ${EN_OK}` : EN_OK;
    }
    return goodKo(prompt);
  });

  const retry = hints[1] ?? "";
  assert.match(retry, /Chinese characters/, "재시도 프롬프트에 반려 이유가 없다");
  assert.match(retry, /公示/, "무엇이 문제였는지 짚어주지 않았다");
});

test("한자만 걸린 번역은 한자를 걷어내고 살린다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return `A home with a公示value of 30,000 won.`;
    return goodKo(prompt);
  });

  assert.match(stderr, /한자를 걷어내고 번역 채택/);
  for (const category of summary.categories) {
    assert.doesNotMatch(category.lineEn, /[\u4e00-\u9fff]/, "한자가 남았다");
    assert.notEqual(category.lineEn, category.lineKo, "한국어로 떨어졌다");
    assert.match(category.lineEn, /a value of/, "한자를 지우며 단어가 붙어버렸다");
  }
});

test("한자를 걷어내도 안 되는 번역은 한국어를 유지한다", async () => {
  const { summary, stderr } = await runSummarize(({ kind, prompt }) => {
    if (kind === "entities") return "없음";
    if (kind === "translate") return "The 公示 가격 rose by 30,000.";
    return goodKo(prompt);
  });

  assert.match(stderr, /번역 검증 실패/);
  assert.ok(summary.categories.every((c) => c.lineEn === c.lineKo));
});

// ---- #258: 스크립트의 시계는 SUMMARY_NOW 하나이고, "오늘 것인가"는 시각이 아니라 KST 날짜끼리의 비교다 ----

const okReply = ({ kind, prompt }) => {
  if (kind === "entities") return /코스피/.test(prompt) ? "코스피" : "국토교통부";
  if (kind === "translate") return EN_OK;
  return goodKo(prompt);
};
const exists = (file) => access(file).then(() => true, () => false);

test("KST 자정 1초 전(UTC 14:59:59)에는 그날 news.date의 요약이 나오고, 저장 시각·기록 날짜가 같은 시계를 쓴다", async () => {
  const now = "2026-10-11T14:59:59Z";
  const { summary, stderr, dataDir } = await runSummarize(okReply, { now, newsDate: "2026-10-11" });

  assert.equal(stderr, "", `요약이 생략됐다:\n${stderr}`);
  assert.ok(summary.categories.length > 0);
  assert.equal(summary.updatedAt, "2026-10-11T14:59:59.000Z", "저장 시각이 주입한 시각이 아니다");
  const source = JSON.parse(await readFile(path.join(dataDir, "summary-source.json"), "utf8"));
  assert.equal(source.updatedAt, "2026-10-11T14:59:59.000Z");
  const history = JSON.parse(await readFile(path.join(dataDir, "summary-history.json"), "utf8"));
  assert.deepEqual(history.map((h) => h.date), ["2026-10-11"], "기록 날짜가 비교에 쓴 오늘과 다르다");
});

test("KST 자정 1초 뒤(UTC 15:00:01)에는 같은 news.date가 어제 것이라 요약을 생략하고 summary.json을 만들지 않는다", async () => {
  const now = "2026-10-11T15:00:01Z";
  const { summary, stderr, stdout, dataDir } = await runSummarize(okReply, { now, newsDate: "2026-10-11", expectSkip: true });

  assert.equal(summary, null);
  assert.match(stderr, /news\.json이 오늘\(2026-10-12\) 것이 아님\(2026-10-11\), 요약 생략/);
  assert.equal(stdout, "");
  for (const name of ["summary.json", "summary-source.json", "summary-history.json"]) {
    assert.equal(await exists(path.join(dataDir, name)), false, `${name}이 만들어졌다`);
  }
});

test("대조: news.date가 하루 뒤(2026-10-12)면 판정이 뒤집힌다 — 비교는 시각이 아니라 날짜다", async () => {
  // 15:00:01Z는 KST 10-12라 news.date 10-12가 "오늘"이고, 14:59:59Z는 KST 10-11이라 10-12가 "내일"이다.
  const after = await runSummarize(okReply, { now: "2026-10-11T15:00:01Z", newsDate: "2026-10-12" });
  assert.equal(after.stderr, "");
  assert.equal(after.summary.updatedAt, "2026-10-11T15:00:01.000Z");
  const history = JSON.parse(await readFile(path.join(after.dataDir, "summary-history.json"), "utf8"));
  assert.deepEqual(history.map((h) => h.date), ["2026-10-12"]);

  const before = await runSummarize(okReply, { now: "2026-10-11T14:59:59Z", newsDate: "2026-10-12", expectSkip: true });
  assert.equal(before.summary, null);
  assert.match(before.stderr, /news\.json이 오늘\(2026-10-11\) 것이 아님\(2026-10-12\), 요약 생략/);
});

test("summaryNow: 미설정이거나 빈 문자열이면 지금 시각 그대로다", () => {
  // 실제 시계를 읽되 결과는 시각에 달리지 않는다 — 호출 앞뒤로 잰 구간 안이면 통과.
  for (const env of [{}, { SUMMARY_NOW: "" }]) {
    const before = Date.now();
    const got = summaryNow(env).getTime();
    assert.ok(got >= before && got <= Date.now(), `지금이 아닌 값이다: ${got}`);
  }
});

test("summaryNow: 시간대를 가진 ISO는 지금과 무관하게 그 시각이다", () => {
  assert.equal(summaryNow({ SUMMARY_NOW: "2026-10-11T14:59:59Z" }).toISOString(), "2026-10-11T14:59:59.000Z");
  assert.equal(summaryNow({ SUMMARY_NOW: "2026-10-11T15:00:01.250Z" }).toISOString(), "2026-10-11T15:00:01.250Z");
  assert.equal(summaryNow({ SUMMARY_NOW: "2026-10-12T00:00:01+09:00" }).toISOString(), "2026-10-11T15:00:01.000Z");
  assert.equal(summaryNow({ SUMMARY_NOW: "2026-10-11T14:59Z" }).toISOString(), "2026-10-11T14:59:00.000Z");
});

test("summaryNow: 읽을 수 없는 값은 지금으로 넘기지 않고 멈춘다(시간대 없음·날짜만·달력에 없는 날 포함)", () => {
  for (const bad of [
    "어제",
    "2026-10-11",
    "2026-10-11T14:59:59", // 시간대가 없으면 실행하는 쪽 TZ에 따라 뜻이 갈린다
    "2026-10-11 14:59:59Z",
    "1791730799000",
    "2026-02-30T00:00:00Z", // Date.parse는 3월 2일로 굴린다
    "2026-10-11T24:00:00Z",
    "2026-13-01T00:00:00Z",
    " 2026-10-11T14:59:59Z",
  ]) {
    assert.throws(() => summaryNow({ SUMMARY_NOW: bad }), /SUMMARY_NOW를 읽을 수 없습니다/, bad);
  }
});

test("읽을 수 없는 SUMMARY_NOW로 스크립트를 돌리면 요약을 쓰지 않고 실패로 끝난다", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "digest-"));
  const dataDir = path.join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "news.json"),
    JSON.stringify({ updatedAt: "2026-10-11T05:00:00.000Z", date: NEWS_DATE, items: NEWS_ITEMS })
  );
  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath], {
      env: { ...process.env, SUMMARY_DATA_DIR: dataDir, NEWS_BODIES_FILE: path.join(dir, "none.json"), SUMMARY_NOW: "2026-10-11T14:59:59" },
    }),
    (err) => err.code === 1 && /요약 생성 실패: SUMMARY_NOW를 읽을 수 없습니다/.test(err.stderr)
  );
  assert.equal(await exists(path.join(dataDir, "summary.json")), false);
});
