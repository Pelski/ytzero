import { useEffect, useRef, useState } from "react";
import { Captions, Copy, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { api, ApiError } from "../api";
import { emitToast } from "../events";
import { useI18n } from "../i18n";
import { SUBTITLE_LANGUAGE_CODES, subtitleLanguageLabel } from "../subtitleLanguages";
import { formatTranscript } from "../transcriptFormatter";
import { profileTranscriptLanguage, rememberProfileTranscriptLanguage } from "../transcriptLanguagePreference";
import { rememberedProfileId } from "../profilePreference";
import { Alert, Button, Dialog, SelectMenu, SettingRow, Textarea } from "./ui";
import "./TranscriptDialog.css";

export default function TranscriptDialog({ videoId, title, languages, onClose }: {
  videoId: string;
  title: string;
  languages: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const preferredLanguages = languages.filter((code, index) => SUBTITLE_LANGUAGE_CODES.has(code) && languages.indexOf(code) === index);
  if (preferredLanguages.length === 0) preferredLanguages.push("en");
  const [profileId] = useState(rememberedProfileId);
  const [language, setLanguage] = useState(() => profileTranscriptLanguage(profileId, preferredLanguages) ?? preferredLanguages[0]);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const requestIdRef = useRef(0);
  const failureMessage = t(failureCode === "rate_limited" ? "transcriptRateLimited" : "transcriptUnavailable");
  const selectLanguage = async (nextLanguage: string, remember = true, attempt = 1) => {
    const requestId = ++requestIdRef.current;
    setLanguage(nextLanguage);
    setAttempts(attempt);
    if (remember) rememberProfileTranscriptLanguage(profileId, nextLanguage);
    setTranscript("");
    setFailureCode(null);
    setLoading(true);
    try {
      const result = await api.videoTranscript(videoId, nextLanguage);
      if (requestId === requestIdRef.current) setTranscript(formatTranscript(result.transcript));
    } catch (error) {
      if (requestId === requestIdRef.current) setFailureCode(error instanceof ApiError ? error.code ?? "unavailable" : "unavailable");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void selectLanguage(language, false);
    return () => { requestIdRef.current += 1; };
  }, [videoId]);

  const copyTranscript = async () => {
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
      <Button onClick={() => void copyTranscript()} disabled={!transcript} leadingIcon={<Copy />}>{t("copyAll")}</Button>
      <Button variant="primary" onClick={download} disabled={!transcript} leadingIcon={<Download />}>{t("download")}</Button>
    </>}
  >
    <div className="transcript-dialog__toolbar">
      <SettingRow className="transcript-dialog__language-row" label={t("displayLanguage")} description={t("transcriptLanguageBrowserHint")}>
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
      </SettingRow>
    </div>
    <div className="transcript-dialog__content">
      {loading && <div className="transcript-dialog__loading" role="status"><LoaderCircle className="spin" />{t("loading")}</div>}
      {failureCode && <div className="transcript-dialog__failure">
        <Alert variant="warning" icon={<Captions />}>{failureMessage}</Alert>
        <Button variant="ghost" leadingIcon={<RefreshCw />} disabled={attempts >= 3} onClick={() => void selectLanguage(language, false, attempts + 1)}>{t("transcriptRetry")}</Button>
        {attempts >= 3 && <small>{t("transcriptRetryExhausted")}</small>}
      </div>}
      {transcript && <Textarea className="transcript-dialog__text" aria-label={t("transcript")} readOnly value={transcript} />}
    </div>
  </Dialog>;
}
