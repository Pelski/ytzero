import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api, type Profile, type SocialProfileRef, type Video } from "../../api";
import { useI18n } from "../../i18n";
import { img } from "../../img";
import { ProfileAvatar } from "../ProfileMenu";
import { VideoThumbnail } from "../VideoThumbnail";
import { Button, Dialog, Field, Inline, List, ListRow, Stack } from "../ui";
import ProfileMentionInput from "./ProfileMentionInput";
import "./SocialShareDialog.css";

export default function SocialShareDialog({ open, video, onOpenChange, onResult }: {
  open: boolean;
  video: Video;
  onOpenChange: (open: boolean) => void;
  onResult: (success: boolean) => void;
}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SocialProfileRef[]>([]);
  const [activeProfile, setActiveProfile] = useState<SocialProfileRef | null>(null);
  const [body, setBody] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBody("");
    let current = true;
    void Promise.all([api.socialProfiles(), api.profiles()]).then(([social, all]) => {
      if (!current) return;
      setProfiles(social.profiles);
      const active = all.profiles.find((profile: Profile) => profile.active);
      setActiveProfile(social.profiles.find((profile) => profile.id === active?.id) ?? null);
    }).catch(() => {
      if (current) { setProfiles([]); setActiveProfile(null); }
    });
    return () => { current = false; };
  }, [open]);

  const publish = async () => {
    setPublishing(true);
    try {
      await api.createSocialPost(video.video_id, body);
      onOpenChange(false);
      onResult(true);
    } catch {
      onOpenChange(false);
      onResult(false);
    } finally {
      setPublishing(false);
    }
  };

  return <Dialog
    open={open}
    onOpenChange={(next) => { if (!publishing) onOpenChange(next); }}
    title={t("socialShareVideo")}
    closeLabel={t("close")}
    className="social-share-dialog"
    footer={<Inline justify="end">
      <Button variant="ghost" disabled={publishing} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
      <Button variant="primary" disabled={publishing} onClick={() => void publish()}>{publishing ? <><LoaderCircle className="spin" /> {t("socialPublishing")}</> : t("socialPublish")}</Button>
    </Inline>}
  >
    <Stack gap={4}>
      {activeProfile && <div className="social-share-dialog__author"><ProfileAvatar profile={activeProfile} size={38} /><span>{activeProfile.name}</span></div>}
      <List divided={false} className="social-share-dialog__video">
        <ListRow
          media={<VideoThumbnail src={img(video.thumbnail)} watched={Boolean(video.watched)} variant="sidebar" />}
          title={video.title}
          description={video.channel_title}
        />
      </List>
      <Field label={t("socialMentionProfiles")}>
        <ProfileMentionInput value={body} onChange={setBody} profiles={profiles} placeholder={t("socialPostPlaceholder")} disabled={publishing} maxLength={1_000} />
      </Field>
    </Stack>
  </Dialog>;
}
