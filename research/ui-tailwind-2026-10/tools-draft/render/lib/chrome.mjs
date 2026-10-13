// 헤드리스 Chrome을 띄워 DevTools 프로토콜(CDP)로 모는 최소 클라이언트(#274). npm 의존이 없다 — 이 머신의 Chrome과
// Node 내장 WebSocket(Node 22 이상)만 쓴다. puppeteer를 들이면 락파일이 생기고 Chromium을 따로 받는다.
// 쓰는 쪽: lib/rendered.mjs(CSS가 숨긴 글자·가로 넘침·첫 초점), bin/shots.mjs(스크린샷).
//
// 바깥 요청은 기본으로 막는다(allowOrigin 밖은 전부 실패 처리). 이유가 둘이다.
//   1. 페이지의 analytics.js가 GA·애드센스 로더를 부른다 — 측정이 실제 속성에 조회수를 쌓으면 안 된다(#247 관찰 중).
//   2. 환율 API 같은 바깥 응답이 화면을 흔들면 같은 입력에서도 결과가 갈린다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** CHROME_PATH가 있으면 그것, 없으면 흔한 설치 위치에서 찾는다. 없으면 null. */
export function findChrome() {
  return [process.env.CHROME_PATH, ...CANDIDATES].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chrome을 띄우고 CDP에 붙는다. 반환: { version, newPage(opts), close() }.
 * newPage({ allowOrigin, js, width, height, colorScheme, initScript }) → { send, waitFor, goto, evaluate, close }
 *   allowOrigin — 이 머리로 시작하는 주소(와 data:·about:)만 통과시키고 나머지 요청은 막는다. null이면 막지 않는다.
 *   js          — false면 페이지 스크립트를 끈다(구운 HTML + CSS만). CDP의 evaluate는 그래도 돈다.
 *   colorScheme — "light" | "dark" (prefers-color-scheme 흉내).
 *   initScript  — 문서가 뜨기 전에 돌릴 스크립트(localStorage에 테마·언어를 심는 데 쓴다). js:false면 돌지 않는다.
 * 장마다 새 브라우저 컨텍스트라 저장소(localStorage·서비스워커)가 섞이지 않는다.
 */
export async function launchChrome({ chromePath = findChrome(), timeoutMs = 30000 } = {}) {
  if (!chromePath) throw new Error("Chrome을 찾지 못했습니다. CHROME_PATH로 실행 파일을 알려 주세요.");
  if (typeof WebSocket === "undefined") throw new Error("Node 내장 WebSocket이 없습니다(Node 22 이상이 필요합니다).");
  const profile = await mkdtemp(path.join(os.tmpdir(), "golden-chrome-"));
  const child = spawn(
    chromePath,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--disable-background-networking", "--disable-component-update", "--disable-sync", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const cleanup = async () => {
    child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  let ws;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let err = "";
      const timer = setTimeout(() => reject(new Error(`Chrome이 ${timeoutMs}ms 안에 뜨지 않았습니다: ${err.slice(-500)}`)), timeoutMs);
      child.stderr.on("data", (d) => {
        err += d;
        const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child.once("exit", (code) => reject(new Error(`Chrome이 바로 끝났습니다(${code}): ${err.slice(-500)}`)));
    });
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP 소켓을 열지 못했습니다")), { once: true });
    });
  } catch (e) {
    await cleanup();
    throw e;
  }

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p?.resolve(msg.result);
    } else for (const fn of listeners) fn(msg);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { product } = await send("Browser.getVersion");

  async function newPage({ allowOrigin = null, js = true, width = 1280, height = 900, colorScheme = "light", initScript = null } = {}) {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    const blocked = [];
    const onEvent = (msg) => {
      if (msg.sessionId !== sessionId || msg.method !== "Fetch.requestPaused") return;
      const { requestId, request } = msg.params;
      const ok = allowOrigin === null || request.url.startsWith(allowOrigin) || /^(data|about|blob):/.test(request.url);
      if (!ok) blocked.push(request.url);
      cmd(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? { requestId } : { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    };
    listeners.add(onEvent);
    const waitFor = (method, ms = timeoutMs) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(fn);
          reject(new Error(`${method}를 ${ms}ms 안에 받지 못했습니다`));
        }, ms);
        const fn = (msg) => {
          if (msg.sessionId !== sessionId || msg.method !== method) return;
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(msg.params);
        };
        listeners.add(fn);
      });
    await cmd("Page.enable");
    await cmd("Runtime.enable");
    if (allowOrigin !== null) await cmd("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: colorScheme }] });
    await cmd("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (!js) await cmd("Emulation.setScriptExecutionDisabled", { value: true });
    if (initScript) await cmd("Page.addScriptToEvaluateOnNewDocument", { source: initScript });
    return {
      send: cmd,
      waitFor,
      blocked,
      /** 주소를 열고 load 이벤트 뒤 settleMs만큼 기다린다(JS가 데이터를 받아 다시 그리는 시간). */
      async goto(url, { settleMs = 0 } = {}) {
        const loaded = waitFor("Page.loadEventFired");
        const nav = await cmd("Page.navigate", { url });
        if (nav.errorText) throw new Error(`${url}: ${nav.errorText}`);
        await loaded;
        if (settleMs) await sleep(settleMs);
      },
      /** 페이지 안에서 식을 돌려 값(JSON으로 옮길 수 있는 것)을 받는다. */
      async evaluate(expression) {
        const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`evaluate 실패: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        return r.result.value;
      },
      async setWidth(w, h = height) {
        await cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      },
      async close() {
        listeners.delete(onEvent);
        await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
      },
    };
  }

  return {
    version: product,
    newPage,
    async close() {
      await send("Browser.close").catch(() => {});
      ws.close();
      await sleep(100);
      await cleanup();
    },
  };
}
