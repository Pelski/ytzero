export function isYouTubeRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|rate.?limit|too many requests|confirm you(?:'|’)re not a bot)/i.test(message);
}

export function isYouTubeBotChallenge(body: string): boolean {
  return /(?:confirm you(?:'|’)re not a bot|unusual traffic|automated quer(?:y|ies))/i.test(body);
}

export async function readYouTubeResponse(response: Response, failure: string): Promise<string> {
  const body = await response.text();
  if (isYouTubeBotChallenge(body)) throw new Error("YouTube bot challenge: confirm you're not a bot");
  if (!response.ok) throw new Error(`${failure} (${response.status})`);
  return body;
}
