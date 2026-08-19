import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_SHORTS_FEED_POLICY_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("Shorts feed policy suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/shortsFeedPolicy.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-shorts-feed-policy-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");

  const { db, setUserSetting } = await import("./db");
  const { appendShortsFeedVisibility, feedVisibilityWhere } = await import("./feedQuery");

  db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCselected','Selected',''),('UCdefault','Default','')").run();
  db.prepare("INSERT INTO user_channels(user_id,channel_id,followed,shorts_feed_visibility) VALUES(1,'UCselected',1,'show'),(1,'UCdefault',1,'default')").run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,is_short,published_at,is_unavailable) VALUES('regular','UCdefault','Regular',0,'2026-08-01',0),('deleted','UCdefault','Deleted',0,'2026-08-02',1),('selected-short','UCselected','Selected Short',1,'2026-08-03',0),('default-short','UCdefault','Default Short',1,'2026-08-04',0)").run();

  function visibleIds(): string[] {
    const where: string[] = ["COALESCE(v.is_unavailable, 0) = 0"];
    appendShortsFeedVisibility(where, 1);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return db.prepare(`SELECT video_id FROM videos v ${whereSql} ORDER BY video_id`).all()
      .map((row: any) => row.video_id);
  }

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("Shorts main-feed visibility", () => {
    test("hides unavailable tombstones from the main feed", async () => {
      await setUserSetting(1, "show_shorts", "1");
      const { where, params } = feedVisibilityWhere({}, 1);
      const ids = db.prepare(`SELECT v.video_id FROM videos v LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=1 WHERE ${where.join(" AND ")} ORDER BY v.video_id`)
        .all(...params).map((row: any) => row.video_id);
      expect(ids).toEqual(["default-short", "regular", "selected-short"]);
    });

    test("strictly hides every Short in mode 0", async () => {
      await setUserSetting(1, "show_shorts", "0");
      expect(visibleIds()).toEqual(["regular"]);
    });

    test("fully disabled mode also hides every Short", async () => {
      await setUserSetting(1, "show_shorts", "disabled");
      expect(visibleIds()).toEqual(["regular"]);
    });

    test("shows only opted-in channels in selected mode", async () => {
      await setUserSetting(1, "show_shorts", "selected");
      expect(visibleIds()).toEqual(["regular", "selected-short"]);
    });

    test("strictly shows every Short in mode 1", async () => {
      await setUserSetting(1, "show_shorts", "1");
      expect(visibleIds()).toEqual(["default-short", "regular", "selected-short"]);
    });
  });
}
