import type { AppChangelog, AppRelease, UpdateCheck } from "./api";
import { compareReleaseVersions, releaseVersionKey } from "./releaseVersion";

function newestFirst(left: AppRelease, right: AppRelease) {
  const compared = compareReleaseVersions(left.version, right.version);
  return compared === null ? 0 : -compared;
}

function isNewerThan(left: AppRelease, right: AppRelease) {
  return compareReleaseVersions(left.version, right.version) === 1;
}

function validUniqueReleases(releases: AppRelease[]): AppRelease[] {
  const seen = new Set<string>();
  return releases.filter((release) => {
    const key = releaseVersionKey(release.version);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(newestFirst);
}

export function mergeRemoteChangelog(local: AppChangelog, remote: UpdateCheck): AppChangelog {
  const localReleases = validUniqueReleases(local.releases);
  const remoteEntries = validUniqueReleases(remote.updateAvailable === null ? remote.releases : remote.availableReleases);
  const latestLocal = localReleases[0] ?? null;
  const decoratedRemote = remoteEntries.map((release) => ({
    ...release,
    available: remote.updateAvailable !== null,
    ...(remote.updateAvailable === null
      ? { upcoming: latestLocal ? isNewerThan(release, latestLocal) : true }
      : {}),
  }));
  const versions = new Set(decoratedRemote.map((release) => releaseVersionKey(release.version)));
  const localEntries = localReleases
    .filter((release) => !versions.has(releaseVersionKey(release.version)))
    .map(({ upcoming: _upcoming, available: _available, ...release }) => release);
  return { releases: [...decoratedRemote, ...localEntries].sort(newestFirst) };
}
