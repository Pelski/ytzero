import NativeEmojiPicker, { Categories, EmojiStyle, SkinTones, Theme, type CategoryConfig } from "emoji-picker-react";
import type { EmojiPickerLabels } from "./EmojiPicker";
import type { EmojiSkinTone } from "../../emojiSkinTone";

export default function EmojiCatalog({ labels, skinTone, onSelect, onSkinToneChange }: {
  labels: EmojiPickerLabels;
  skinTone: EmojiSkinTone;
  onSelect: (emoji: string) => void;
  onSkinToneChange: (skinTone: EmojiSkinTone) => void;
}) {
  const categories: CategoryConfig[] = [
    { category: Categories.SMILEYS_PEOPLE, name: labels.categories.smileys },
    { category: Categories.ANIMALS_NATURE, name: labels.categories.animals },
    { category: Categories.FOOD_DRINK, name: labels.categories.food },
    { category: Categories.TRAVEL_PLACES, name: labels.categories.travel },
    { category: Categories.ACTIVITIES, name: labels.categories.activities },
    { category: Categories.OBJECTS, name: labels.categories.objects },
    { category: Categories.SYMBOLS, name: labels.categories.symbols },
    { category: Categories.FLAGS, name: labels.categories.flags },
  ];

  return <NativeEmojiPicker
    className="ui-emoji-picker__catalog"
    width="100%"
    height={330}
    theme={Theme.DARK}
    emojiStyle={EmojiStyle.NATIVE}
    defaultSkinTone={skinTone as SkinTones}
    categories={categories}
    searchPlaceholder={labels.search}
    searchClearButtonLabel={labels.clearSearch}
    lazyLoadEmojis
    previewConfig={{ showPreview: false }}
    onEmojiClick={(emoji) => onSelect(emoji.emoji)}
    onSkinToneChange={(tone) => onSkinToneChange(tone as EmojiSkinTone)}
  />;
}
