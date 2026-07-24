# Repository working rules

## UI and design system

- Before adding UI markup or CSS, search `ui/src/components/ui` and existing domain components for a matching reusable component.
- Settings are the strictest design-system surface: compose them from `SettingsSection`, `SettingRow`, `Field`, and the shared controls (`Button`, `Select`, `Input`, `Switch`, `Checkbox`, `Slider`, `Tabs`, pickers, etc.). Do not introduce raw controls or one-off settings layout when a shared primitive exists.
- If an interaction pattern is missing and is likely to be used again, add or extend a reusable component first, then consume it from the feature. Keep data fetching and domain copy in a domain component; keep layout and interaction primitives in `components/ui`.
- Reuse `Popover`, `List`/`ListButton`, `EmptyState`, `Badge`, and shared buttons for menus and notification-style surfaces before creating bespoke equivalents.
- Add feature-specific CSS only for genuinely domain-specific presentation. Shared states, spacing, focus, hover, sizing, and responsive behavior belong to the reusable component.
- Empty states: `EmptyState`'s illustrated `art` variant is reserved for primary destinations. Read `docs/illustrations.md` before adding or drawing one; everything else uses the plain `icon` variant.
- Before adding CSS, identify its component or page owner. `ui/src/styles.css` is only for global foundations; component and page selectors belong beside their implementation.

## Persistence and backup compatibility

- Read `docs/backup-restore-architecture.md` before adding or changing persistent settings, database state, plugin state, profile-owned data, or files under `data/`.
- Every persistent field must be explicitly classified as portable configuration, portable personal state, rebuildable cache, transient state, secret, or machine-bound data. Update the document and the owning backup adapter/section when that classification or serialized shape changes.
- Portable backup is domain-based and versioned; never expose a new table or setting through a generic database/settings dump. New portable entities need stable identifiers, dependencies, merge/replace semantics, idempotent restore behavior, and old-backup compatibility.
- Add or update round-trip and exclusion tests for persistent features. A feature that silently disappears from a selected backup, leaks into an unselected category, exports a secret, or breaks restore of an older supported archive is incomplete.
