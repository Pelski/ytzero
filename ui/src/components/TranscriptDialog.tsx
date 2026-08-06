import { useState } from "react";
import { Copy, Download, LoaderCircle } from "lucide-react";
import { api } from "../api";
import { emitToast } from "../events";
import { useI18n } from "../i18n";
import { SUBTITLE_LANGUAGE_CODES, subtitleLanguageLabel } from "../subtitleLanguages";
import { Alert, Button, Dialog, Field, SelectMenu, Textarea } from "./ui";
import "./TranscriptDialog.css";

export default function TranscriptDialog({ videoId, title, languages, onClose }: {
  videoId: string;
  title: string;
  languages: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const preferredLanguages = languages.filter((code, index) => SUBTITLE_LANGUAGE_CODES.has(code) && languages.indexOf(code) === index);
  if (preferredLanguages.length === 0) preferredLanguages.push("en");

  const selectLanguage = async (nextLanguage: string) => {
    setLanguage(nextLanguage);
    setTranscript("");
    setFailed(false);
    setLoading(true);
    try {
      const result = await api.videoTranscript(videoId, nextLanguage);
      setTranscript(result.transcript);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!transcript) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(transcript);
    } catch {
      const area = document.createElement("textarea");
      area.value = transcript;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    emitToast(t("copied"), "success");
  };

  const download = () => {
    if (!transcript) return;
    const safeTitle = title.replace(/[\\/:*?"<>|]+/g, "-").trim() || videoId;
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeTitle}.${language}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <Dialog
    open
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={t("transcript")}
    closeLabel={t("close")}
    busy={loading}
    className="transcript-dialog"
    footer={<>
      <Button onClick={() => void copy()} disabled={!transcript} leadingIcon={<Copy />}>{t("copyAll")}</Button>
      <Button variant="primary" onClick={download} disabled={!transcript} leadingIcon={<Download />}>{t("download")}</Button>
    </>}
  >
    <Field label={t("subtitles")}>
      <SelectMenu
        value={language}
        options={preferredLanguages.map((code) => ({ value: code, label: subtitleLanguageLabel(code) }))}
        onChange={(value) => void selectLanguage(value)}
        label={t("subtitles")}
        placeholder={t("subtitles")}
        disabled={loading}
        floating
        align="start"
        className="transcript-dialog__language"
      />
    </Field>
    {loading && <div className="transcript-dialog__loading" role="status"><LoaderCircle className="spin" />{t("loading")}</div>}
    {failed && <Alert className="transcript-dialog__alert" variant="warning">{t("transcriptUnavailable")}</Alert>}
    {transcript && <Field className="transcript-dialog__result" label={t("transcript")}>
      <Textarea className="transcript-dialog__text" readOnly value={transcript} />
    </Field>}
  </Dialog>;
}
