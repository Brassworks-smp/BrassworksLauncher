### **Additions:**
* **CreateMod.com schematic library** - instances with Create installed now get a dedicated Schematics page for browsing installed `.nbt` files, searching them, removing them, and distinguishing launcher downloads from schematics added locally. The integration can also be forced on or off from Instance Settings.
* **Add Schematics browser** - search CreateMod.com from inside the launcher with the same familiar layout as Add Content, including provider tabs, categories, sorting, compatibility filters, quick installs, and continuously loading Trending, Latest, Highest Rated, and search results.
* **Detailed schematic pages** - open a schematic to see its author, upload date, categories, all tags, dimensions, block count, Minecraft and Create versions, ratings, downloads, version history, and fully rendered description.
* **Galleries, materials, and dependencies** - schematic galleries open in the launcher's full-window image viewer, material lists include block previews and a one-click copy action, and required mods include artwork and direct links into Add Content for seamless Modrinth or CurseForge installation.
* **More Linux packages** - releases now include ready-to-install Flatpak, Arch Linux (`.pkg.tar.zst`), Snap, and Void Linux (`.xbps`) packages alongside the existing AppImage, Debian, and RPM builds.
* **Folder-first instance layout** - a new launcher setting can place your instance folders above the ungrouped **Your instances** section.

### **Improvements:**
* **Consistent content browsing** - Schematics reuses the launcher's shared cards, buttons, segmented tabs, filters, dropdowns, modal layout, transitions, hover states, and install styling, with CreateMod.com's blue used only as the provider accent.
* **Local image caching** - thumbnails, galleries, required-mod icons, and material previews are cached on disk for faster browsing and better behavior when an image host is unavailable.
* **Accurate installed metadata** - downloads made through Brassworks keep their CreateMod.com title, author, artwork, description, link, and provider identity, while manually copied files remain clean local entries. Replacing a downloaded file also clears stale provider metadata.
* **Smarter Create integration** - the Schematics sidebar entry appears only when the integration is available, updates with an animation when that state changes, and uses the launcher's standard segmented control in Instance Settings.
* **Cached API with live statistics** - CreateMod.com browsing uses the Brassworks cache proxy by default for responsive metadata and images while overlaying fresh download and rating statistics. The proxy is configurable and direct API access remains available as a fallback.
* **Advanced filters now carry through installation** - choosing another Minecraft version or loader in Add Content now affects the project versions shown, quick installs, selected-version installs, and required dependencies instead of only changing the search results.
* **More reliable Microsoft sessions** - account refreshes are serialized, briefly reused between account checks and launch, and automatically retried when Microsoft or Xbox returns a transient failure.

### **Fixes:**
* **Infinite schematic browsing** - home feeds and search results now continue loading as you scroll instead of stopping after the first page.
* **Description rendering** - HTML descriptions, including complex pages such as Ryujin All Terrain Hovercraft, now render correctly instead of exposing broken markup.
* **Schematic detail polish** - fullscreen gallery previews now cover the whole launcher window, required-mod actions have proper spacing and hover feedback, and missing modal transitions and list animations have been restored.
* **Linux Snap versioning** - corrected the Snap build scriptlet so release versions are assigned properly during packaging.
* **Installed content actions** - opening an already-installed mod, schematic, or datapack now offers **Uninstall** and removes the installed file instead of offering to reinstall it. Modpack-managed files remain protected, while datapack version switching stays available separately.
* **Pre-launch errors stay visible** - authentication and other failures that happen before Minecraft starts no longer open the game log as if the game crashed, so the real launcher error remains visible. Actual game crashes still follow the console-on-crash setting.
