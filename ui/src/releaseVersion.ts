type ReleaseVersionKind = "legacy" | "calver";

interface ParsedReleaseVersion {
  kind: ReleaseVersionKind;
  parts: [string, string, string];
  key: string;
}

function versionParts(match: RegExpMatchArray): [string, string, string] {
  return [match[1], match[2], match[3]];
}

function compareNumericParts(left: string, right: string): -1 | 0 | 1 {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
  const calverMatch = value.match(/^([1-9]\d{3})\.(0[1-9]|1[0-2])\.([1-9]\d*)$/);
  if (calverMatch) {
    return { kind: "calver", parts: versionParts(calverMatch), key: `calver:${value}` };
  }

  const legacyMatch = value.match(/^v?(0)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!legacyMatch) return null;
  const parts = versionParts(legacyMatch);
  return { kind: "legacy", parts, key: `legacy:${parts.join(".")}` };
}

export function isReleaseVersion(value: string): boolean {
  return parseReleaseVersion(value) !== null;
}

export function releaseVersionKey(value: string): string | null {
  return parseReleaseVersion(value)?.key ?? null;
}

/** Returns a positive number when left is newer, zero when equal, and null for invalid input. */
export function compareReleaseVersions(left: string, right: string): number | null {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return null;
  if (a.kind !== b.kind) return a.kind === "calver" ? 1 : -1;
  for (let index = 0; index < a.parts.length; index++) {
    const comparison = compareNumericParts(a.parts[index], b.parts[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}
