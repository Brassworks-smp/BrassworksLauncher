# 0.9.0

## Global Files

- Added symlink-based Global Files profiles for sharing individual files or complete folders across instances, with a visible JSON configuration and shared-storage folder for advanced users.
- Added a dedicated Global Files page with profile creation and deletion, a searchable file tree, collapsed folders by default, styled Brassworks dropdowns, natural page scrolling, and a responsive two-column layout.
- Added per-instance profile selection and opt-out controls both on the Global Files page and in Instance Settings. Opting out replaces links with normal local copies instead of deleting content.
- Added safe profile switching, collision backups, archived deleted profiles, path traversal protection, and automatic repair of missing or replaced links after modpack synchronization and before Minecraft starts.
- Made screenshots available in the sharing tree while continuing to hide generated runtime folders such as logs, libraries, assets, downloads, and natives.
- Added launcher-metadata synchronization for mods, resource packs, shader packs, schematics, datapacks, servers, screenshots, worlds, and their relevant favorites.
- Preserved content provider IDs, version IDs, titles, descriptions, icons, filenames, schematic authors, images, source formats, and conversion provenance across linked instances.
- Added automatic migration of legacy absolute schematic metadata paths to portable filename keys so existing profiles retain their schematic cards and details in every instance.
- Positioned Global Files immediately above Settings in the sidebar and added it to launcher navigation and the command palette.

## Shared modpacks

- Unlocking an installed shared modpack now presents an explicit irreversible fork warning before disconnecting it from the share.
- Forking converts all installed managed mods, resource packs, and shader packs into ordinary user-owned content so each item can be disabled, updated, or removed independently.
- Removed shared ownership, update configuration, optional selections, flavor selections, signing state, and pinned shared settings from a forked instance.
- Fixed duplicate content cards and competing writes when older or malformed shared packs contain multiple entries for the same destination, preferring entries with provider and version metadata.
- Deduplicated persisted user-content records and manifest listings while retaining provider metadata.
- Refreshed the bundled CreateMod artwork.

## Schematic conversion

- Added built-in conversion between Create/Vanilla `.nbt`, Litematica `.litematic`, WorldEdit/Sponge `.schem`, and legacy `.schematic` files.
- Added format selection when downloading schematics, automatic conversion for non-native formats, and a Convert action in both the installed list and schematic details.
- Added cancellable download and conversion progress, including Minecraft Schematics browser-download imports.
- Added conversion provenance to installed schematic cards and details, showing the original and converted formats alongside the actual filename.
- Converted files now use explicit, collision-safe names such as `build-converted-from-nbt.schem`, preserving the original and numbering repeated conversions instead of overwriting files.
- Removed the incorrect 48-block-per-axis restriction for Create `.nbt` files and matched Create's sparse structure output so large schematics remain compact.
- Fixed sparse Create structures turning air into palette index zero after `.litematic`, `.schem`, or `.schematic` round trips.
- Added compatibility guidance for Create/Vanilla, Litematica/Forgematica, and WorldEdit formats.

## Downloads and updates

- Added progress toasts and cancellation for mod, resource-pack, shader-pack, datapack, schematic, and launcher-update downloads.
- Added separate conversion progress when a downloaded schematic requires conversion.
- Made Minecraft Schematics download watching wait for files to finish changing before import and retry transient import failures.
- Refreshed instance capabilities after content installs, removals, updates, enable/disable changes, and manual refreshes so the Schematics sidebar tab appears immediately.

## Content exports

- Fixed rich HTML exports displaying escaped Markdown and HTML instead of rendered project descriptions.
- Fixed mixed Markdown/HTML and nested disclosure blocks breaking entries such as EMI add-ons.
- Made exported cards, images, tables, filenames, code blocks, and long links responsive instead of overflowing the page.
- Applied the launcher's active theme and accent color to HTML exports.
- Sanitized rendered project descriptions before writing rich HTML or Markdown exports.
