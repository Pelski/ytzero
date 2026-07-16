import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { api } from "./routes";
import { getSetting } from "./db";
import { startScheduler } from "./refresher";
import { startDownloader } from "./downloader";
import { log } from "./logger";

const app = new Hono();

app.route("/api", api);

// App icon, generated from the saved color so the favicon and the PWA icon
// match the in-app logo. Served before serveStatic so it wins over the static
// files in ./public. Note: an already-installed PWA caches its icon at install
// time, so a color change only shows on (re)install or an OS icon refresh.
const iconColor = () => getSetting("app_icon_color") || "#f2293a";
const svgHeaders = { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" };

app.get("/favicon.svg", (c) =>
  c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${iconColor()}"/><polygon points="192,160 384,256 192,352" fill="#fff"/></svg>`,
    200,
    svgHeaders,
  ),
);

app.get("/icon-maskable.svg", (c) =>
  c.body(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${iconColor()}"/><polygon points="178,168 358,256 178,344" fill="#fff"/></svg>`,
    200,
    svgHeaders,
  ),
);

// Serve the built UI (ui/dist is copied to ./public in the Docker image,
// or set UI_DIST when running locally).
const uiDir = process.env.UI_DIST ?? "./public";
app.use("/*", serveStatic({ root: uiDir }));
app.get("*", serveStatic({ path: `${uiDir}/index.html` }));

startScheduler();
startDownloader();

const port = Number(process.env.PORT ?? 3001);
const idleTimeout = Number(process.env.IDLE_TIMEOUT_SECONDS ?? 120);
const server = Bun.serve({ port, idleTimeout, fetch: app.fetch });
log.info("app.listen", { url: String(server.url), port, uiDir, idleTimeout });
