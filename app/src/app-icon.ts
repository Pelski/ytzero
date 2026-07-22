import { Resvg } from "@resvg/resvg-js";

function normalizeColor(color: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? color : "#0a5fff";
}

export function createAppIconSvg(color: string, installIcon = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512"${installIcon ? "" : ' rx="112"'} fill="${normalizeColor(color)}"/>
    <svg x="112" y="112" width="288" height="288" viewBox="0 0 24 24" fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>
    </svg>
  </svg>`;
}

export function createAppIconPng(color: string, size: number): Uint8Array<ArrayBuffer> {
  const rendered = new Resvg(createAppIconSvg(color, true), {
    fitTo: { mode: "width", value: size },
  }).render().asPng();
  // resvg's public type permits SharedArrayBuffer, while Hono expects an
  // ArrayBuffer-backed view. Copying also makes the response own its bytes.
  return new Uint8Array(rendered);
}
