import { db } from "./db";

export const INSIGHT_RANGES = [7, 30, 90, 365] as const;

type WatchRow = {
  user_id: number;
  video_id: string;
  day: string;
  hour: number;
  seconds: number;
  video_title: string;
  video_thumbnail: string;
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string;
  is_short: number | null;
  live_status: string;
};

type UserRow = {
  id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  is_child: number;
};

type TagRow = {
  user_id: number;
  key: string;
  name: string;
  color: string;
  seconds: number;
  video_count: number;
};

type TagHourRow = {
  user_id: number;
  key: string;
  name: string;
  hour: number;
  seconds: number;
};

const round = (value: number) => Math.round(value);

function localDay(offsetDays = 0): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function weekdayIndex(day: string): number {
  const date = new Date(`${day}T12:00:00`);
  return (date.getDay() + 6) % 7; // Monday = 0
}

function addToMap<K>(map: Map<K, number>, key: K, seconds: number) {
  map.set(key, (map.get(key) ?? 0) + seconds);
}

export function buildHouseholdInsights(days: number, profileId: number | null) {
  if (!INSIGHT_RANGES.includes(days as (typeof INSIGHT_RANGES)[number])) days = 30;
  const users = db.prepare(
    "SELECT id, name, avatar, avatar_color, is_child FROM users ORDER BY sort_order ASC, id ASC"
  ).all() as UserRow[];
  if (profileId != null && !users.some((user) => user.id === profileId)) throw new Error("profile not found");

  const modifier = `-${days - 1} days`;
  const scopeSql = profileId == null ? "" : " AND w.user_id = ?";
  const params = profileId == null ? [modifier] : [modifier, profileId];
  const rows = db.prepare(`
    SELECT w.user_id, w.video_id, w.day, w.hour, w.seconds,
           v.title AS video_title, v.thumbnail AS video_thumbnail,
           v.channel_id, v.is_short, v.live_status,
           c.title AS channel_title, c.thumbnail AS channel_thumbnail
    FROM watch_time_log w
    JOIN videos v ON v.video_id = w.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE w.day >= date('now', 'localtime', ?)${scopeSql}
  `).all(...params) as WatchRow[];

  const previousStart = `-${days * 2 - 1} days`;
  const previousEnd = `-${days - 1} days`;
  const previousParams = profileId == null
    ? [previousStart, previousEnd]
    : [previousStart, previousEnd, profileId];
  const previous = db.prepare(`
    SELECT COALESCE(SUM(w.seconds), 0) AS seconds
    FROM watch_time_log w
    WHERE w.day >= date('now', 'localtime', ?)
      AND w.day < date('now', 'localtime', ?)${scopeSql}
  `).get(...previousParams) as { seconds: number };

  const tagRows = db.prepare(`
    SELECT w.user_id, lower(t.name) AS key, t.name, t.color,
           SUM(w.seconds) AS seconds, COUNT(DISTINCT w.video_id) AS video_count
    FROM watch_time_log w
    JOIN video_tags vt ON vt.video_id = w.video_id
    JOIN tags t ON t.id = vt.tag_id AND t.user_id = w.user_id
    WHERE w.day >= date('now', 'localtime', ?)${scopeSql}
    GROUP BY w.user_id, lower(t.name)
  `).all(...params) as TagRow[];

  const tagHourRows = db.prepare(`
    SELECT w.user_id, lower(t.name) AS key, t.name, w.hour,
           SUM(w.seconds) AS seconds
    FROM watch_time_log w
    JOIN video_tags vt ON vt.video_id = w.video_id
    JOIN tags t ON t.id = vt.tag_id AND t.user_id = w.user_id
    WHERE w.day >= date('now', 'localtime', ?)${scopeSql}
    GROUP BY w.user_id, lower(t.name), w.hour
  `).all(...params) as TagHourRow[];

  const totalSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  const daysMap = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 }));
  const heatmap = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 })),
  }));
  const timeOfDay = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  const content = { regular: 0, shorts: 0, live: 0 };
  const profileSeconds = new Map<number, number>();
  const profileVideos = new Map<number, Set<string>>();
  const profileChannels = new Map<number, Map<string, number>>();
  const channelMap = new Map<string, {
    channel_id: string; title: string; thumbnail: string; seconds: number;
    videos: Set<string>; profiles: Map<number, number>;
  }>();
  const videoMap = new Map<string, {
    video_id: string; title: string; thumbnail: string; channel_id: string;
    channel_title: string; seconds: number; profiles: Set<number>;
  }>();

  for (const row of rows) {
    addToMap(daysMap, row.day, row.seconds);
    hours[row.hour].seconds += row.seconds;
    heatmap[weekdayIndex(row.day)].hours[row.hour].seconds += row.seconds;
    if (row.hour < 5) timeOfDay.night += row.seconds;
    else if (row.hour < 12) timeOfDay.morning += row.seconds;
    else if (row.hour < 17) timeOfDay.afternoon += row.seconds;
    else timeOfDay.evening += row.seconds;

    if (row.live_status !== "none") content.live += row.seconds;
    else if (row.is_short === 1) content.shorts += row.seconds;
    else content.regular += row.seconds;

    addToMap(profileSeconds, row.user_id, row.seconds);
    if (!profileVideos.has(row.user_id)) profileVideos.set(row.user_id, new Set());
    profileVideos.get(row.user_id)!.add(row.video_id);
    if (!profileChannels.has(row.user_id)) profileChannels.set(row.user_id, new Map());
    addToMap(profileChannels.get(row.user_id)!, row.channel_id, row.seconds);

    let channel = channelMap.get(row.channel_id);
    if (!channel) {
      channel = {
        channel_id: row.channel_id, title: row.channel_title, thumbnail: row.channel_thumbnail,
        seconds: 0, videos: new Set(), profiles: new Map(),
      };
      channelMap.set(row.channel_id, channel);
    }
    channel.seconds += row.seconds;
    channel.videos.add(row.video_id);
    addToMap(channel.profiles, row.user_id, row.seconds);

    let video = videoMap.get(row.video_id);
    if (!video) {
      video = {
        video_id: row.video_id, title: row.video_title, thumbnail: row.video_thumbnail,
        channel_id: row.channel_id, channel_title: row.channel_title, seconds: 0, profiles: new Set(),
      };
      videoMap.set(row.video_id, video);
    }
    video.seconds += row.seconds;
    video.profiles.add(row.user_id);
  }

  const tagMap = new Map<string, { name: string; color: string; seconds: number; video_count: number; profiles: Map<number, number> }>();
  const profileTags = new Map<number, TagRow[]>();
  for (const tag of tagRows) {
    if (!profileTags.has(tag.user_id)) profileTags.set(tag.user_id, []);
    profileTags.get(tag.user_id)!.push(tag);
    let aggregate = tagMap.get(tag.key);
    if (!aggregate) {
      aggregate = { name: tag.name, color: tag.color, seconds: 0, video_count: 0, profiles: new Map() };
      tagMap.set(tag.key, aggregate);
    }
    aggregate.seconds += tag.seconds;
    aggregate.video_count += tag.video_count;
    addToMap(aggregate.profiles, tag.user_id, tag.seconds);
  }

  const channels = [...channelMap.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 15)
    .map((channel) => ({
      channel_id: channel.channel_id,
      title: channel.title,
      thumbnail: channel.thumbnail,
      seconds: round(channel.seconds),
      video_count: channel.videos.size,
      profile_count: channel.profiles.size,
      profiles: [...channel.profiles.entries()]
        .map(([user_id, seconds]) => ({ user_id, seconds: round(seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
    }));

  const tags = [...tagMap.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 15)
    .map((tag) => ({
      name: tag.name,
      color: tag.color,
      seconds: round(tag.seconds),
      video_count: tag.video_count,
      profile_count: tag.profiles.size,
      profiles: [...tag.profiles.entries()]
        .map(([user_id, seconds]) => ({ user_id, seconds: round(seconds) }))
        .sort((a, b) => b.seconds - a.seconds),
    }));

  const profileBreakdown = users
    .filter((user) => profileId == null || user.id === profileId)
    .map((user) => {
      const channelEntries = [...(profileChannels.get(user.id)?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
      const topChannelId = channelEntries[0]?.[0];
      const topTag = [...(profileTags.get(user.id) ?? [])].sort((a, b) => b.seconds - a.seconds)[0];
      return {
        id: user.id,
        name: user.name,
        avatar: user.avatar ? `/api/profiles/${user.id}/avatar?v=${encodeURIComponent(user.avatar)}` : "",
        avatar_color: user.avatar_color,
        is_child: user.is_child === 1,
        seconds: round(profileSeconds.get(user.id) ?? 0),
        video_count: profileVideos.get(user.id)?.size ?? 0,
        share: totalSeconds > 0 ? (profileSeconds.get(user.id) ?? 0) / totalSeconds : 0,
        top_channel: topChannelId ? {
          channel_id: topChannelId,
          title: channelMap.get(topChannelId)?.title ?? "",
          seconds: round(channelEntries[0][1]),
        } : null,
        top_tag: topTag ? { name: topTag.name, color: topTag.color, seconds: round(topTag.seconds) } : null,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const daily = Array.from({ length: days }, (_, index) => {
    const day = localDay(index - days + 1);
    return { day, seconds: round(daysMap.get(day) ?? 0) };
  });
  const activeDaySet = new Set([...daysMap.entries()].filter(([, seconds]) => seconds > 0).map(([day]) => day));
  let streakDays = 0;
  const today = localDay();
  const yesterday = localDay(-1);
  let cursorOffset = activeDaySet.has(today) ? 0 : activeDaySet.has(yesterday) ? -1 : Number.NaN;
  while (Number.isFinite(cursorOffset) && activeDaySet.has(localDay(cursorOffset))) {
    streakDays += 1;
    cursorOffset -= 1;
  }

  const favoriteHour = hours.reduce((best, item) => item.seconds > best.seconds ? item : best, hours[0]);
  const weekdayTotals = heatmap.map((day) => ({
    weekday: day.weekday,
    seconds: day.hours.reduce((sum, hour) => sum + hour.seconds, 0),
  }));
  const favoriteWeekday = weekdayTotals.reduce((best, item) => item.seconds > best.seconds ? item : best, weekdayTotals[0]);
  const previousSeconds = previous.seconds ?? 0;
  const sponsorParams = profileId == null ? [modifier] : [modifier, profileId];
  const sponsorSaved = db.prepare(`
    SELECT COALESCE(SUM(skipped_seconds), 0) AS seconds
    FROM sponsorblock_skip_log
    WHERE day >= date('now', 'localtime', ?)${profileId == null ? "" : " AND user_id = ?"}
  `).get(...sponsorParams) as { seconds: number };

  const tagRhythmMap = new Map<number, Map<string, { name: string; hours: number[] }>>();
  for (const row of tagHourRows) {
    if (!tagRhythmMap.has(row.user_id)) tagRhythmMap.set(row.user_id, new Map());
    const profileTags = tagRhythmMap.get(row.user_id)!;
    if (!profileTags.has(row.key)) profileTags.set(row.key, { name: row.name, hours: Array(24).fill(0) });
    profileTags.get(row.key)!.hours[row.hour] += row.seconds;
  }

  const tagRhythms = profileBreakdown.map((profile) => ({
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    avatar_color: profile.avatar_color,
    is_child: profile.is_child,
    tags: [...(tagRhythmMap.get(profile.id)?.values() ?? [])]
      .map((tag) => {
        const seconds = tag.hours.reduce((sum, value) => sum + value, 0);
        const peakHour = tag.hours.reduce((best, value, hour) => value > tag.hours[best] ? hour : best, 0);
        return {
          name: tag.name,
          seconds: round(seconds),
          peak_hour: seconds > 0 ? peakHour : null,
          hours: tag.hours.map((value, hour) => ({ hour, seconds: round(value) })),
        };
      })
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 8),
  }));

  return {
    range: { days, from: daily[0].day, to: daily[daily.length - 1].day },
    scope: { profile_id: profileId },
    available_profiles: users.map((user) => ({
      id: user.id,
      name: user.name,
      avatar: user.avatar ? `/api/profiles/${user.id}/avatar?v=${encodeURIComponent(user.avatar)}` : "",
      avatar_color: user.avatar_color,
      is_child: user.is_child === 1,
    })),
    summary: {
      total_seconds: round(totalSeconds),
      daily_average_seconds: round(totalSeconds / days),
      video_count: new Set(rows.map((row) => row.video_id)).size,
      active_days: activeDaySet.size,
      active_profiles: new Set(rows.map((row) => row.user_id)).size,
      streak_days: streakDays,
      previous_seconds: round(previousSeconds),
      change_percent: previousSeconds > 0 ? Math.round(((totalSeconds - previousSeconds) / previousSeconds) * 100) : null,
      favorite_hour: totalSeconds > 0 ? favoriteHour.hour : null,
      favorite_weekday: totalSeconds > 0 ? favoriteWeekday.weekday : null,
      sponsorblock_saved_seconds: round(sponsorSaved.seconds ?? 0),
    },
    daily,
    hours: hours.map((item) => ({ ...item, seconds: round(item.seconds) })),
    heatmap: heatmap.map((day) => ({
      weekday: day.weekday,
      hours: day.hours.map((hour) => ({ ...hour, seconds: round(hour.seconds) })),
    })),
    time_of_day: Object.entries(timeOfDay).map(([key, seconds]) => ({ key, seconds: round(seconds) })),
    content: Object.entries(content).map(([key, seconds]) => ({ key, seconds: round(seconds) })),
    profiles: profileBreakdown,
    channels,
    tags,
    tag_rhythms: tagRhythms,
    videos: [...videoMap.values()]
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10)
      .map((video) => ({
        video_id: video.video_id,
        title: video.title,
        thumbnail: video.thumbnail,
        channel_id: video.channel_id,
        channel_title: video.channel_title,
        seconds: round(video.seconds),
        profile_count: video.profiles.size,
      })),
  };
}
