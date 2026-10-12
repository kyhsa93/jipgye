// 폴더 하나를 127.0.0.1의 빈 포트로 내보내는 정적 서버(#274). 렌더 기반 검사·스크린샷·Lighthouse가 "구운 폴더"를 여는 길이다.
// 배포 사이트가 아니라 로컬 폴더를 재야 병합 전의 후보도 같은 방식으로 잴 수 있다. 의존 없음(node:http).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/** dir을 서빙한다. 반환: { url: "http://127.0.0.1:포트/", close() }. 폴더 밖 경로는 403, 없는 파일은 404. */
export async function serveDir(dir, { port = 0 } = {}) {
  const root = path.resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      if (!(await stat(file)).isFile()) throw new Error("파일이 아니다");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": body.length, "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404");
    }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
