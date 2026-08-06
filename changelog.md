# 0.8.1

## Additions

- Added Abfielder and Minecraft Schematics as alternate schematic providers alongside CreateMod.com, with a provider-neutral backend that makes additional providers easier to add.
- Added automatic provider availability detection for Create on Forge, NeoForge, Fabric, and Quilt; Litematica, Forgematica, Schematica-compatible forks; and WorldEdit projects from both Modrinth and CurseForge.
- Added independent Auto, On, and Off integration controls for CreateMod.com, Abfielder, and Minecraft Schematics.
- Added per-instance schematic folders with a separate path for `.nbt`, `.litematic`, `.schem`, `.schematic`, and `.mcstructure` files. WorldEdit-only instances default WorldEdit formats to `config/worldedit/schematics`.
- Added native provider filters: Abfielder tags and Minecraft Schematics categories, themes, and build sizes.
- Added provider-specific accents and provider-aware installed-schematic filters, metadata, links, and file-format compatibility.

## Improvements

- Abfielder is shown before Minecraft Schematics and is available to both Litematica-compatible and WorldEdit instances. Its searches explicitly request free schematic products and its full tag catalog is cached when available.
- Minecraft Schematics excludes paid and subscription-only creations. Downloads clearly explain the account requirement, open the correct provider page, watch the user's Downloads folders, and import the completed file using the existing manual-download workflow.
- Download format selection is limited to formats compatible with the current instance and is skipped when only one format is available.
- Provider descriptions, authors, images, downloads, categories, tags, supported formats, and other available metadata are cached and displayed without inventing unsupported view counts.
- The shared cache now handles provider metadata, filters, images, and supported downloads. Rate-limited Abfielder and Minecraft Schematics requests fall back to bounded, locally cached client-side fetching.
- CreateMod.com browsing now always uses the shared cache instead of permanently bypassing it after a transient health-check failure. The obsolete direct API-key fallback was removed.
- Schematic imports, removals, folder opening, metadata tracking, and installed-file discovery now support every configured schematic format and custom folder.

## Fixes

- Fixed CreateMod.com searches such as “iron farm” failing while decoding `/api/schematics` responses.
- Fixed download cards showing a completed check mark before a download finished or after a failed download.
- Fixed Minecraft Schematics cards opening unrelated CreateMod.com URLs when provider IDs overlap.
- Fixed Minecraft Schematics pagination and infinite scrolling for native category, theme, size, and latest listings.
- Fixed stale or incomplete provider metadata only appearing after opening a schematic detail page.
- Fixed Minecraft Schematics manual-download actions using an ordinary download icon instead of clearly indicating the browser handoff.
- Fixed transient cache failures being hidden behind a misleading `401 Unauthorized` response from CreateMod.com.
