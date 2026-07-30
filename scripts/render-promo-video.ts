import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Resvg } from "../app/node_modules/@resvg/resvg-js/index.js";

const ROOT = resolve(import.meta.dir, "..");
const WIDTH = Number(process.env.PROMO_WIDTH ?? 1280);
const HEIGHT = Number(process.env.PROMO_HEIGHT ?? 720);
const FPS = Number(process.env.PROMO_FPS ?? 30);
const DURATION = Number(process.env.PROMO_DURATION ?? 15);
const OUTPUT = resolve(process.env.PROMO_OUTPUT ?? `${ROOT}/docs/assets/ytzero-promo-en.mp4`);
const POSTER = resolve(process.env.PROMO_POSTER ?? `${ROOT}/docs/assets/ytzero-promo-poster.png`);

const imageData = (path: string, mime: string) =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;

const logo = imageData(`${ROOT}/docs/assets/ytzero-logo.svg`, "image/svg+xml");
const screenshots = {
  feed: imageData(`${ROOT}/docs/assets/feed.png`, "image/png"),
  tags: imageData(`${ROOT}/docs/assets/tags.png`, "image/png"),
  player: imageData(`${ROOT}/docs/assets/video-theater.png`, "image/png"),
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (value: number) => {
  const t = clamp(value);
  return 1 - Math.pow(1 - t, 4);
};
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
}[char]!));

type Scene = {
  start: number;
  end: number;
  eyebrow: string;
  headline: string;
  lead: string;
  badge: string;
  image: keyof typeof screenshots;
  title: string;
};

const scenes: Scene[] = [
  {
    start: 1.4, end: 5.0, eyebrow: "YOUR SUBSCRIPTIONS, YOUR WAY", headline: "Own rules.",
    lead: "Build a calm inbox around the channels you actually chose.", badge: "FOCUSED INBOX",
    image: "feed", title: "Your subscription feed",
  },
  {
    start: 4.7, end: 8.6, eyebrow: "SORT WHAT MATTERS", headline: "Own algorithm.",
    lead: "Tags, filters, playlists, and scheduling — controlled by you.", badge: "YOUR PRIORITIES",
    image: "tags", title: "Tags and rules",
  },
  {
    start: 8.3, end: 12.2, eyebrow: "LOCAL-FIRST & SELF-HOSTED", headline: "No login required.",
    lead: "Watch without a Google account, an API key, or a recommendation loop.", badge: "NO GOOGLE ACCOUNT",
    image: "player", title: "Watch on your terms",
  },
];

function sceneOpacity(time: number, scene: Scene) {
  const fadeIn = smooth((time - scene.start) / 0.55);
  const fadeOut = 1 - smooth((time - (scene.end - 0.55)) / 0.55);
  return clamp(Math.min(fadeIn, fadeOut));
}

function windowMarkup(scene: Scene, time: number, opacity: number, index: number) {
  const local = clamp((time - scene.start) / 0.8);
  const enter = ease(local);
  const x = 680 + (1 - enter) * 120;
  const y = 175 + (1 - enter) * 24;
  const scale = 0.965 + enter * 0.035;
  const shimmer = ((time * 110) % 980) - 260;
  return `
    <g opacity="${opacity.toFixed(3)}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">
      <rect x="-8" y="10" width="548" height="386" rx="28" fill="#000" opacity=".46" filter="url(#softShadow)"/>
      <rect width="532" height="370" rx="21" fill="#0c1018" stroke="url(#windowStroke)" stroke-width="1.2"/>
      <rect width="532" height="38" rx="21" fill="#171b24"/>
      <rect y="20" width="532" height="18" fill="#171b24"/>
      <circle cx="17" cy="19" r="4.5" fill="#424854"/><circle cx="31" cy="19" r="4.5" fill="#424854"/><circle cx="45" cy="19" r="4.5" fill="#424854"/>
      <text x="62" y="23" fill="#8d96a8" font-size="10.5" font-weight="600">${esc(scene.title)}</text>
      <g clip-path="url(#windowClip${index})">
        <rect y="38" width="532" height="332" fill="#0b0d11"/>
        <image href="${screenshots[scene.image]}" x="0" y="38" width="532" height="332" preserveAspectRatio="xMidYMid slice"/>
        <rect x="${shimmer.toFixed(1)}" y="38" width="190" height="332" fill="url(#shimmer)" opacity=".13" transform="skewX(-14)"/>
      </g>
      <rect x="16" y="322" width="178" height="30" rx="15" fill="#081a3c" stroke="#1a58bc" stroke-opacity=".72"/>
      <circle cx="33" cy="337" r="4" fill="#55b8ff"/>
      <text x="45" y="341" fill="#b9dcff" font-size="10" font-weight="750" letter-spacing="1.05">${esc(scene.badge)}</text>
    </g>`;
}

function copyMarkup(scene: Scene, time: number, opacity: number) {
  const local = clamp((time - scene.start) / 0.7);
  const enter = ease(local);
  const x = 76 - (1 - enter) * 34;
  const split = scene.headline.split(" ");
  const last = split.pop() ?? "";
  const first = split.join(" ");
  const words = scene.lead.split(" ");
  const leadLines: string[] = [];
  for (const word of words) {
    const current = leadLines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > 43) leadLines.push(word);
    else leadLines[leadLines.length - 1] = `${current} ${word}`;
  }
  return `
    <g opacity="${opacity.toFixed(3)}" transform="translate(${x.toFixed(1)} 0)">
      <text x="0" y="278" fill="#68baff" font-size="13" font-weight="800" letter-spacing="2.15">${esc(scene.eyebrow)}</text>
      <text x="0" y="350" fill="#f7f9fd" font-size="62" font-weight="800" letter-spacing="-3.1">${esc(first)}</text>
      <text x="0" y="412" fill="url(#headlineGradient)" font-size="62" font-weight="800" letter-spacing="-3.1">${esc(last)}</text>
      <text x="0" y="454" fill="#c2ccda" fill-opacity=".75" font-size="18" font-weight="400">${leadLines.map((line, index) => `<tspan x="0" dy="${index === 0 ? 0 : 27}">${esc(line)}</tspan>`).join("")}</text>
    </g>`;
}

function introMarkup(time: number) {
  const out = 1 - smooth((time - 1.05) / 0.55);
  const enter = ease(time / 0.75);
  const scale = 0.88 + enter * 0.12;
  return `
    <g opacity="${out.toFixed(3)}" transform="translate(640 344) scale(${scale.toFixed(3)}) translate(-640 -344)">
      <rect x="582" y="205" width="116" height="116" rx="27" fill="#0a5fff" filter="url(#blueGlow)"/>
      <path d="M617 242a10 10 0 0 1 15.04-8.64l39.99 23.33a10 10 0 0 1 .01 17.29l-40 23.34A10 10 0 0 1 617 288z" fill="#fff"/>
      <text x="640" y="375" text-anchor="middle" fill="#f8faff" font-size="40" font-weight="800" letter-spacing="-1.7">YT Zero</text>
      <text x="640" y="414" text-anchor="middle" fill="#72bfff" font-size="13" font-weight="800" letter-spacing="3">WATCH WITH INTENTION</text>
    </g>`;
}

function outroMarkup(time: number) {
  const enter = ease((time - 11.7) / 0.75);
  const opacity = smooth((time - 11.7) / 0.55);
  const y = 0 + (1 - enter) * 28;
  return `
    <g opacity="${opacity.toFixed(3)}" transform="translate(0 ${y.toFixed(1)})">
      <rect x="574" y="102" width="132" height="132" rx="30" fill="#0a5fff" filter="url(#blueGlow)"/>
      <path d="M614 144a11 11 0 0 1 16.54-9.5l43.99 25.66a11 11 0 0 1 .01 19.02l-44 25.67A11 11 0 0 1 614 195z" fill="#fff"/>
      <text x="640" y="302" text-anchor="middle" fill="#f8faff" font-size="61" font-weight="800" letter-spacing="-3">Own rules. Own algorithm.</text>
      <text x="640" y="367" text-anchor="middle" fill="url(#headlineGradient)" font-size="61" font-weight="800" letter-spacing="-3">No login required.</text>
      <text x="640" y="421" text-anchor="middle" fill="#aeb9ca" font-size="19">A quiet, self-hosted inbox for the channels you choose.</text>
      <rect x="494" y="472" width="292" height="48" rx="24" fill="#0b1d3e" stroke="#2475e8" stroke-opacity=".75"/>
      <text x="640" y="503" text-anchor="middle" fill="#d7ecff" font-size="15" font-weight="700" letter-spacing=".6">github.com/Pelski/ytzero</text>
    </g>`;
}

function svgFrame(time: number) {
  const backgroundShift = Math.sin(time * 0.38) * 25;
  const glow = 0.5 + Math.sin(time * 0.9) * 0.08;
  const activeScenes = scenes.map((scene) => ({ scene, opacity: sceneOpacity(time, scene) }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#05070c"/><stop offset=".5" stop-color="#080b13"/><stop offset="1" stop-color="#061126"/></linearGradient>
    <radialGradient id="halo" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1120 600) rotate(-142) scale(530 460)"><stop stop-color="#075dff" stop-opacity="${glow.toFixed(2)}"/><stop offset="1" stop-color="#071128" stop-opacity="0"/></radialGradient>
    <linearGradient id="headlineGradient" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#60c5ff"/><stop offset="1" stop-color="#4d7cff"/></linearGradient>
    <linearGradient id="windowStroke" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".24"/><stop offset=".5" stop-color="#4e7ec7" stop-opacity=".16"/><stop offset="1" stop-color="#2d69ff" stop-opacity=".4"/></linearGradient>
    <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#8acbff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="180%"><feGaussianBlur stdDeviation="20"/></filter>
    <filter id="blueGlow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#0767ff" flood-opacity=".48"/></filter>
    ${scenes.map((_, index) => `<clipPath id="windowClip${index}"><rect y="38" width="532" height="332" rx="0 0 20 20"/></clipPath>`).join("")}
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#halo)"/>
  <g transform="translate(${backgroundShift.toFixed(1)} 0)" opacity=".72">
    <path d="M-160 38 C60 160 106 0 286 30 S484 36 580 -102" fill="none" stroke="#144be5" stroke-width="42" opacity=".19"/>
    <path d="M-190 2 C65 138 124 -24 320 4 S526 20 646 -126" fill="none" stroke="#2473ff" stroke-width="2.3" opacity=".78"/>
    <path d="M875 806 C958 612 1046 671 1119 530 S1224 491 1397 382" fill="none" stroke="#1861ff" stroke-width="82" opacity=".17"/>
    <path d="M842 818 C938 583 1032 678 1110 503 S1241 468 1425 344" fill="none" stroke="#2a79ff" stroke-width="2.4" opacity=".72"/>
  </g>
  <rect width="1280" height="720" fill="#02040a" opacity=".12"/>
  <g transform="translate(76 52)">
    <image href="${logo}" width="42" height="42"/>
    <text x="56" y="28" fill="#eaf0fb" font-size="17" font-weight="750" letter-spacing="-.2">YT Zero</text>
  </g>
  ${time < 1.7 ? introMarkup(time) : ""}
  ${time < 12.5 ? activeScenes.map(({ scene, opacity }, index) => `${copyMarkup(scene, time, opacity)}${windowMarkup(scene, time, opacity, index)}`).join("") : ""}
  ${time >= 11.5 ? outroMarkup(time) : ""}
  <rect x="0" y="0" width="1280" height="720" fill="none" stroke="#ffffff" stroke-opacity=".025"/>
</svg>`;
}

mkdirSync(dirname(OUTPUT), { recursive: true });
mkdirSync(dirname(POSTER), { recursive: true });
const frames = mkdtempSync(resolve(tmpdir(), "ytzero-promo-"));
const totalFrames = Math.round(DURATION * FPS);

try {
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const time = frame / FPS;
    const rendered = new Resvg(svgFrame(time), {
      fitTo: { mode: "width", value: WIDTH },
      font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
    }).render();
    const filename = `${frames}/frame-${String(frame).padStart(5, "0")}.png`;
    Bun.write(filename, rendered.asPng());
    if (frame % FPS === 0) process.stdout.write(`Rendering ${Math.round(time)}s / ${DURATION}s\r`);
  }
  process.stdout.write(`Rendering ${DURATION}s / ${DURATION}s\n`);

  const posterFrame = Math.min(totalFrames - 1, Math.round(13.2 * FPS));
  Bun.write(POSTER, readFileSync(`${frames}/frame-${String(posterFrame).padStart(5, "0")}.png`));

  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "warning",
    "-framerate", String(FPS), "-i", `${frames}/frame-%05d.png`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", OUTPUT,
  ], { stdio: "inherit" });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed with exit code ${ffmpeg.status}`);
  console.log(`Video:  ${OUTPUT}`);
  console.log(`Poster: ${POSTER}`);
} finally {
  rmSync(frames, { recursive: true, force: true });
}
