// Temporary localhost launcher for a user-supervised live run. This is not a production auth service.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = "taowen-paraflow/shared-morty";
const port = 4173;
const host = `127.0.0.1:${port}`;
const root = resolve("dist/launcher");
let authRead = false;

const bootstrap = `
const root = document.querySelector('main');
async function connect() {
  const response = await fetch('/live-auth', {cache:'no-store', credentials:'same-origin'});
  if (response.status === 403) return;
  if (!response.ok) throw new Error('Local GitHub bootstrap failed');
  const data = await response.json();
  if (!data || typeof data.token !== 'string' || typeof data.repository !== 'string') throw new Error('Invalid bootstrap');
  const repository = document.querySelector('input[name="repository"]');
  const token = document.querySelector('input[name="token"]');
  const form = document.querySelector('form');
  if (!repository || !token || !form) throw new Error('Launcher not mounted');
  repository.value = data.repository;
  token.value = data.token;
  data.token = '';
  form.requestSubmit();
}
connect().catch(() => {
  const message = document.createElement('p');
  message.textContent = '本地 GitHub 连接未完成，请回到 Codex 检查。';
  root?.append(message);
});
`;

const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    if (request.headers.host !== host || request.method !== "GET") {
        response.writeHead(403).end();
        return;
    }
    try {
        const url = new URL(request.url ?? "/", `http://${host}`);
        if (url.pathname === "/live-auth") {
            if (request.headers["sec-fetch-site"] !== "same-origin" || authRead) {
                response.writeHead(403).end();
                return;
            }
            authRead = true;
            const { stdout } = await execute("gh", ["auth", "token"], { timeout: 10_000, maxBuffer: 16_384 });
            const token = stdout.trim();
            if (!token || /[\r\n]/u.test(token)) throw new Error("Invalid local authentication");
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ token, repository }));
            return;
        }
        if (url.pathname === "/live-bootstrap.js") {
            response.setHeader("content-type", "text/javascript");
            response.end(bootstrap);
            return;
        }
        const asset = new Map([["/", "index.html"], ["/main.js", "main.js"], ["/main.css", "main.css"]]).get(url.pathname);
        if (!asset) { response.writeHead(404).end(); return; }
        const content = await readFile(resolve(root, asset), "utf8");
        response.setHeader("content-type", asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : "text/html");
        response.end(asset === "index.html" ? content.replace("connect-src https://api.github.com", "connect-src 'self' https://api.github.com").replace("</body>", '<script type="module" src="/live-bootstrap.js"></script></body>') : content);
    } catch {
        response.writeHead(503).end("Local launcher unavailable");
    }
});

const deadline = setTimeout(() => stop(), 30 * 60_000);
const stop = () => { clearTimeout(deadline); server.closeAllConnections(); server.close(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.on("close", () => { clearTimeout(deadline); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); });
server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ event: "live_launcher.ready", url: `http://${host}`, repository })));
