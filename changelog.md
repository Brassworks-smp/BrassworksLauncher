### **Additions:**
* **Offline branding** - modpack icons, banners, and logos are now cached locally the first time they load, so instances still look right when you're offline or a source can't be reached. The live image is still used whenever you're online, and the cached copies are cleared along with everything else from the cache control in Settings.

### **Improvements:**
* **Verified downloads** - mods and modpack files are now checked against their published SHA-1 hashes, empty or corrupt downloads are rejected, manually supplied files are validated before they're used, and blocked content is verified in the optional/blocked content picker.

### **Fixes:**
* **Launches offline again** - the launcher no longer hangs on a blank screen at startup when you're offline with Discord open. Discord Rich Presence now connects in the background, and network requests time out instead of stalling forever.
* **Opening a pack file while closed** - double-clicking a `.packwiz` file (or following an install link) while the launcher is closed now opens the install confirmation on first launch, instead of just starting the app and making you click again.
