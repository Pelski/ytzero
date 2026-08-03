import { useI18n } from "../../i18n";
import { Alert, Button } from "../ui";
import type { WatchTogetherRoomController } from "./useWatchTogetherRoom";
import WatchTogetherPanel from "./WatchTogetherPanel";
import "./WatchTogetherWatchUi.css";

export function getWatchTogetherLabels(controller: WatchTogetherRoomController, t: ReturnType<typeof useI18n>["t"]) {
  const errorText = controller.error === "closed"
    ? t("watchTogetherClosed")
    : controller.error === "join"
      ? t("watchTogetherJoinError")
      : controller.error === "connection"
        ? t("watchTogetherConnectionError")
        : null;
  const transportLockLabel = controller.room && controller.selfId != null
    ? t("watchTogetherHostControls")
    : errorText ?? t("watchTogetherConnecting");
  return { errorText, transportLockLabel };
}

export function WatchTogetherPanelSlot({
  controller,
  errorText,
}: {
  controller: WatchTogetherRoomController;
  errorText: string | null;
}) {
  if (!controller.room || controller.selfId == null) return null;
  return <WatchTogetherPanel
    room={controller.room}
    selfId={controller.selfId}
    connected={controller.connected}
    sending={controller.sending}
    error={errorText}
    copied={controller.copied}
    onSend={(body) => void controller.sendMessage(body)}
    onCopyInvite={() => void controller.copyInvite()}
    onLeave={controller.leave}
    onEnd={() => void controller.end()}
  />;
}

export function WatchTogetherJoinStatus({
  controller,
  errorText,
  roomId,
}: {
  controller: WatchTogetherRoomController;
  errorText: string | null;
  roomId: string | null;
}) {
  const { t } = useI18n();
  if (!roomId || controller.room || !controller.bootstrapped || !errorText) return null;
  return <Alert className="watch-together-join-alert" variant="danger">
    {errorText} <Button size="sm" variant="ghost" onClick={controller.leave}>{t("watchTogetherLeave")}</Button>
  </Alert>;
}
