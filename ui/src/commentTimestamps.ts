export type CommentTextPart =
  | { type: "text"; value: string }
  | { type: "url"; value: string }
  | { type: "mention"; value: string }
  | { type: "timestamp"; value: string; seconds: number };

const MENTION_PATTERN = /(^|[^\p{L}\p{N}._%+-])(@[\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?)/gu;

function parseMentions(value: string): CommentTextPart[] {
  const parts: CommentTextPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(MENTION_PATTERN)) {
    const mention = match[2];
    const mentionStart = (match.index ?? 0) + match[1].length;
    if (mentionStart > cursor) parts.push({ type: "text", value: value.slice(cursor, mentionStart) });
    parts.push({ type: "mention", value: mention });
    cursor = mentionStart + mention.length;
  }
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ type: "text", value }];
}

function timestampSeconds(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return minutes < 60 && seconds < 60 ? hours * 3_600 + minutes * 60 + seconds : null;
  }
  return null;
}

export function parseCommentText(text: string): CommentTextPart[] {
  return text
    .split(/(https?:\/\/[^\s]+|\b(?:\d+:)?\d+:\d{2}\b)/g)
    .filter(Boolean)
    .flatMap((value): CommentTextPart[] => {
      if (/^https?:\/\//.test(value)) return [{ type: "url", value }];
      const seconds = timestampSeconds(value);
      return seconds === null ? parseMentions(value) : [{ type: "timestamp", value, seconds }];
    });
}
