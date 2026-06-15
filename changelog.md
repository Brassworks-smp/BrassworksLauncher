### **Additions:**
* **Community translations** - the last release shipped the translation *system* but English-only; Brassworks now actually speaks these languages, contributed through Crowdin:
  * **Dutch** - fully translated
  * **Russian** - fully translated
  * **Pirate Speak** - just for fun
  * **LOLCAT** - just for fun

  More languages are in progress on Crowdin and will land as they're completed. Pick yours from the language selector in Settings (or during onboarding) - anything not translated yet still falls back to English, and the picker shows how complete each language is

### **Improvements:**
* **Add-content quick install** - search results in the content browser now have a one-click install button that grabs the latest compatible version, no need to open the mod, switch to versions and install
* **Scroll position is remembered** - opening a mod/modpack/datapack's details and coming back, or switching tabs in the content browser, modpack browser and datapacks picker, now keeps your place in the list instead of jumping to the top
* **Discord Rich Presence** - the launcher logo is the main icon with the modpack as a small badge, and the status now links straight to the website and Discord
* **Onboarding polish** - per-page tip cards stay until you actually close them, the "skip all" shortcut was removed, and the language step now comes first

### **Fixes:**
* Fixed disabling a flavor / optional component in an unsup pack not actually removing its mods - removal now uses the exact same flavor resolution the picker shows, so deselecting reliably drops the files
* Fixed being able to open instance-only pages (and the Skins page without a Microsoft account) through the command palette or the macOS/Linux menu bar
* Fixed dragging instances into folders not working on Windows
* Fixed "Clear Microsoft cookies" hanging and freezing the app on Windows
* Fixed the logo looking jagged - it's now smoothly anti-aliased
* Per-page onboarding tips now show the first time as intended, and the Skins onboarding card resets properly with "Replay onboarding"
