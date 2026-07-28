const DOWNLOAD_ACTIVITY_KEY = "ytzero_download_activity";

interface DownloadActivity {
  completed: number | null;
  newCompleted: number;
}

let memoryActivity: DownloadActivity = { completed: null, newCompleted: 0 };

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function readActivity(): DownloadActivity {
  if (typeof window === "undefined") return memoryActivity;
  try {
    const raw = window.sessionStorage.getItem(DOWNLOAD_ACTIVITY_KEY);
    if (!raw) return memoryActivity;
    const parsed = JSON.parse(raw) as Partial<DownloadActivity>;
    memoryActivity = {
      completed: typeof parsed.completed === "number" ? normalizeCount(parsed.completed) : null,
      newCompleted: normalizeCount(parsed.newCompleted),
    };
  } catch {
    // Keep the in-memory fallback when storage is unavailable or malformed.
  }
  return memoryActivity;
}

function writeActivity(activity: DownloadActivity): void {
  memoryActivity = activity;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DOWNLOAD_ACTIVITY_KEY, JSON.stringify(activity));
  } catch {
    // The indicator still works until reload in sandboxed browser contexts.
  }
}

export function getNewCompletedDownloads(): number {
  return readActivity().newCompleted;
}

export function observeDownloadSummary(completed: number, viewingDownloads: boolean): number {
  const nextCompleted = normalizeCount(completed);
  const current = readActivity();
  const firstObservation = current.completed == null;
  const newCompleted = firstObservation || viewingDownloads
    ? 0
    : current.newCompleted + Math.max(0, nextCompleted - current.completed!);

  writeActivity({ completed: nextCompleted, newCompleted });
  return newCompleted;
}

export function clearDownloadActivity(): void {
  memoryActivity = { completed: null, newCompleted: 0 };
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DOWNLOAD_ACTIVITY_KEY);
  } catch {
    // Nothing else to clear when session storage is unavailable.
  }
}
