# Repository working rules

## UI and design system

- Before adding UI markup or CSS, search `ui/src/components/ui` and existing domain components for a matching reusable component.
- Settings are the strictest design-system surface: compose them from `SettingsSection`, `SettingRow`, `Field`, and the shared controls (`Button`, `Select`, `Input`, `Switch`, `Checkbox`, `Slider`, `Tabs`, pickers, etc.). Do not introduce raw controls or one-off settings layout when a shared primitive exists.
- If an interaction pattern is missing and is likely to be used again, add or extend a reusable component first, then consume it from the feature. Keep data fetching and domain copy in a domain component; keep layout and interaction primitives in `components/ui`.
- Reuse `Popover`, `List`/`ListButton`, `EmptyState`, `Badge`, and shared buttons for menus and notification-style surfaces before creating bespoke equivalents.
- Add feature-specific CSS only for genuinely domain-specific presentation. Shared states, spacing, focus, hover, sizing, and responsive behavior belong to the reusable component.
- Before adding CSS, identify its component or page owner. `ui/src/styles.css` is only for global foundations; component and page selectors belong beside their implementation.
