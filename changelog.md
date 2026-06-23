### **Additions:**
* **Shareable packs** - a `.packwiz` file (or a `brassworks://install` link) points the launcher at a remote pack and opens straight to a confirmation screen before running the normal install. Packs can carry an optional name, description, icon, banner, signing key, news and player-count feeds, default RAM, and JVM args. The file type and URL scheme are registered on every platform, packwiz instances can edit their news and player-count feeds, and shared packs ship with a branded document icon.

### **Improvements:**
* **Install progress where you can see it** - when an instance is still installing, hitting Play selects it and shows its download in the loading bar instead of an overlay on the instances page. When its Play tab isn't open, the download is mirrored as a cancellable progress toast, and instances that are downloading or updating are now marked on their cards. Cancelling a never-finished first install cleans up the orphaned instance.
* **Faster install checks** - the optional and blocked content step now reuses the modpack download from the previous check instead of fetching it again.
