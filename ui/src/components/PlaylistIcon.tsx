import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bell,
  Bike,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  Briefcase,
  Brush,
  Building2,
  Calendar,
  Camera,
  Car,
  ChartBar,
  CheckCircle,
  Clapperboard,
  Clock,
  Cloud,
  Code2,
  Coffee,
  Cpu,
  Database,
  Dumbbell,
  Eye,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Gem,
  Globe,
  GraduationCap,
  Hammer,
  Hash,
  Headphones,
  Heart,
  Home,
  Image,
  Laptop,
  Lightbulb,
  Link,
  ListMusic,
  Lock,
  Mail,
  Map,
  MessageCircle,
  Mic,
  Moon,
  Music,
  Newspaper,
  Palette,
  PenTool,
  PiggyBank,
  Plane,
  PlaySquare,
  PlusCircle,
  Radio,
  Rocket,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  Terminal,
  ThumbsUp,
  Trophy,
  Tv,
  Users,
  Utensils,
  Wrench,
  Zap,
} from "lucide-react";
import { useI18n } from "../i18n";
import { FloatingPopover, IconPicker, Input } from "./ui";

type IconComponent = LucideIcon;

// Icon ids only. Human-readable, searchable labels live per-language in the i18n
// locale files (iconLabels) and are resolved via the iconLabel() helper.
export const PLAYLIST_ICONS = [
  "ListMusic", "Bookmark", "Star", "Folder", "Archive", "Heart", "ThumbsUp", "Eye",
  "Clock", "Calendar", "History", "Bell", "PlaySquare", "Clapperboard", "Film", "Tv",
  "Radio", "Music", "Headphones", "Mic", "Gamepad2", "Trophy", "Dumbbell", "Plane",
  "Map", "Camera", "Image", "Palette", "Brush", "PenTool", "BookOpen", "GraduationCap",
  "Newspaper", "Lightbulb", "Brain", "Code2", "Terminal", "Laptop", "Cpu", "Bot",
  "Database", "ChartBar", "Briefcase", "Building2", "PiggyBank", "ShoppingCart", "Wrench",
  "Hammer", "Settings", "Rocket", "Zap", "Sparkles", "Flame", "Gem", "Shield", "Lock",
  "Globe", "Cloud", "Sun", "Moon", "Coffee", "Utensils", "Car", "Bike", "Home", "Users",
  "MessageCircle", "Mail", "Link", "Hash", "PlusCircle", "CheckCircle",
] as const;

const ICONS: Record<string, IconComponent> = {
  Archive,
  Bell,
  Bike,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  Briefcase,
  Brush,
  Building2,
  Calendar,
  Camera,
  Car,
  ChartBar,
  CheckCircle,
  Clapperboard,
  Clock,
  Cloud,
  Code2,
  Coffee,
  Cpu,
  Database,
  Dumbbell,
  Eye,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Gem,
  Globe,
  GraduationCap,
  Hammer,
  Hash,
  Headphones,
  Heart,
  Home,
  Image,
  Laptop,
  Lightbulb,
  Link,
  ListMusic,
  Lock,
  Mail,
  Map,
  MessageCircle,
  Mic,
  Moon,
  Music,
  Newspaper,
  Palette,
  PenTool,
  PiggyBank,
  Plane,
  PlaySquare,
  PlusCircle,
  Radio,
  Rocket,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Sun,
  Terminal,
  ThumbsUp,
  Trophy,
  Tv,
  Users,
  Utensils,
  Wrench,
  Zap,
};
function getIcon(icon?: string): IconComponent {
  return ICONS[icon || ""] ?? ListMusic;
}

export function PlaylistIcon({ icon }: { icon?: string }) {
  const Icon = getIcon(icon);
  return <Icon />;
}

export function PlaylistIconPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const { t, iconLabel } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLAYLIST_ICONS;
    return PLAYLIST_ICONS.filter((id) => {
      return iconLabel(id).toLowerCase().includes(q) || id.toLowerCase().includes(q);
    });
  }, [iconLabel, query]);

  const selectedLabel = iconLabel(value);

  return (
    <FloatingPopover
      open={open}
      onOpenChange={setOpen}
      className="playlist-icon-picker-popover"
      trigger={<button
        type="button"
        className={`playlist-icon-trigger${compact ? " compact" : ""}`}
        aria-label={t("choosePlaylistIcon")}
        title={selectedLabel}
      >
        <span className="playlist-icon-trigger-mark"><PlaylistIcon icon={value} /></span>
      </button>}
    >
        <div>
          <Input
            autoFocus
            className="playlist-icon-search"
            value={query}
            placeholder={t("search")}
            onChange={(e) => setQuery(e.target.value)}
          />
          <IconPicker label={t("choosePlaylistIcon")} value={value} options={filtered.map((id) => { const Icon = getIcon(id); return { value: id, label: iconLabel(id), icon: <Icon /> }; })} onChange={(id) => { onChange(id); setOpen(false); setQuery(""); }} />
        </div>
    </FloatingPopover>
  );
}
