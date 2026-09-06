export const LOCAL_PLAYER_DOUBLE_TAP_MS = 350;

export type LocalPlayerTapSide = "back" | "forward";

export interface LocalPlayerTap {
  side: LocalPlayerTapSide;
  timestamp: number;
}

export type LocalPlayerDoubleActivation = LocalPlayerTapSide | "fullscreen";

export function localPlayerTapSide(clientX: number, left: number, width: number): LocalPlayerTapSide {
  return clientX < left + width / 2 ? "back" : "forward";
}

export function isMatchingLocalPlayerDoubleTap(previous: LocalPlayerTap | null, current: LocalPlayerTap): boolean {
  return previous !== null
    && previous.side === current.side
    && current.timestamp >= previous.timestamp
    && current.timestamp - previous.timestamp <= LOCAL_PLAYER_DOUBLE_TAP_MS;
}

export function resolveLocalPlayerDoubleActivation(
  pointerType: string,
  clientX: number,
  left: number,
  width: number,
): LocalPlayerDoubleActivation {
  return pointerType === "touch" ? localPlayerTapSide(clientX, left, width) : "fullscreen";
}
