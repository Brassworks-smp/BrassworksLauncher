### **Additions:**
* **Auto-join a world or server on launch** - pick a default world or server for an instance in its settings, and hitting Play jumps you straight in. The button becomes "Play & Join", and the chosen world or server now shows as a chip on the Play screen right under the pack name and icon.
* **Per-instance account override** - lock an instance to a specific Microsoft account so it always launches with that profile no matter who's signed in globally, with a heads-up warning when you switch accounts.
* **Manual download for blocked CurseForge mods** - when a modpack includes files CurseForge won't let the launcher fetch automatically, a guided dialog walks you through downloading them by hand and watches your downloads folder to pick them up as soon as they land.

### **Improvements:**
* **Smarter modpack installs** - installing a pack now checks its optional and blocked content in a single pass, streams real byte-level download progress instead of a vague spinner, and surfaces any blocked mods as an install submenu so you can deal with them up front.
* **Clearer download failures** - files that fail to download are now reported with the actual reason in a toast, and downloads retry automatically before giving up.
* **Instant sync cancellation** - cancelling a modpack sync now force-stops any in-flight downloads immediately instead of waiting for them to finish.
* **Cleaner default instance icon** - new instances start with a simple box glyph instead of a placeholder image.

### **Fixes:**
* **Fewer surprise sign-ins** - you're only asked to log in again when your session is genuinely rejected, not on a temporary network hiccup, so accounts stay signed in across launches.
* **Wider LWJGL compatibility** - restored the proper upstream LWJGL fix so all LWJGL 3.3+ versions launch correctly.
* **`brassworks` command on Windows** - the command-line tool is now added to your PATH correctly on Windows.
