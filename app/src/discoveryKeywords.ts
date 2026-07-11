export type KeywordSeed = {
  text: string;
  weight: number;
  kind: "title" | "tag";
};

export type KeywordPlan = {
  terms: string[];
  queries: string[];
};

const STOP_WORDS = new Set([
  // English
  "about", "after", "again", "all", "also", "another", "and", "are", "because", "before", "being", "but", "can",
  "could", "did", "do", "does", "doing", "for", "from", "had", "has", "have", "here", "how", "into", "its",
  "just", "more", "most", "new", "not", "now", "other", "our", "out", "really", "should", "still", "than",
  "that", "the", "their", "there", "these", "they", "this", "through", "too", "very", "was", "we", "were",
  "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
  // Polish
  "albo", "bardzo", "będzie", "czyli", "dlaczego", "dla", "jest", "jeszcze", "jako", "które", "który", "można",
  "oraz", "przez", "tego", "tych", "tylko", "więcej", "właśnie", "wszystko", "żeby",
  // German
  "aber", "auch", "dass", "deine", "dieser", "eine", "einer", "für", "haben", "mehr", "nicht", "oder", "sehr",
  "über", "warum", "wenn", "wird",
  // Video metadata, promotions and social boilerplate
  "actually", "channel", "check", "click", "coffee", "discord", "episode", "facebook", "follow", "full", "honest",
  "free", "game", "games", "https", "instagram", "join", "links", "live", "need", "official", "playing", "podcast", "promo", "review", "showcase",
  "sponsored", "sponsor", "subscribe", "tiktok", "twitter", "video", "watch", "website", "youtube",
]);

const DOMAIN_SUFFIXES = new Set(["com", "net", "org", "io", "co", "tv", "gg", "me", "ly"]);

export function tokenizeDiscoveryText(input: string): string[] {
  return input
    .toLocaleLowerCase()
    .normalize("NFC")
    .replace(/https?:\/\/\S+|www\.\S+/giu, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, "").trim())
    .filter(isUsefulToken);
}

function isUsefulToken(token: string) {
  if (token.length < 3 || token.length > 30) return false;
  if (STOP_WORDS.has(token) || DOMAIN_SUFFIXES.has(token)) return false;
  if (/^\d+$/u.test(token)) return false;
  if (/^(.)\1{3,}$/u.test(token)) return false;
  return true;
}

export function buildKeywordPlan(
  seeds: KeywordSeed[],
  blockedTerms: Iterable<string>,
  termLimit = 24,
  queryLimit = 3,
): KeywordPlan {
  const documents = seeds
    .map((seed) => ({ ...seed, tokens: tokenizeDiscoveryText(seed.text) }))
    .filter((seed) => seed.tokens.length > 0);
  const blocked = new Set([...blockedTerms].flatMap(tokenizeDiscoveryText));
  const rawScores = new Map<string, number>();
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    const unique = new Set(document.tokens.filter((token) => !blocked.has(token)));
    const sourceBoost = document.kind === "tag" ? 2.5 : 1;
    for (const token of unique) {
      rawScores.set(token, (rawScores.get(token) ?? 0) + document.weight * sourceBoost);
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const documentCount = Math.max(1, documents.length);
  const ranked = [...rawScores.entries()]
    .map(([term, rawScore]) => {
      const frequency = documentFrequency.get(term) ?? 1;
      const specificity = 0.75 + Math.log(1 + documentCount / frequency);
      return { term, score: rawScore * specificity };
    })
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  const terms = ranked.slice(0, termLimit).map(({ term }) => term);
  const scoreByTerm = new Map(ranked.map(({ term, score }) => [term, score]));

  const queryCandidates = documents
    .map((document) => {
      const uniqueInOrder = [...new Set(document.tokens.filter((token) => scoreByTerm.has(token) && !blocked.has(token)))];
      if (document.kind === "tag") return { tokens: uniqueInOrder.slice(0, 4), kind: document.kind };
      const strongest = [...uniqueInOrder]
        .sort((a, b) => (scoreByTerm.get(b) ?? 0) - (scoreByTerm.get(a) ?? 0))
        .slice(0, 3);
      const strongestSet = new Set(strongest);
      return { tokens: uniqueInOrder.filter((token) => strongestSet.has(token)), kind: document.kind };
    })
    .filter((candidate) => candidate.tokens.length >= 2 || (candidate.kind === "tag" && candidate.tokens[0]?.length >= 5))
    .map((candidate) => ({
      tokens: candidate.tokens,
      score: candidate.tokens.reduce((sum, token) => sum + (scoreByTerm.get(token) ?? 0), 0)
        * (candidate.kind === "tag" ? 1.5 : 1),
    }))
    .sort((a, b) => b.score - a.score);

  const queries: string[] = [];
  const acceptedTokenSets: Set<string>[] = [];
  for (const candidate of queryCandidates) {
    const tokenSet = new Set(candidate.tokens);
    const tooSimilar = acceptedTokenSets.some((accepted) => overlapRatio(tokenSet, accepted) >= 0.67);
    if (tooSimilar) continue;
    queries.push(candidate.tokens.join(" "));
    acceptedTokenSets.push(tokenSet);
    if (queries.length >= queryLimit) break;
  }

  return { terms, queries };
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / Math.max(1, Math.min(a.size, b.size));
}
