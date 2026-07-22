import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { api } from "./routes";
import { db, getSetting } from "./db";
import { startScheduler } from "./refresher";
import { startDownloader } from "./downloader";
import { log } from "./logger";
import { COMMIT, VERSION } from "./version";
import { createAppIconPng, createAppIconSvg } from "./app-icon";

const app = new Hono();

// Health probe for container runtimes, reverse proxies and installers. Declared
// before the API router so the session middleware never sees it — probes have no
// cookies and must not depend on the configured auth method.
app.get("/api/health", (c) => {
  try {
    db.query("SELECT 1").get();
  } catch (err) {
    log.error("health.db", { error: String(err) });
    return c.json({ status: "error", version: VERSION, commit: COMMIT }, 503);
  }
  return c.json({ status: "ok", version: VERSION, commit: COMMIT, uptime: Math.round(process.uptime()) });
});

app.route("/api", api);

// App icon, generated from the saved color so the favicon and the PWA icon
// match the in-app logo. Served before serveStatic so it wins over the static
// files in ./public. Note: an already-installed PWA caches its icon at install
// time, so a color change only shows on (re)install or an OS icon refresh.
const iconColor = () => getSetting("app_icon_color") || "#0a5fff";
const svgHeaders = { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" };
const pngHeaders = { "Content-Type": "image/png", "Cache-Control": "no-cache, no-store, must-revalidate" };

app.get("/favicon.svg", (c) =>
  c.body(createAppIconSvg(iconColor()), 200, svgHeaders),
);

app.get("/icon-maskable.svg", (c) =>
  c.body(createAppIconSvg(iconColor(), true), 200, svgHeaders),
);

// Apple requires a raster touch icon. These routes also let a fresh PWA
// installation use the color selected in settings instead of a baked asset.
app.get("/apple-touch-icon.png", (c) => c.body(createAppIconPng(iconColor(), 180), 200, pngHeaders));
app.get("/icon-192.png", (c) => c.body(createAppIconPng(iconColor(), 192), 200, pngHeaders));
app.get("/icon-512.png", (c) => c.body(createAppIconPng(iconColor(), 512), 200, pngHeaders));

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
log.info("app.listen", { url: String(server.url), port, uiDir, idleTimeout, version: VERSION, commit: COMMIT });
