const { api } = await import("../src/routes");
const { db } = await import("../src/db");

const secondary = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Secondary", "#7c5cff", 1, crypto.randomUUID()) as { id: number };

async function request(profileId: number, path: string, method = "GET", body?: unknown, extraCookie = "") {
  const cookie = [`ytzero_profile=${profileId}`, extraCookie].filter(Boolean).join("; ");
  return api.request(`http://localhost${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const enableResponse = await request(1, "/child-lock/enable", "POST", { pin: "123456" });
const adminStatus = await (await request(1, "/child-lock")).json() as any;
const secondaryStatus = await (await request(secondary.id, "/child-lock")).json() as any;
const defaultPermissions = await (await request(secondary.id, "/profile-permissions")).json() as any;

const adminSettings = await request(1, "/settings", "PUT", { show_shorts: "1" });
const restrictedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "1" });
const defaultTag = await request(secondary.id, "/tags", "POST", { name: "Allowed", color: "#123456" });
const defaultFilter = await request(secondary.id, "/filter-rules", "POST", { pattern: "spoiler", match_type: "contains", field: "title", action: "reject" });
const restrictedImport = await request(secondary.id, "/import/analyze", "POST", {});

const unlockResponse = await request(secondary.id, "/child-lock/unlock", "POST", { pin: "123456" });
const unlockCookie = (unlockResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];
const restrictedAfterPin = await request(secondary.id, "/settings", "PUT", { show_shorts: "1" }, unlockCookie);

const policyResponse = await request(1, "/profile-permissions", "PUT", { admin_only_areas: ["filters", "playlists", "followed_playlists", "playback"] });
const policy = await policyResponse.json() as any;
const pinLockedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "0" });
const delegatedSettings = await request(secondary.id, "/settings", "PUT", { show_shorts: "0" }, unlockCookie);
const restrictedPlayback = await request(secondary.id, "/settings", "PUT", { player_speed: "1.5" }, unlockCookie);
const restrictedPlaylist = await request(secondary.id, "/playlists", "POST", { name: "Blocked" }, unlockCookie);
const restrictedFollowedPlaylist = await request(secondary.id, "/channel-playlists/PLblocked/follow", "PUT", { followed: true }, unlockCookie);
const restrictedFilter = await request(secondary.id, "/filter-rules", "POST", { pattern: "blocked", match_type: "contains", field: "title", action: "reject" }, unlockCookie);
const delegatedProfile = await request(secondary.id, `/profiles/${secondary.id}`, "PATCH", { name: "Renamed" }, unlockCookie);
const forbiddenPolicy = await request(secondary.id, "/profile-permissions", "PUT", { admin_only_areas: [] }, unlockCookie);

const forbiddenLogs = await request(secondary.id, "/logs");
const forbiddenExternal = await request(secondary.id, "/external");
const forbiddenVersion = await request(secondary.id, "/version");
const forbiddenUpdateCheck = await request(secondary.id, "/updates/check", "POST", {});
const forbiddenUpdateInterval = await request(secondary.id, "/settings", "PUT", { update_check_interval: "daily" }, unlockCookie);
const forbiddenBackup = await request(secondary.id, "/backup/options");
const adminLogs = await request(1, "/logs");
const changedPin = await request(1, "/child-lock/change-pin", "POST", { new_pin: "654321" });
const disabled = await request(1, "/child-lock/disable", "POST", {});

console.log("RESULT " + JSON.stringify({
  enableStatus: enableResponse.status,
  adminLocked: adminStatus.child_lock.locked,
  secondaryLocked: secondaryStatus.child_lock.locked,
  defaultAreas: defaultPermissions.permissions.admin_only_areas,
  adminSettingsStatus: adminSettings.status,
  restrictedSettingsStatus: restrictedSettings.status,
  defaultTagStatus: defaultTag.status,
  defaultFilterStatus: defaultFilter.status,
  restrictedImportStatus: restrictedImport.status,
  unlockStatus: unlockResponse.status,
  restrictedAfterPinStatus: restrictedAfterPin.status,
  policyStatus: policyResponse.status,
  policyAreas: policy.permissions.admin_only_areas,
  pinLockedSettingsStatus: pinLockedSettings.status,
  delegatedSettingsStatus: delegatedSettings.status,
  restrictedPlaybackStatus: restrictedPlayback.status,
  restrictedPlaylistStatus: restrictedPlaylist.status,
  restrictedFollowedPlaylistStatus: restrictedFollowedPlaylist.status,
  restrictedFilterStatus: restrictedFilter.status,
  delegatedProfileStatus: delegatedProfile.status,
  forbiddenPolicyStatus: forbiddenPolicy.status,
  forbiddenLogsStatus: forbiddenLogs.status,
  forbiddenExternalStatus: forbiddenExternal.status,
  forbiddenVersionStatus: forbiddenVersion.status,
  forbiddenUpdateCheckStatus: forbiddenUpdateCheck.status,
  forbiddenUpdateIntervalStatus: forbiddenUpdateInterval.status,
  forbiddenBackupStatus: forbiddenBackup.status,
  adminLogsStatus: adminLogs.status,
  changedPinStatus: changedPin.status,
  disabledStatus: disabled.status,
}));

db.close();
