### **Fixes:**
* Finally fixed those annoying CurseForge "too many requests" errors so it actually retries instead of dying
* Download counts were weirdly showing as zero when opening installed mods but thats patched
* Hitting back on mod details doesn't randomly close the whole window anymore!!
* Min memory setting cant go higher than max memory now (oops)

### **Additions:**
* Full CurseForge support is here so u can browse and install without needing an API key!!
* Mods now automatically grab thier own dependencies (recursively too)
* Theres an "Update all" button now that gives u a checklist to pick what updates
* U can read changelogs straight in the browser
* Threw in some filters to make finding mods way easier (by source, if its enabled, etc)
* Made a banner popup if u have duplicate mods so the game doesnt crash
* Brand new Java settings tab that can litrally auto-download the exact java version u need
* Added JVM presets bc honestly figuring out those flags is a headache
* U can now set up pre-launch and post-exit commands
* New options for what the launcher should do when the game actually boots up
* It tracks ur playtime now (with an option to hide hours if u play way too much lol)
* Discord Rich Presence is in, so everyone can see when ur in the launcher or gaming
* Light mode is finally a thing!
* Put in a clear cache button and a full unistall button in the settings
* Got a sick new screenshot gallery tab where u can see all ur pics from diff instances
* Added those little toast notifications for installs & updates
* Set up automated github actions to build the mac, windows, and linux installers

### **Updated:**
* Swapped the main font to Inter so the UI looks the exact same on every OS
* Redesigned the toggle switches and markdown so they match the brass theme better
* Windows & linux title bars are custom now
* Actually organized the settings menu for once (game stuff moved to the Game tab)
* Log viewer got a massive upgrade w/ colors, selectable text, and a search
* The screen on first launch says "Install" now instead of update/play
* Moved the internal java code into a new crate to make it run smoother