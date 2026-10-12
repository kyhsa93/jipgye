#!/usr/bin/env node
// 시트 PNG의 위쪽 구간을 WebP로 줄인다(비교 한 장에 내장할 용도). 새로 찍지 않고 **시트의 같은 픽셀**을 잘라 쓴다.
//   import { convert } from "./webp.mjs";  await convert(chrome, [{ src, top: 0, height: 1800, quality: 70 }]) → [{ dataUri, bytes, width, height, fullHeight }]
// 헤드리스 Chrome으로 PNG를 원래 크기 <img>로 띄워 그 구간만 WebP로 캡처한다(npm 의존 없음).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export async function convert(chrome, jobs) {
  // PNG를 내주는 임시 서버(127.0.0.1). 경로는 색인 번호뿐이라 폴더 밖 파일을 읽을 길이 없다.
  const server = createServer(async (req, res) => {
    const m = req.url.match(/^\/(\d+)\.png(?:\?.*)?$/);
    if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}img{display:block}</style><img id="i">`); return; }
    if (!m || !jobs[Number(m[1])]) { res.writeHead(404).end(); return; }
    const body = await readFile(jobs[Number(m[1])].src);
    res.writeHead(200, { "content-type": "image/png", "content-length": body.length }).end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const out = [];
  const page = await chrome.newPage({ allowOrigin: url, js: true, width: 1280, height: 900 });
  try {
    await page.goto(url);
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const size = await page.evaluate(`new Promise((resolve, reject) => { const img = document.getElementById("i"); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => reject(new Error("그림을 못 읽음")); img.src = "/${i}.png?" + Date.now(); })`);
      await page.setWidth(Math.max(size.w, 320), 900);
      const top = job.top ?? 0;
      const height = Math.min(job.height ?? size.h, size.h - top);
      const { data } = await page.send("Page.captureScreenshot", { format: "webp", quality: job.quality ?? 70, captureBeyondViewport: true, clip: { x: 0, y: top, width: size.w, height, scale: 1 } });
      out.push({ dataUri: `data:image/webp;base64,${data}`, bytes: Buffer.from(data, "base64").length, width: size.w, height, fullHeight: size.h, top });
    }
  } finally {
    await page.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  return out;
}
