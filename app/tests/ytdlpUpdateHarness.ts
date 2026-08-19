import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.YTDLP_TEST_ROOT!;
const executable = process.env.YTDLP_PATH!;
const marker = join(root, "channel.txt");
const shellMarker = marker.replaceAll("'", "'\"'\"'");
writeFileSync(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then
  if [ -f '${shellMarker}' ]; then echo "2026.08.19.1"; else echo "2026.08.01"; fi
  exit 0
fi
if [ "$1" = "--update-to" ]; then
  echo "$2" > '${shellMarker}'
  echo "Updated yt-dlp to $2"
  exit 0
fi
exit 2
`);
chmodSync(executable, 0o755);

const { setYtdlpUpdateConfig, ytdlpSelfUpdate, ytdlpUpdateChannel, ytdlpUpdateIntervalDays } = await import("../src/ytdlpUpdater");
const defaults = { channel: ytdlpUpdateChannel(), interval: ytdlpUpdateIntervalDays() };
await setYtdlpUpdateConfig("stable", 3);
const configured = { channel: ytdlpUpdateChannel(), interval: ytdlpUpdateIntervalDays() };
const update = await ytdlpSelfUpdate({ force: true });
await setYtdlpUpdateConfig("nightly", 0);
const disabled = await ytdlpSelfUpdate();

console.log("RESULT " + JSON.stringify({
  defaults,
  configured,
  selectedChannel: readFileSync(marker, "utf8").trim(),
  update,
  disabled,
}));
