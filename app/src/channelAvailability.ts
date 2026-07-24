export type ChannelUnavailableReason = "not_found";

/** Only permanent, channel-specific failures may stop future sync attempts. */
export function channelUnavailableReason(error: unknown): ChannelUnavailableReason | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/RSS fetch failed \((404|410)\)/i.test(message)) return "not_found";
  if (/channel.{0,40}(does not exist|not found|has been terminated|is unavailable)/i.test(message)) return "not_found";
  if (/(does not exist|not found|has been terminated).{0,40}channel/i.test(message)) return "not_found";
  return null;
}
