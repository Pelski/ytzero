import { SmilePlus } from "lucide-react";
import { useI18n } from "../../i18n";
import { EmojiPicker, IconButton } from "../ui";
import type { EmojiSkinTone } from "../../emojiSkinTone";

export default function EmojiReactionPicker({ recent, selected, skinTone, disabled, onSelect, onSkinToneChange }: {
  recent: readonly string[];
  selected: readonly string[];
  skinTone: EmojiSkinTone;
  disabled?: boolean;
  onSelect: (emoji: string) => void;
  onSkinToneChange: (skinTone: EmojiSkinTone) => void;
}) {
  const { t } = useI18n();
  return <EmojiPicker
    trigger={<IconButton className="social-reaction-add" variant="ghost" size="sm" disabled={disabled} label={t("socialAddReaction")} icon={<SmilePlus />} />}
    recent={recent}
    selected={selected}
    skinTone={skinTone}
    disabled={disabled}
    onSelect={onSelect}
    onSkinToneChange={onSkinToneChange}
    labels={{
      recent: t("emojiPickerRecent"), search: t("emojiPickerSearch"), clearSearch: t("emojiPickerClearSearch"),
      categories: { smileys: t("emojiPickerSmileys"), animals: t("emojiPickerAnimals"), food: t("emojiPickerFood"), travel: t("emojiPickerTravel"), activities: t("emojiPickerActivities"), objects: t("emojiPickerObjects"), symbols: t("emojiPickerSymbols"), flags: t("emojiPickerFlags") },
    }}
  />;
}
