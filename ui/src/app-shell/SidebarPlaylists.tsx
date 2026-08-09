import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, type UserPlaylist } from "../api";
import { emit, subscribe } from "../events";
import { useI18n } from "../i18n";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import { Button } from "../components/ui";

export default function SidebarPlaylists() {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ListMusic");
  const listRef = useRef<HTMLDivElement>(null);
  const [shadowTop, setShadowTop] = useState(false);
  const [shadowBottom, setShadowBottom] = useState(false);

  const load = useCallback(() => {
    api.userPlaylists()
      .then((result) => setPlaylists(result.playlists))
      .catch((error) => console.error("Unable to load sidebar playlists", error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe("playlists-changed", load), [load]);

  const updateShadows = useCallback(() => {
    const element = listRef.current;
    if (!element) return;
    setShadowTop(element.scrollTop > 4);
    setShadowBottom(element.scrollTop + element.clientHeight < element.scrollHeight - 4);
  }, []);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    updateShadows();
    element.addEventListener("scroll", updateShadows, { passive: true });
    const resizeObserver = new ResizeObserver(updateShadows);
    resizeObserver.observe(element);
    return () => {
      element.removeEventListener("scroll", updateShadows);
      resizeObserver.disconnect();
    };
  }, [playlists, loading, updateShadows]);

  const create = async () => {
    if (!name.trim()) return;
    await api.createUserPlaylist({ name: name.trim(), icon });
    setName("");
    setIcon("ListMusic");
    setCreating(false);
    load();
    emit("playlists-changed");
  };

  return (
    <div className="sidebar-playlists">
      <div className="sidebar-section-title">
        <span>{t("myPlaylists")}</span>
        <button className="sidebar-add-btn" title={t("newPlaylist")} onClick={() => setCreating((value) => !value)}>
          <Plus size={15} />
        </button>
      </div>
      <div className={`sidebar-playlists-scroll-wrap${shadowTop ? " shadow-top" : ""}${shadowBottom ? " shadow-bot" : ""}`}>
        <div className="sidebar-playlists-scroll" ref={listRef}>
          {loading && playlists.length === 0 && (
            <div className="sidebar-skeleton-list" aria-label={t("loading")}>
              {Array.from({ length: 3 }, (_, index) => (
                <div className="sidebar-skeleton-item" aria-hidden="true" key={index}>
                  <div className="skeleton sidebar-skeleton-square" />
                  <div className="skeleton skeleton-line" />
                </div>
              ))}
            </div>
          )}
          {playlists.map((playlist) => (
            <NavLink key={playlist.id} to={`/playlists/${playlist.id}`} className={({ isActive }) => `sidebar-playlist-item${isActive ? " active" : ""}`}>
              <span className="sidebar-playlist-icon"><PlaylistIcon icon={playlist.icon} /></span>
              <span className="sidebar-sub-name">{playlist.name}</span>
              <span className="sidebar-playlist-count">{playlist.video_count}</span>
            </NavLink>
          ))}
        </div>
      </div>
      {creating && (
        <div className="sidebar-playlist-form">
          <div className="sidebar-playlist-fields">
            <PlaylistIconPicker value={icon} onChange={setIcon} compact />
            <input
              value={name}
              placeholder={t("playlistName")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
            />
          </div>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>{t("create")}</Button>
        </div>
      )}
    </div>
  );
}
