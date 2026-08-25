import { BookmarkPlus, ListVideo, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { emit, emitToast } from "../events";
import { useI18n } from "../i18n";
import { clearSessionPlayQueue, removeFromSessionPlayQueue, sessionPlayQueueContext, useSessionPlayQueue } from "../sessionPlayQueue";
import { img } from "../img";
import Popconfirm from "../components/Popconfirm";
import { Button, EmptyState, Field, FloatingPopover, IconButton, Inline, Input, List, ListRow, Menu, MenuHeader, MenuItem, MenuSeparator, ScrollArea, Stack } from "../components/ui";
import "./SessionPlayQueueMenu.css";

export default function SessionPlayQueueMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const items = useSessionPlayQueue();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"queue" | "save">("queue");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const setPopoverOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setView("queue");
      setName("");
    }
  };
  const play = (videoId = items[0]?.video_id) => {
    const context = sessionPlayQueueContext();
    if (!context || !videoId) return;
    setPopoverOpen(false);
    navigate(`/watch/${videoId}`, { state: { playbackQueue: context } });
  };
  const save = async () => {
    if (!name.trim() || !items.length || saving) return;
    setSaving(true);
    try {
      await api.createUserPlaylistFromSessionQueue({ name: name.trim(), video_ids: items.map((item) => item.video_id) });
      emit("playlists-changed");
      emitToast(t("sessionQueueSaved"), "success");
      setPopoverOpen(false);
    } catch { emitToast(t("sessionQueueSaveFailed"), "danger"); }
    finally { setSaving(false); }
  };
  const trigger = <Button variant="ghost" iconOnly aria-label={t("sessionQueue")}><ListVideo /></Button>;
  return <FloatingPopover open={open} onOpenChange={setPopoverOpen} align="end" trigger={trigger}>
    <section className="session-queue-menu" aria-label={t("sessionQueue")}>
      {view === "save" ? <>
        <MenuHeader onBack={() => setView("queue")} backLabel={t("back")}>{t("sessionQueueSave")}</MenuHeader>
        <Stack as="form" gap={4} className="session-queue-menu__save" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <Field label={t("name")} htmlFor="session-queue-playlist-name">
            <Input id="session-queue-playlist-name" autoFocus placeholder={t("playlistName")} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Inline justify="end" wrap={false}>
            <Button size="sm" variant="ghost" onClick={() => setView("queue")}>{t("cancel")}</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!name.trim() || saving}>{t("save")}</Button>
          </Inline>
        </Stack>
      </> : <>
        <Inline justify="between" wrap={false} className="session-queue-menu__header">
          <div className="ui-popover__title">{t("sessionQueue")}</div>
          {items.length > 0 && <IconButton size="sm" label={t("sessionQueuePlay")} icon={<Play />} onClick={() => play()} />}
        </Inline>
        {items.length === 0 ? <EmptyState compact icon={<ListVideo />} title={t("sessionQueueEmpty")} /> : <>
          <ScrollArea viewportClassName="session-queue-menu__scroll">
            <List>{items.map((item) => <ListRow key={item.video_id}
              className="session-queue-menu__row"
              role="button"
              tabIndex={0}
              onClick={() => play(item.video_id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                play(item.video_id);
              }}
              media={item.thumbnail ? <img src={img(item.thumbnail)} alt="" /> : <ListVideo aria-hidden="true" />}
              title={item.title || item.video_id}
              description={item.channel_title}
              actions={<IconButton size="sm" variant="ghost" label={t("sessionQueueRemove")} icon={<Trash2 />} onClick={(event) => { event.stopPropagation(); removeFromSessionPlayQueue(item.video_id); }} />}
            />)}</List>
          </ScrollArea>
          <Menu className="session-queue-menu__actions">
            <MenuSeparator />
            <MenuItem icon={<BookmarkPlus />} onClick={() => setView("save")}>{t("sessionQueueSave")}</MenuItem>
            <Popconfirm message={t("sessionQueueClearConfirm")} confirmLabel={t("sessionQueueClear")} onConfirm={clearSessionPlayQueue} triggerClassName="session-queue-menu__confirm-trigger">
              <MenuItem icon={<Trash2 />}>{t("sessionQueueClear")}</MenuItem>
            </Popconfirm>
          </Menu>
        </>}
      </>}
    </section>
  </FloatingPopover>;
}
