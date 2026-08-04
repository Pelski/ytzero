import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChannelSyncJob } from "./api";
import { mergeChannelSyncResponse, newestChannelSyncJob } from "./channelSync";
import { subscribeServerEvent } from "./serverEvents";

export function useChannelSyncActivity() {
  const [job, setJob] = useState<ChannelSyncJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);
  const minimumNullRequestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    api.channelSyncJob()
      .then((result) => {
        setBusy(result.busy);
        setJob((current) => mergeChannelSyncResponse(current, result.job, request, minimumNullRequestRef.current));
      })
      .catch(() => {})
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return subscribeServerEvent("channel-sync", load);
  }, [load]);

  const start = useCallback(async (channelIds: string[]) => {
    const result = await api.startChannelSync(channelIds);
    // A pre-POST null must not erase the accepted job. Non-null snapshots are
    // always merged by revision, even if a newer GET later fails.
    minimumNullRequestRef.current = requestRef.current + 1;
    setBusy(true);
    setJob((current) => newestChannelSyncJob(current, result.job));
    return result.job;
  }, []);

  return { job, busy, loading, start };
}
