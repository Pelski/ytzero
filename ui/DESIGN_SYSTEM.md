# YT Zero internal design system

## Goal

Centralize interaction, accessibility and visual variants without moving product logic into generic components. New generic UI belongs in `src/components/ui`; domain components stay in `src/components`.

## Inventory and target mapping

| Existing pattern | Target component | Notes |
| --- | --- | --- |
| `.btn`, `.btn.primary`, `.btn.danger`, `.btn-ghost` | `Button` | Variants: default, primary, secondary, danger, ghost. |
| `.icon-btn`, `.btn.icon-only` | `IconButton` | Requires an accessible `label`. |
| `.form-input`, raw text/number inputs, textareas | `Input`, `Textarea`, `Field`, `InputGroup` | `Field` owns label, hint and validation message. |
| `.select`, raw selects | `Select` | Native select remains the accessible baseline. |
| `.switch`, `.switch-row` | `Switch`, `SettingRow` | State API uses booleans rather than CSS classes. |
| raw checkboxes | `Checkbox` | Supports label and description. |
| plugin sliders, subtitle sliders | `Slider` | Continuous range. |
| video-card size slider | `SteppedSlider` | Discrete values and keyboard navigation. |
| `.dropdown` / `.dropdown-menu` used as a panel | `Popover`, `FloatingPopover` | Use the portal-backed variant when an ancestor can clip content or the panel must stay inside the viewport. |
| command/selection dropdowns | `Menu`, `MenuItem`, `MenuHeader`, `MenuSeparator` | Provides menu semantics and shared selected/disabled states. |
| hand-built radio button groups | `SegmentedControl` | Single selection with proper radio semantics. |
| tag/icon/language option lists | `OptionPicker` | Layout-agnostic single/multi-column option primitive. |
| `.settings-section`, `.switch-row`, `.settings-select-row` | `SettingsSection`, `SettingRow` | Keeps settings layout out of page code. |
| tabs and filter pills | `Tabs`, `Chip`, `SegmentedControl` | `Tabs` has `pill`, `settings` and `subtle` variants; segmented controls choose a setting; chips filter content. |
| modal overlays | `Dialog` | Owns portal, Escape, backdrop and accessible dialog semantics. |
| `Tooltip`, `Popconfirm` | `Tooltip`; `Popconfirm` built on `FloatingPopover` | Public feature APIs remain small while positioning is shared. |
| `PlaylistIconPicker`, `SubtitlePicker`, tag pickers | domain pickers built from popovers, menus and option pickers | Product data/search remains domain-specific. |
| playlist create/add menus | `PlaylistPicker` | One controlled body is reused by desktop and compact watch menus. |
| watch-later bucket menus | `SchedulePicker` | Shared by desktop and compact watch menus. |
| `.page-title`, `.section-title`, `.page-hint`, `.hint` | `PageHeader`, `SectionHeader`, `Text` | Semantic headings and consistent supporting copy. |
| ad-hoc flex rows and vertical groups | `Inline`, `Stack` | Typed spacing and responsive wrapping. |
| content separators | `Divider` | Plain, inset and labeled variants; menus retain `MenuSeparator`. |
| `.empty-state`, feature alerts and count pills | `EmptyState`, `Alert`, `Badge` | Shared feedback, tone and responsive spacing. |
| application toast markup | `Toast` | Presentation and live-region semantics are centralized. |
| repeated media/content/action rows | `List`, `ListRow`, `ListActions` | Responsive composition without domain knowledge. |

## Layers

1. **Primitives:** Button, ButtonLink, IconButton, fields, Switch, Checkbox, sliders and Tooltip.
2. **Composition:** Popover, FloatingPopover, Dialog, Menu, Tabs, OptionPicker, SegmentedControl and SettingRow/Section.
3. **Domain UI:** PlaylistPicker, PlaylistIconPicker, TagPicker, SubtitlePicker and SchedulePicker.
4. **Features:** Watch actions, profile menu, channel technical menu and settings pages.

## Migration order

1. Use the new primitives in newly changed code; do not add more raw `.btn`, `.switch` or `.form-input` usages.
2. Small isolated components (`ChannelSearchPicker`, `Popconfirm`, profile card-size popover) are migrated.
3. Shared positioning, dialog and semantic menu primitives are available; `SubtitlePicker` and `PlaylistIconPicker` use them.
4. `PlaylistPicker`, `SchedulePicker` and tag/icon pickers are extracted and reused.
5. The complete Display settings group uses the shared settings and form primitives. Continue other settings groups section by section; remove legacy CSS only after their final consumer is gone.

## Implemented components

- Actions: `Button`, `ButtonLink`, `ButtonAnchor`, `IconButton`, `FormActions`.
- Forms: `Input`, `Textarea`, `Select`, `Field`, `InputGroup`, `Checkbox`, `Switch`, `Slider`, `SteppedSlider`.
- Pickers: `ColorPicker`, `OptionPicker`, `IconPicker`.
- Selection: `Tabs` (`pill`, `settings`, `subtle`), `Chip`, `SegmentedControl`, `OptionPicker`, `IconPicker`.
- Overlays: `Popover`, `FloatingPopover`, `Dialog`, `Menu` family.
- Settings layout: `SettingsSection`, `SettingRow`.
- Layout and typography: `PageHeader`, `SectionHeader`, `Text`, `Divider`, `Stack`, `Inline`.
- Feedback: `Alert`, `EmptyState`, `Badge`, `Toast`.
- Lists: `List`, `ListRow`, `ListActions`.
- Domain compositions: `PlaylistPicker`, `PlaylistIconPicker`, `SchedulePicker`, `SubtitlePicker`, channel tag picker.

## Rules

- Generic components know nothing about videos, playlists, profiles or API calls.
- Domain components own loading, mutations and translated option labels.
- Every icon-only action requires an accessible label.
- Controlled state is preferred for persisted settings; uncontrolled state is acceptable for local popovers.
- Variants are typed props, not caller-composed class-name conventions.
