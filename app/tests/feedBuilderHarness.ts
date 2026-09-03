const { api } = await import("../src/routes");
const { db } = await import("../src/db");

db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-feed-builder','Builder channel','https://youtube.com/channel/UC-feed-builder')").run();
db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UC-feed-builder',1)").run();
const tagUuid = crypto.randomUUID();
const tag = db.prepare("INSERT INTO tags(name,color,filter_only,user_id,portable_uuid) VALUES('Builder tag','#3366ff',0,1,?) RETURNING id").get(tagUuid) as { id: number };
const shortTagUuid = crypto.randomUUID();
const shortTag = db.prepare("INSERT INTO tags(name,color,filter_only,user_id,portable_uuid) VALUES('Short recipe','#ff6633',0,1,?) RETURNING id").get(shortTagUuid) as { id: number };
for (let index = 1; index <= 45; index++) {
  const id = `builder${String(index).padStart(4, "0")}`;
  const date = new Date(Date.UTC(2026, 7, index, 12)).toISOString();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,published_at) VALUES(?,?,?,?)").run(id, "UC-feed-builder", `Video ${index}`, date);
  if (index <= 12) db.prepare("INSERT INTO video_tags(video_id,tag_id,source) VALUES(?,?,'manual')").run(id, tag.id);
  if (index === 1) db.prepare("INSERT INTO video_tags(video_id,tag_id,source) VALUES(?,?,'manual')").run(id, shortTag.id);
}
db.prepare("INSERT INTO user_videos(user_id,video_id,status,watch_position,watch_duration) VALUES(1,'builder0045','inbox',30,300)").run();
db.prepare("INSERT INTO history(user_id,video_id,watched_at) VALUES(1,'builder0045','2026-09-03 10:00:00')").run();

const request = (path: string, method = "GET", body?: unknown) => api.request(`http://localhost${path}`, {
  method,
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const initial = await (await request("/feed-builder")).json() as any;
const recipe = {
  id: crypto.randomUUID(), name: "Builder picks", enabled: true, sourceMode: "selected", match: "any",
  include: { channelIds: [], tagUuids: [tagUuid], youtubePlaylistIds: [], userPlaylistUuids: [] },
  exclude: { channelIds: [], tagUuids: [], youtubePlaylistIds: [], userPlaylistUuids: [] },
  maxAgeDays: 183, hiddenTags: "exclude", shorts: "inherit", live: "inherit", membersOnly: "inherit", order: "feed",
};
const incompleteRecipe = { ...recipe, id: crypto.randomUUID(), name: "Too short", include: { ...recipe.include, tagUuids: [shortTagUuid] } };
const config = {
  ...initial.config,
  mode: "composed",
  intervalRows: 2,
  sections: { continueWatching: { visible: true, afterStandardRows: 1 }, scheduled: { visible: false, afterStandardRows: 0 } },
  recipes: [incompleteRecipe, recipe],
};
const saveResponse = await request("/feed-builder", "PUT", { expectedRevision: initial.config.revision, config });
const saved = await saveResponse.json() as any;
const conflictResponse = await request("/feed-builder", "PUT", { expectedRevision: initial.config.revision, config });
const preview = await (await request("/feed-builder/preview", "POST", { recipe, columns: 12 })).json() as any;
const options = await (await request("/feed-builder/options")).json() as any;
const firstResponse = await request("/feed/compositions", "POST", { columns: 3, tags: [], showAll: false, sort: "published", seed: "stable-seed" });
const first = await firstResponse.json() as any;
const secondResponse = await request(`/feed/compositions/${first.compositionId}/pages`, "POST", { pageIndex: 1 });
const second = await secondResponse.json() as any;
const repeat = await (await request(`/feed/compositions/${first.compositionId}/pages`, "POST", { pageIndex: 1 })).json() as any;
const nullPreviewResponse = await request("/feed-builder/preview", "POST", null);
const nullCompositionResponse = await request("/feed/compositions", "POST", null);
const nullPageResponse = await request(`/feed/compositions/${first.compositionId}/pages`, "POST", null);
const allBlocks = [...first.blocks, ...second.blocks];
const ids = allBlocks.flatMap((block: any) => block.videos.map((video: any) => video.video_id));

console.log("RESULT " + JSON.stringify({
  defaultMode: initial.config.mode,
  saveStatus: saveResponse.status,
  savedRevision: saved.config.revision,
  conflictStatus: conflictResponse.status,
  optionHasTag: options.tags.some((item: any) => item.id === tagUuid),
  previewCount: preview.count,
  previewCanFill: preview.canFillRow,
  firstTypes: first.blocks.map((block: any) => block.type),
  firstRowLengths: first.blocks.filter((block: any) => block.type === "standard-row" || block.type === "recipe-row").map((block: any) => block.videos.length),
  firstRecipeTitle: first.blocks.find((block: any) => block.type === "recipe-row")?.title,
  continueId: first.blocks.find((block: any) => block.type === "continue")?.videos[0]?.video_id,
  uniqueAcrossPages: new Set(ids).size === ids.length,
  secondStatus: secondResponse.status,
  idempotentSecond: JSON.stringify(second) === JSON.stringify(repeat),
  nullBodyStatuses: [nullPreviewResponse.status, nullCompositionResponse.status, nullPageResponse.status],
  stableSeed: first.seed,
}));

db.close();
