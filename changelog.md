### **Additions:**
* **Import current Minecraft skin automatically** — opening Skins with an empty library now imports the account's currently-equipped Minecraft skin as a preset called **"Current skin"**, including its arm model and active cape. Fresh accounts immediately have a real editable skin instead of starting from an empty library
* **Import from other launchers** — bring ur instances straight over from Prism Launcher and the Modrinth App. Modpacks come in as proper Modrinth/CurseForge packs so they stay updatable, Prism groups turn into folders, instance icons carry over, and every mod keeps its source so it shows its icon and can be updated individually. Pack icons now show right in the import list before u even import
* **Import GitHub-hosted packwiz modpacks** — paste a GitHub repository URL and the launcher will discover valid packwiz branches automatically. Instances can later switch branches directly from the Modpack card without recreating the pack
* **Default instance icons** — choose from built-in launcher icons (box, gem, sword, heart, star, zap, crown, shield) and have them automatically tinted using the instance folder accent color
* **Duplicate any preset** — one click copies a preset (texture, model and cape) as "Name (1)", "(2)", … so u can branch off variations without starting from scratch

### **Improvements:**
* **Launcher import quality** — imported Modrinth profiles now preserve managed-pack links, allowing supported Modrinth and CurseForge packs to continue receiving updates after import
* **Richer imported mod metadata** — imported Modrinth mods, resource packs and shader packs now retain project/version information, enabling icons, source tracking and per-item updates in the content browser
* **Packwiz workflow improvements** — modpack details now expose the source URL with quick copy/open actions, and switching branches automatically refreshes pack metadata and reinstall state
* **Instance branding improvements** — custom instance icons now appear consistently across instance cards, the Play view and settings previews
* **Server browser presentation** — Minecraft MOTD formatting is now rendered with proper colors, styling codes and Minecraft font support across server lists, previews and details
* **Screenshot browsing performance** — screenshots now use cached thumbnails, skeleton loading states and large-preview lightboxes while avoiding expensive full-resolution image loads

### **Fixes:**
* Fixed Prism and Modrinth launcher scans occasionally failing to discover Modrinth profiles because JSON group metadata was being read incorrectly
* Fixed imported Modrinth instances missing pack icons in the import menu
* Fixed imported Modrinth instances not loading their mod icons and per-mod updates
* Fixed modal backdrops being constrained to the current tab view on WebKit/macOS instead of covering the entire launcher window
* Fixed the macOS double-title-bar appearance when using the custom launcher title bar
* Fixed browser/webview right-click menus appearing throughout the launcher outside editable text fields
* Fixed server MOTDs losing Minecraft color and formatting codes during ping parsing