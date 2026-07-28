export type CommentTextPart =
  | { type: "text"; value: string }
  | { type: "url"; value: string }
  | { type: "timestamp"; value: string; seconds: number };

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
    .map((value): CommentTextPart => {
      if (/^https?:\/\//.test(value)) return { type: "url", value };
      const seconds = timestampSeconds(value);
      return seconds === null ? { type: "text", value } : { type: "timestamp", value, seconds };
    });
}
