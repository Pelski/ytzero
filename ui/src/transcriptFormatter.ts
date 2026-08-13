type TranscriptCue = {
  timestamp: string;
  words: string[];
};

const TIMESTAMPED_LINE = /^\[([^\]]+)]\s*(.*)$/;
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

function comparableWord(word: string): string {
  return word.toLocaleLowerCase().replace(EDGE_PUNCTUATION, "") || word;
}

function sameWords(left: string[], right: string[], count: number, leftOffset = 0): boolean {
  for (let index = 0; index < count; index += 1) {
    if (comparableWord(left[leftOffset + index]) !== comparableWord(right[index])) return false;
  }
  return true;
}

function parseTranscript(raw: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const match = line.trim().match(TIMESTAMPED_LINE);
    if (!match) continue;
    const words = match[2].trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) cues.push({ timestamp: match[1], words });
  }
  return cues;
}

/** Remove cumulative and rolling overlap from timestamped YouTube captions. */
export function formatTranscript(raw: string): string {
  const cues = parseTranscript(raw);
  if (cues.length === 0) return raw.trim();

  const output: string[] = [];
  let previous: string[] = [];
  for (const cue of cues) {
    const current = cue.words;
    let overlap = 0;

    if (previous.length > 0) {
      const sharedPrefix = Math.min(previous.length, current.length);
      if (sameWords(previous, current, sharedPrefix)) {
        if (current.length <= previous.length) continue;
        overlap = previous.length;
      } else {
        const maximum = Math.min(previous.length, current.length);
        for (let count = maximum; count > 0; count -= 1) {
          if (sameWords(previous, current, count, previous.length - count)) {
            overlap = count;
            break;
          }
        }
      }
    }

    const newWords = current.slice(overlap);
    if (newWords.length > 0) output.push(`[${cue.timestamp}] ${newWords.join(" ")}`);
    previous = current;
  }
  return output.join("\n");
}
