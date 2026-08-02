const phase = Bun.env.MIGRATION_PHASE;
const { db, setSetting } = await import("../src/db");

if (phase === "seed") {
  const second = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES(?,?,?,?) RETURNING id")
    .get("Existing second", "#445566", 1, crypto.randomUUID()) as { id: number };
  db.prepare("INSERT INTO plugins(id,enabled,version) VALUES('downloads',1,'0.1.0') ON CONFLICT(id) DO UPDATE SET enabled=1").run();
  db.prepare("INSERT INTO plugin_settings(plugin_id,user_id,key,value) VALUES('downloads',?,'quality','480'),('downloads',?,'profile_enabled','0')").run(second.id, second.id);
  db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-legacy-dl','Legacy','')").run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('legacy-download','UC-legacy-dl','Legacy download','')").run();
  db.prepare("INSERT INTO downloads(video_id,status,source,pinned,requested_by_user_id) VALUES('legacy-download','done','manual',1,NULL)").run();
  db.prepare("DELETE FROM download_owners WHERE video_id='legacy-download'").run();
  db.prepare(`INSERT INTO download_rules(portable_uuid,user_id,name,source_mode,channel_ids_json)
    VALUES(?,NULL,'Legacy rule','selected','["UC-legacy-dl"]')`).run(crypto.randomUUID());
  setSetting("plugin_downloads_quality", "720");
  setSetting("plugin_downloads_retention_days", "21");
  setSetting("plugin_downloads_output_template", "legacy/{id}");
  setSetting("downloads_profile_ownership_migrated", "0");
  setSetting("downloads_profile_settings_migrated", "0");
  setSetting("downloads_profile_preferences_v2_migrated", "0");
  setSetting("downloads_profile_cookies_migrated", "0");
  await Bun.write(Bun.env.LEGACY_DOWNLOAD_COOKIES_FILE!, "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tlegacy");
  console.log("RESULT " + JSON.stringify({ secondId: second.id }));
} else if (phase === "audit") {
  await import("../src/plugins");
  const { migrateDownloadsFromPlugin } = await import("../src/downloadConfig");
  await migrateDownloadsFromPlugin();
  const { downloadCookiesConfigured, migrateLegacyDownloadCookies, removeDownloadCookies } = await import("../src/downloader");
  await migrateLegacyDownloadCookies();
  const owner = db.prepare("SELECT user_id,pinned FROM download_owners WHERE video_id='legacy-download'").get();
  const jobOwner = db.prepare("SELECT requested_by_user_id FROM downloads WHERE video_id='legacy-download'").get();
  const ruleOwner = db.prepare("SELECT user_id FROM download_rules WHERE name='Legacy rule'").get();
  const qualities = db.prepare("SELECT user_id,value FROM download_settings WHERE key='quality' ORDER BY user_id").all();
  const retentions = db.prepare("SELECT user_id,value FROM download_settings WHERE key='retention_days' ORDER BY user_id").all();
  const enabled = db.prepare("SELECT user_id,value FROM download_settings WHERE key='enabled' ORDER BY user_id").all();
  const outputTemplate = db.prepare("SELECT value FROM settings WHERE key='downloads_output_template'").get();
  const legacyRows = db.prepare("SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id='downloads'").get();
  const legacyPlugin = db.prepare("SELECT 1 FROM plugins WHERE id='downloads'").get();
  const cookiesConfigured = [downloadCookiesConfigured(1), downloadCookiesConfigured(2)];
  const legacyCookiesRemain = await Bun.file(Bun.env.LEGACY_DOWNLOAD_COOKIES_FILE!).exists();
  console.log("RESULT " + JSON.stringify({ owner, jobOwner, ruleOwner, qualities, retentions, enabled, outputTemplate, legacyRows, legacyPlugin, cookiesConfigured, legacyCookiesRemain }));
  db.prepare("DELETE FROM download_owners WHERE video_id='legacy-download'").run();
  removeDownloadCookies(2);
} else {
  const { migrateDownloadsFromPlugin } = await import("../src/downloadConfig");
  await migrateDownloadsFromPlugin();
  const { downloadCookiesConfigured, migrateLegacyDownloadCookies } = await import("../src/downloader");
  await migrateLegacyDownloadCookies();
  const ownerAfterRestart = db.prepare("SELECT user_id FROM download_owners WHERE video_id='legacy-download'").get();
  console.log("RESULT " + JSON.stringify({ ownerAfterRestart, cookiesConfigured: [downloadCookiesConfigured(1), downloadCookiesConfigured(2)] }));
}
db.close();
