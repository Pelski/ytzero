import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, type DownloadSummary } from "../api";
import { getNewCompletedDownloads, observeDownloadSummary } from "../downloadActivity";
import { subscribeServerEvent } from "../serverEvents";

const EMPTY_DOWNLOAD_SUMMARY: DownloadSummary = {
  enabled: false,
  queued: 0,
  downloading: 0,
  completed: 0,
  errors: 0,
};

export function useNavigationActivity() {
  const location = useLocation();
  const [liveCount, setLiveCount] = useState(0);
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummary>(EMPTY_DOWNLOAD_SUMMARY);
  const [newCompletedDownloads, setNewCompletedDownloads] = useState(getNewCompletedDownloads);
  const downloadSummaryRequestRef = useRef(0);
  const downloadsPageActiveRef = useRef(location.pathname === "/downloads");

  useEffect(() => {
    const load = () => api.live()
      .then((result) => setLiveCount(result.videos.filter((video) => video.live_status === "live").length))
      .catch(() => {});
    load();
    return subscribeServerEvent("live", load);
  }, []);

  const loadDownloadSummary = useCallback(() => {
    const request = ++downloadSummaryRequestRef.current;
    api.downloadSummary().then((summary) => {
      if (request !== downloadSummaryRequestRef.current) return;
      setDownloadSummary(summary);
      setNewCompletedDownloads(observeDownloadSummary(summary.completed, downloadsPageActiveRef.current));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadDownloadSummary();
    return subscribeServerEvent("downloads", loadDownloadSummary);
  }, [loadDownloadSummary]);
  useEffect(() => {
    downloadsPageActiveRef.current = location.pathname === "/downloads";
    if (!downloadsPageActiveRef.current) return;
    setNewCompletedDownloads(observeDownloadSummary(downloadSummary.completed, true));
    loadDownloadSummary();
  }, [location.pathname, loadDownloadSummary]);

  return { downloadSummary, liveCount, newCompletedDownloads };
}
