const TRANSCRIPT_LANGUAGE_KEY_PREFIX = "ytzero.transcriptLanguage.profile.";

function storage(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function key(profileId: number | null): string | null {
  return Number.isSafeInteger(profileId) && Number(profileId) > 0
    ? `${TRANSCRIPT_LANGUAGE_KEY_PREFIX}${profileId}`
    : null;
}

export function profileTranscriptLanguage(profileId: number | null, available: readonly string[]): string | null {
  const storageKey = key(profileId);
  if (!storageKey) return null;
  try {
    const language = storage()?.getItem(storageKey);
    return language && available.includes(language) ? language : null;
  } catch {
    return null;
  }
}

export function rememberProfileTranscriptLanguage(profileId: number | null, language: string): void {
  const storageKey = key(profileId);
  if (!storageKey || !language) return;
  try { storage()?.setItem(storageKey, language); } catch {}
}
