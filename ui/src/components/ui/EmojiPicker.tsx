import { lazy, Suspense, useState, type ReactElement } from "react";
import { FloatingPopover } from "./FloatingPopover";
import type { EmojiSkinTone } from "../../emojiSkinTone";
import "./EmojiPicker.css";

const EmojiCatalog = lazy(() => import("./EmojiCatalog"));

const EMOJI_CONTENT = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[0-9#*]\uFE0F?\u20E3)/u;

export function normalizeEmoji(value: string): string | null {
  const emoji = value.trim().normalize("NFC");
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;
  const graphemes = Segmenter ? [...new Segmenter("en", { granularity: "grapheme" }).segment(emoji)] : [{ segment: emoji }];
  return emoji.length <= 32 && graphemes.length === 1 && graphemes[0]?.segment === emoji && EMOJI_CONTENT.test(emoji) ? emoji : null;
}

export interface EmojiPickerLabels {
  recent: string;
  search: string;
  clearSearch: string;
  categories: {
    smileys: string;
    animals: string;
    food: string;
    travel: string;
    activities: string;
    objects: string;
    symbols: string;
    flags: string;
  };
}

export function EmojiPicker({ trigger, recent, selected = [], labels, skinTone, disabled, onSelect, onSkinToneChange }: {
  trigger: ReactElement;
  recent: readonly string[];
  selected?: readonly string[];
  labels: EmojiPickerLabels;
  skinTone: EmojiSkinTone;
  disabled?: boolean;
  onSelect: (emoji: string) => void;
  onSkinToneChange: (skinTone: EmojiSkinTone) => void;
}) {
  const [open, setOpen] = useState(false);

  const choose = (value: string) => {
    if (disabled) return;
    const emoji = normalizeEmoji(value);
    if (!emoji) return;
    onSelect(emoji);
    setOpen(false);
  };

  return <FloatingPopover
    open={open}
    onOpenChange={(next) => { if (!disabled) setOpen(next); }}
    align="start"
    className="ui-emoji-picker-popover"
    triggerClassName="ui-emoji-picker__anchor"
    trigger={trigger}
  >
    <div className="ui-emoji-picker">
      {recent.length > 0 && <section className="ui-emoji-picker__recent" aria-label={labels.recent}>
        <strong>{labels.recent}</strong>
        <div className="ui-emoji-picker__recent-grid">
          {recent.map((emoji) => <button key={emoji} type="button" className={selected.includes(emoji) ? "is-selected" : ""} aria-pressed={selected.includes(emoji)} aria-label={emoji} onClick={() => choose(emoji)}>{emoji}</button>)}
        </div>
      </section>}
      <Suspense fallback={<div className="ui-emoji-picker__loading" aria-busy="true">{labels.search}…</div>}>
        <EmojiCatalog labels={labels} skinTone={skinTone} onSelect={choose} onSkinToneChange={onSkinToneChange} />
      </Suspense>
    </div>
  </FloatingPopover>;
}
