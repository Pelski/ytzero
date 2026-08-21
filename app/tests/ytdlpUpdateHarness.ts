import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  if [ -f '${root.replaceAll("'", "'\"'\"'")}/fail-update' ]; then
    echo "network unavailable" >&2
    exit 1
  fi
  echo "$2" > '${shellMarker}'
  echo "Updated yt-dlp to $2"
  exit 0
fi
exit 2
`);
chmodSync(executable, 0o755);

const { setYtdlpUpdateConfig, ytdlpSelfUpdate, ytdlpUpdateChannel, ytdlpUpdateIntervalDays, ytdlpProvisionReconciliationPending } = await import("../src/ytdlpUpdater");
const defaults = { channel: ytdlpUpdateChannel(), interval: ytdlpUpdateIntervalDays() };
await setYtdlpUpdateConfig("stable", 3);
const configured = { channel: ytdlpUpdateChannel(), interval: ytdlpUpdateIntervalDays() };
const update = await ytdlpSelfUpdate({ force: true });
const selectedChannel = readFileSync(marker, "utf8").trim();
await setYtdlpUpdateConfig("nightly", 0);
const disabled = await ytdlpSelfUpdate();
const reconciliationMarker = process.env.YTDLP_PROVISION_MARKER!;
writeFileSync(reconciliationMarker, "");
writeFileSync(join(root, "fail-update"), "");
let failedReconciliation = false;
try {
  await ytdlpSelfUpdate();
} catch {
  failedReconciliation = ytdlpProvisionReconciliationPending();
}
unlinkSync(join(root, "fail-update"));
const reconciled = await ytdlpSelfUpdate();

console.log("RESULT " + JSON.stringify({
  defaults,
  configured,
  selectedChannel,
  update,
  disabled,
  failedReconciliation,
  reconciled,
  reconciliationMarkerExists: existsSync(reconciliationMarker),
}));
