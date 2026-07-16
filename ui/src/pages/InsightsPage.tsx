import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Clock3, FastForward, Film, Flame, Play, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type HouseholdInsights, type InsightProfileRef } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";

const RANGES = [7, 30, 90, 365];

function formatDuration(seconds: number, locale: string) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds / 3600)} h`;
}

function ProfileAvatar({ profile, small = false }: { profile: InsightProfileRef; small?: boolean }) {
  return profile.avatar ? (
    <img className={`insights-avatar${small ? " is-small" : ""}`} src={profile.avatar} alt="" />
  ) : (
    <span className={`insights-avatar insights-avatar-fallback${small ? " is-small" : ""}`} style={{ background: profile.avatar_color }}>
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function InsightsPage() {
  const { t, locale } = useI18n();
  const [days, setDays] = useState(30);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [data, setData] = useState<HouseholdInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api.insights(days, profileId)
      .then((result) => { if (alive) setData(result); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days, profileId]);

  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, 1 + index);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  }), [locale]);

  if (!data && loading) return <div className="insights-loading"><Activity className="spin" /> {t("loading")}</div>;
  if (!data) return <div className="empty-state">{error || t("insightsNoData")}</div>;

  const { summary } = data;
  const maxDay = Math.max(...data.daily.map((item) => item.seconds), 1);
  const maxHour = Math.max(...data.hours.map((item) => item.seconds), 1);
  const maxHeat = Math.max(...data.heatmap.flatMap((day) => day.hours.map((hour) => hour.seconds)), 1);
  const maxChannel = Math.max(data.channels[0]?.seconds ?? 0, 1);
  const maxTag = Math.max(data.tags[0]?.seconds ?? 0, 1);
  const contentTotal = data.content.reduce((sum, item) => sum + item.seconds, 0);
  const regular = data.content.find((item) => item.key === "regular")?.seconds ?? 0;
  const shorts = data.content.find((item) => item.key === "shorts")?.seconds ?? 0;
  const donut = contentTotal ? `${regular / contentTotal * 360}deg ${shorts / contentTotal * 360}deg` : "0deg 0deg";
  const change = summary.change_percent;
  const rangeLabels: Record<number, string> = { 7: t("insightsRange7"), 30: t("insightsRange30"), 90: t("insightsRange90"), 365: t("insightsRange365") };
  const periodLabels: Record<string, string> = {
    night: t("insightsNight"), morning: t("insightsMorning"), afternoon: t("insightsAfternoon"), evening: t("insightsEvening"),
  };
  const contentLabels: Record<string, string> = { regular: t("insightsRegular"), shorts: "Shorts", live: "Live" };

  return (
    <div className="insights-page">
      <header className="insights-hero">
        <div>
          <span className="insights-eyebrow"><Activity size={15} /> {t("insightsEyebrow")}</span>
          <h1>{t("insightsTitle")}</h1>
          <p>{t("insightsSubtitle")}</p>
        </div>
        <div className="insights-filters">
          <label>
            <span>{t("insightsView")}</span>
            <select value={profileId ?? "all"} onChange={(event) => setProfileId(event.target.value === "all" ? null : Number(event.target.value))}>
              <option value="all">{t("insightsHousehold")}</option>
              {data.available_profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <div className="insights-range" aria-label={t("insightsPeriod")}>{RANGES.map((value) => (
            <button className={days === value ? "active" : ""} key={value} onClick={() => setDays(value)}>{rangeLabels[value]}</button>
          ))}</div>
        </div>
      </header>

      {summary.total_seconds === 0 ? (
        <div className="insights-empty"><Play size={34} /><h2>{t("insightsNoData")}</h2><p>{t("insightsNoDataHint")}</p></div>
      ) : <>
        <section className="insights-summary">
          <article><Clock3 /><span>{t("insightsTotalTime")}</span><strong>{formatDuration(summary.total_seconds, locale)}</strong>
            {change != null && <small className={change > 0 ? "up" : change < 0 ? "down" : ""}>{change > 0 ? <TrendingUp /> : change < 0 ? <TrendingDown /> : null}{change > 0 ? "+" : ""}{change}% {t("insightsVsPrevious")}</small>}
          </article>
          <article><Activity /><span>{t("insightsDailyAverage")}</span><strong>{formatDuration(summary.daily_average_seconds, locale)}</strong></article>
          <article><Film /><span>{t("insightsVideos")}</span><strong>{summary.video_count}</strong></article>
          <article><CalendarDays /><span>{t("insightsActiveDays")}</span><strong>{summary.active_days}<small> / {days}</small></strong></article>
          <article><Flame /><span>{t("insightsStreak")}</span><strong>{summary.streak_days}</strong><small>{t("insightsDays")}</small></article>
          <article><FastForward /><span>{t("insightsSponsorSaved")}</span><strong>{formatDuration(summary.sponsorblock_saved_seconds, locale)}</strong><small>SponsorBlock</small></article>
        </section>

        <section className="insights-grid insights-grid-top">
          <article className="insights-card insights-trend-card">
            <div className="insights-card-head"><div><h2>{t("insightsDailyTrend")}</h2><p>{t("insightsDailyTrendHint")}</p></div></div>
            <div className="insights-daily-chart">
              {data.daily.map((item, index) => <div className="insights-daily-column" key={item.day} title={`${item.day}: ${formatDuration(item.seconds, locale)}`}>
                <span style={{ height: `${Math.max(item.seconds / maxDay * 100, item.seconds ? 4 : 0)}%` }} />
                {(index === 0 || index === data.daily.length - 1) && <em>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${item.day}T12:00:00`))}</em>}
              </div>)}
            </div>
          </article>

          <article className="insights-card insights-content-card">
            <div className="insights-card-head"><div><h2>{t("insightsContentMix")}</h2><p>{t("insightsContentMixHint")}</p></div></div>
            <div className="insights-content-body">
              <div className="insights-donut" style={{ background: `conic-gradient(#7c5cff 0 ${donut.split(" ")[0]}, #36c5f0 ${donut.split(" ")[0]} ${donut.split(" ")[1]}, #ff4d6d ${donut.split(" ")[1]} 360deg)` }}><span>{formatDuration(contentTotal, locale)}</span></div>
              <div className="insights-legend">{data.content.map((item) => <div key={item.key}><i className={`is-${item.key}`} /><span>{contentLabels[item.key]}</span><strong>{contentTotal ? Math.round(item.seconds / contentTotal * 100) : 0}%</strong></div>)}</div>
            </div>
          </article>
        </section>

        <section className="insights-card insights-rhythm">
          <div className="insights-card-head"><div><h2>{t("insightsRhythm")}</h2><p>{t("insightsRhythmHint")}</p></div><strong>{summary.favorite_hour != null ? t("insightsPeakAt", { hour: String(summary.favorite_hour).padStart(2, "0") }) : ""}</strong></div>
          <div className="insights-hour-chart">{data.hours.map((item) => <div key={item.hour} title={`${String(item.hour).padStart(2, "0")}:00 · ${formatDuration(item.seconds, locale)}`}><span style={{ height: `${Math.max(item.seconds / maxHour * 100, item.seconds ? 5 : 0)}%` }} />{item.hour % 3 === 0 && <em>{String(item.hour).padStart(2, "0")}</em>}</div>)}</div>
          <div className="insights-heatmap-wrap">
            <div className="insights-heatmap">
              {data.heatmap.map((day) => <div className="insights-heat-row" key={day.weekday}><strong>{weekdayLabels[day.weekday]}</strong>{day.hours.map((hour) => {
                const ratio = hour.seconds / maxHeat;
                return <span key={hour.hour} title={`${weekdayLabels[day.weekday]} ${String(hour.hour).padStart(2, "0")}:00 · ${formatDuration(hour.seconds, locale)}`} style={{ background: `rgba(124, 92, 255, ${hour.seconds ? .14 + ratio * .86 : .045})` }} />;
              })}</div>)}
            </div>
          </div>
          <div className="insights-dayparts">{data.time_of_day.map((item) => <div key={item.key}><span>{periodLabels[item.key]}</span><strong>{formatDuration(item.seconds, locale)}</strong><i><b style={{ width: `${item.seconds / summary.total_seconds * 100}%` }} /></i></div>)}</div>
        </section>

        <section className="insights-card">
          <div className="insights-card-head"><div><h2>{t("insightsProfiles")}</h2><p>{t("insightsProfilesHint")}</p></div><Users /></div>
          <div className="insights-profiles">{data.profiles.map((profile) => <article key={profile.id}>
            <div className="insights-profile-title"><ProfileAvatar profile={profile} /><div><h3>{profile.name}</h3><span>{Math.round(profile.share * 100)}% {t("insightsHouseholdShare")}</span></div><strong>{formatDuration(profile.seconds, locale)}</strong></div>
            <div className="insights-profile-favorites"><span>{t("insightsFavoriteChannel")}<b>{profile.top_channel?.title || "—"}</b></span><span>{t("insightsFavoriteTag")}<b>{profile.top_tag?.name || "—"}</b></span></div>
          </article>)}</div>
        </section>

        <section className="insights-grid insights-rankings">
          <article className="insights-card">
            <div className="insights-card-head"><div><h2>{t("insightsTopChannels")}</h2><p>{t("insightsTopChannelsHint")}</p></div></div>
            <div className="insights-ranking-list">{data.channels.slice(0, 10).map((channel, index) => <div className="insights-ranking" key={channel.channel_id}>
              <span className="insights-rank">{index + 1}</span>{channel.thumbnail ? <img src={img(channel.thumbnail)} alt="" /> : <span className="insights-channel-placeholder" />}
              <div className="insights-ranking-main"><div><Link to={`/channel/${channel.channel_id}`}>{channel.title}</Link><span>{channel.video_count} {t("insightsVideosShort")}</span></div><i><b style={{ width: `${channel.seconds / maxChannel * 100}%` }} /></i></div>
              <strong>{formatDuration(channel.seconds, locale)}</strong>
            </div>)}</div>
          </article>

          <article className="insights-card">
            <div className="insights-card-head"><div><h2>{t("insightsTopTags")}</h2><p>{t("insightsTopTagsHint")}</p></div></div>
            <div className="insights-ranking-list">{data.tags.slice(0, 10).map((tag, index) => <div className="insights-ranking insights-tag-ranking" key={tag.name}>
              <span className="insights-rank">{index + 1}</span><span className="insights-tag-dot" />
              <div className="insights-ranking-main"><div><b>{tag.name}</b><span>{tag.profile_count} {t("insightsProfilesShort")}</span></div><i><b style={{ width: `${tag.seconds / maxTag * 100}%` }} /></i></div>
              <strong>{formatDuration(tag.seconds, locale)}</strong>
            </div>)}</div>
            <p className="insights-footnote">{t("insightsTagOverlapHint")}</p>
          </article>
        </section>

        <section className="insights-card">
          <div className="insights-card-head"><div><h2>{t("insightsTopVideos")}</h2><p>{t("insightsTopVideosHint")}</p></div></div>
          <div className="insights-videos">{data.videos.map((video, index) => <Link to={`/watch/${video.video_id}`} key={video.video_id}>
            <span className="insights-video-rank">{index + 1}</span><img src={img(video.thumbnail)} alt="" /><div><strong>{video.title}</strong><span>{video.channel_title} · {video.profile_count} {t("insightsProfilesShort")}</span></div><b>{formatDuration(video.seconds, locale)}</b>
          </Link>)}</div>
        </section>
      </>}
    </div>
  );
}
