import type { AppChangelog, AppRelease, UpdateCheck } from "./api";

function versionParts(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function newerVersion(left: AppRelease | null, right: AppRelease): AppRelease {
  if (!left) return right;
  const a = versionParts(left.version);
  const b = versionParts(right.version);
  if (!a || !b) return left;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return b[index] > a[index] ? right : left;
  }
  return left;
}

function newestFirst(left: AppRelease, right: AppRelease) {
  const a = versionParts(left.version);
  const b = versionParts(right.version);
  if (!a || !b) return 0;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

function isNewerThan(left: AppRelease, right: AppRelease) {
  return newestFirst(left, right) < 0;
}

export function mergeRemoteChangelog(local: AppChangelog, remote: UpdateCheck): AppChangelog {
  const remoteEntries = remote.updateAvailable === null ? remote.releases : remote.availableReleases;
  const latestLocal = local.releases.reduce<AppRelease | null>(newerVersion, null);
  const decoratedRemote = remoteEntries.map((release) => ({
    ...release,
    available: remote.updateAvailable !== null,
    ...(remote.updateAvailable === null
      ? { upcoming: latestLocal ? isNewerThan(release, latestLocal) : true }
      : {}),
  }));
  const versions = new Set(decoratedRemote.map((release) => release.version));
  const localEntries = local.releases
    .filter((release) => !versions.has(release.version))
    .map(({ upcoming: _upcoming, available: _available, ...release }) => release);
  const releases = [...decoratedRemote, ...localEntries];

  if (remote.updateAvailable !== null) return { releases };
  return { releases: releases.sort(newestFirst) };
}
