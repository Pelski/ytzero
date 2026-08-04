export type LinkifiedTextPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:]$/;

function splitTrailingPunctuation(candidate: string): [string, string] {
  let url = candidate;
  let trailing = "";
  while (url && SIMPLE_TRAILING_PUNCTUATION.test(url)) {
    trailing = url.slice(-1) + trailing;
    url = url.slice(0, -1);
  }
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
      trailing = close + trailing;
      url = url.slice(0, -1);
    }
  }
  return [url, trailing];
}

export function linkifyText(value: string): LinkifiedTextPart[] {
  const parts: LinkifiedTextPart[] = [];
  let offset = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push({ type: "text", value: value.slice(offset, index) });
    const [url, trailing] = splitTrailingPunctuation(match[0]);
    parts.push({ type: "link", value: url, href: url.startsWith("www.") ? `https://${url}` : url });
    if (trailing) parts.push({ type: "text", value: trailing });
    offset = index + match[0].length;
  }
  if (offset < value.length) parts.push({ type: "text", value: value.slice(offset) });
  return parts;
}
