import { log } from "./logger";

export type AudioDiagnosticMeta = Record<string, boolean | number | string | null | undefined>;
export type AudioDiagnostic = (
  level: "info" | "warn",
  event: string,
  meta: AudioDiagnosticMeta,
) => void;

export const defaultAudioDiagnostic: AudioDiagnostic = (level, event, meta) => {
  log[level](event, meta);
};
