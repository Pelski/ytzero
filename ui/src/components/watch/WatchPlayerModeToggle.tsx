import { Headphones, MonitorPlay } from "lucide-react";
import { IconButton } from "../ui";
import "./WatchPlayerModeToggle.css";

export default function WatchPlayerModeToggle({
  active,
  available,
  audioLabel,
  videoLabel,
  onToggle,
}: {
  active: boolean;
  available: boolean;
  audioLabel: string;
  videoLabel: string;
  onToggle: (active: boolean) => void;
}) {
  if (!available) return null;
  const label = active ? videoLabel : audioLabel;
  return (
    <IconButton
      size="sm"
      variant="secondary"
      className="watch-player-mode-toggle"
      label={label}
      icon={active ? <MonitorPlay /> : <Headphones />}
      onClick={(event) => {
        onToggle(!active);
        if (event.detail > 0) event.currentTarget.blur();
      }}
      aria-pressed={active}
    />
  );
}
