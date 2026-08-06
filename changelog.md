# 0.8.1

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
