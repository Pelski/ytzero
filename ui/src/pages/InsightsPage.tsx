import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, CheckCircle2, Clock3, Compass, FastForward, Film, Flame, Play, Repeat2, Tags, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api, SB_CATEGORIES, type HouseholdInsights, type InsightProfileRef } from "../api";
import { img } from "../img";
import { useI18n } from "../i18n";
import { EmptyState } from "../components/ui";

const RANGES = [7, 30, 90, 365];

function formatDuration(seconds: number, locale: string) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds / 3600)} h`;
}

function formatAxisDuration(seconds: number, locale: string) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds / 3600)} h`;
}

function TimeAxis({ max, locale }: { max: number; locale: string }) {
  return <div className="insights-chart-y-axis" aria-hidden="true">
    {[1, .75, .5, .25, 0].map((part) => <span key={part}>{formatAxisDuration(max * part, locale)}</span>)}
  </div>;
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

type InsightMiniItem = {
  key: string;
  title: string;
  meta: string;
  value: string;
  href?: string;
  thumbnail?: string;
  color?: string;
  progress?: number;
};

function InsightMiniList({ title, items, empty }: { title: string; items: InsightMiniItem[]; empty?: string }) {
  const content = (item: InsightMiniItem) => <>
    {item.thumbnail ? <img src={img(item.thumbnail)} alt="" /> : <i style={{ backgroundColor: item.color }} />}
    <span><strong>{item.title}</strong><small>{item.meta}</small>{item.progress != null && <em><b style={{ width: `${item.progress}%` }} /></em>}</span>
    <b>{item.value}</b>
  </>;
  return <div className="insights-mini-group">
    <h3>{title}</h3>
    {items.length === 0 ? (empty ? <p>{empty}</p> : null) : <div className="insights-mini-list">{items.map((item) => item.href
      ? <Link className="insights-mini-row" to={item.href} key={item.key}>{content(item)}</Link>
      : <div className="insights-mini-row" key={item.key}>{content(item)}</div>)}</div>}
  </div>;
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
  if (!data) return <EmptyState title={error || t("insightsNoData")} />;

  const { summary } = data;
  const maxDay = Math.max(...data.daily.map((item) => item.seconds), 1);
  const maxHour = Math.max(...data.hours.map((item) => item.seconds), 1);
  const maxHeat = Math.max(...data.heatmap.flatMap((day) => day.hours.map((hour) => hour.seconds)), 1);
  const maxChannel = Math.max(data.channels[0]?.seconds ?? 0, 1);
  const maxTag = Math.max(data.tags[0]?.seconds ?? 0, 1);
  const visibleTagRhythms = data.tag_rhythms.filter((profile) => profile.tags.length > 0);
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
  const completionTotal = Math.max(data.completion.total, 1);
  const completionParts = [
    { key: "completed", label: t("insightsCompleted"), value: data.completion.completed },
    { key: "progress", label: t("insightsInProgress"), value: data.completion.in_progress },
    { key: "brief", label: t("insightsBrief"), value: data.completion.brief },
  ];
  const formatDiscoveryDate = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`));
  const hasSharedInterests = data.shared_interests.channels.length > 0;
  const sponsorCategory = (id: string) => SB_CATEGORIES.find((category) => category.id === id);

  return (
    <div className="insights-page">
      <header className="insights-hero">
        <div>
          <span className="insights-eyebrow"><Activity size={15} /> {t("insightsEyebrow")}</span>
          <h1>{t("insightsTitle")}</h1>
        </div>
        <div className="insights-filters">
          <div className="settings-select-row insights-profile-filter">
            <label className="switch-label" htmlFor="insights-profile">{t("insightsView")}</label>
            <select id="insights-profile" className="select" value={profileId ?? "all"} onChange={(event) => setProfileId(event.target.value === "all" ? null : Number(event.target.value))}>
              <option value="all">{t("insightsHousehold")}</option>
              {data.available_profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
            </select>
          </div>
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
              <TimeAxis max={maxDay} locale={locale} />
              <div className="insights-daily-bars">
                {data.daily.map((item, index) => <div className="insights-daily-column" key={item.day} title={`${item.day}: ${formatDuration(item.seconds, locale)}`}>
                  <span style={{ height: `${Math.max(item.seconds / maxDay * 100, item.seconds ? 4 : 0)}%` }} />
                  {(index === 0 || index === data.daily.length - 1) && <em>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${item.day}T12:00:00`))}</em>}
                </div>)}
              </div>
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
          <div className="insights-hour-chart">
            <TimeAxis max={maxHour} locale={locale} />
            <div className="insights-hour-bars">{data.hours.map((item) => <div key={item.hour} title={`${String(item.hour).padStart(2, "0")}:00 · ${formatDuration(item.seconds, locale)}`}><span style={{ height: `${Math.max(item.seconds / maxHour * 100, item.seconds ? 5 : 0)}%` }} />{item.hour % 3 === 0 && <em>{String(item.hour).padStart(2, "0")}</em>}</div>)}</div>
          </div>
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

        <section className="insights-card insights-tag-rhythms-card">
          <div className="insights-card-head"><div><h2>{t("insightsTagRhythms")}</h2><p>{t("insightsTagRhythmsHint")}</p></div><Tags /></div>
          {visibleTagRhythms.length === 0 ? <p className="insights-tag-rhythm-empty">{t("insightsNoTaggedViewing")}</p> : <div className="insights-tag-rhythms">{visibleTagRhythms.map((profile) => <article key={profile.id}>
            <div className="insights-tag-rhythm-profile"><ProfileAvatar profile={profile} small /><strong>{profile.name}</strong></div>
            <div className="insights-tag-rhythm-list">{profile.tags.map((tag) => {
                const max = Math.max(...tag.hours.map((hour) => hour.seconds), 1);
                return <div className="insights-tag-rhythm" key={tag.name}>
                  <strong className="insights-tag-rhythm-name">{tag.name}</strong>
                  <div className="insights-tag-hour-strip">{tag.hours.map((hour) => {
                    const ratio = hour.seconds / max;
                    return <i key={hour.hour} title={`${String(hour.hour).padStart(2, "0")}:00 · ${formatDuration(hour.seconds, locale)}`} style={{ background: `rgba(124, 92, 255, ${hour.seconds ? .16 + ratio * .84 : .045})` }} />;
                  })}</div>
                  <span className="insights-tag-rhythm-meta">{tag.peak_hour == null ? "" : <><span className="insights-peak-label">{t("insightsPeakLabel")} </span>{String(tag.peak_hour).padStart(2, "0")}:00 · </>}{formatDuration(tag.seconds, locale)}</span>
                </div>;
              })}</div>
            <div className="insights-tag-hour-axis-row" aria-hidden="true"><span /><div className="insights-tag-hour-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><span /></div>
          </article>)}</div>}
          <p className="insights-footnote">{t("insightsTagOverlapHint")}</p>
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
              <span className="insights-rank">{index + 1}</span><span className="insights-tag-dot" style={{ backgroundColor: tag.color }} />
              <div className="insights-ranking-main"><div><b>{tag.name}</b><span>{tag.profile_count} {t("insightsProfilesShort")}</span></div><i><b style={{ width: `${tag.seconds / maxTag * 100}%` }} /></i></div>
              <strong>{formatDuration(tag.seconds, locale)}</strong>
            </div>)}</div>
            <p className="insights-footnote">{t("insightsTagOverlapHint")}</p>
          </article>
        </section>

        <section className="insights-grid insights-behavior-grid">
          <article className="insights-card insights-completion-card">
            <div className="insights-card-head"><div><h2>{t("insightsWatchingStyle")}</h2><p>{t("insightsWatchingStyleHint")}</p></div><CheckCircle2 /></div>
            <div className="insights-completion-summary"><span>{t("insightsAverageCompletion")}</span><strong>{data.completion.average_percent}%</strong></div>
            <div className="insights-completion-bar" aria-hidden="true">{completionParts.map((part) => <i className={`is-${part.key}`} key={part.key} style={{ width: `${part.value / completionTotal * 100}%` }} />)}</div>
            <div className="insights-completion-legend">{completionParts.map((part) => <div className={`is-${part.key}`} key={part.key}><i /><span>{part.label}</span><strong>{part.value}</strong></div>)}</div>
          </article>

          <article className="insights-card">
            <div className="insights-card-head"><div><h2>{t("insightsRegularReturns")}</h2><p>{t("insightsRegularReturnsHint")}</p></div><Repeat2 /></div>
            <div className="insights-paired-lists">
              <InsightMiniList title={t("insightsChannels")} empty={t("insightsNoRegularReturns")} items={data.regular_returns.channels.map((channel) => ({
                key: channel.channel_id, title: channel.title, thumbnail: channel.thumbnail, href: `/channel/${channel.channel_id}`,
                meta: t("insightsActiveDaysCount", { count: channel.active_days }), value: formatDuration(channel.seconds, locale),
              }))} />
              <InsightMiniList title={t("insightsTopics")} items={data.regular_returns.tags.map((tag) => ({
                key: tag.name, title: tag.name, color: tag.color,
                meta: t("insightsActiveDaysCount", { count: tag.active_days }), value: formatDuration(tag.seconds, locale),
              }))} />
            </div>
          </article>
        </section>

        <section className="insights-grid insights-behavior-grid">
          <article className="insights-card">
            <div className="insights-card-head"><div><h2>{t("insightsCompletionChannels")}</h2><p>{t("insightsCompletionChannelsHint")}</p></div><CheckCircle2 /></div>
            <InsightMiniList title={t("insightsChannels")} empty={t("insightsNotEnoughCompletionData")} items={data.completion_channels.map((channel) => ({
              key: channel.channel_id, title: channel.title, thumbnail: channel.thumbnail, href: `/channel/${channel.channel_id}`,
              meta: t("insightsCompletedCount", { completed: channel.completed, total: channel.total }), value: `${channel.completion_percent}%`, progress: channel.completion_percent,
            }))} />
          </article>

          <article className="insights-card">
            <div className="insights-card-head"><div><h2>{t("insightsDiscoveries")}</h2><p>{t("insightsDiscoveriesHint")}</p></div><Compass /></div>
            <div className="insights-paired-lists">
              <InsightMiniList title={t("insightsChannels")} empty={t("insightsNoDiscoveries")} items={data.discoveries.channels.map((channel) => ({
                key: channel.channel_id, title: channel.title, thumbnail: channel.thumbnail, href: `/channel/${channel.channel_id}`,
                meta: t("insightsFirstSeen", { date: formatDiscoveryDate(channel.first_day) }), value: formatDuration(channel.seconds, locale),
              }))} />
              <InsightMiniList title={t("insightsTopics")} items={data.discoveries.tags.map((tag) => ({
                key: tag.name, title: tag.name, color: tag.color,
                meta: t("insightsFirstSeen", { date: formatDiscoveryDate(tag.first_day) }), value: formatDuration(tag.seconds, locale),
              }))} />
            </div>
          </article>
        </section>

        {hasSharedInterests && <section className="insights-card">
          <div className="insights-card-head"><div><h2>{t("insightsSharedInterests")}</h2><p>{t("insightsSharedInterestsHint")}</p></div><Users /></div>
          <div className="insights-shared-list">
            <InsightMiniList title={t("insightsChannels")} items={data.shared_interests.channels.map((channel) => ({
              key: channel.channel_id, title: channel.title, thumbnail: channel.thumbnail, href: `/channel/${channel.channel_id}`,
              meta: t("insightsProfilesCount", { count: channel.profile_count }), value: formatDuration(channel.seconds, locale),
            }))} />
          </div>
        </section>}

        {data.sponsorblock_categories.length > 0 && <section className="insights-card insights-sponsor-details">
          <div className="insights-card-head"><div><h2>{t("insightsSponsorblockDetails")}</h2><p>{t("insightsSponsorblockDetailsHint")}</p></div><FastForward /></div>
          <div className="insights-sponsor-categories">{data.sponsorblock_categories.map((item) => {
            const category = sponsorCategory(item.category);
            return <div key={item.category}><i style={{ backgroundColor: category?.color ?? "var(--text-2)" }} /><span><strong>{category ? t(category.labelKey) : item.category}</strong><small>{t("insightsSkipsCount", { count: item.skip_count })}</small></span><b>{formatDuration(item.seconds, locale)}</b></div>;
          })}</div>
        </section>}
      </>}
    </div>
  );
}
