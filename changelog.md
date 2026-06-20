### **Additions:**
* **Command palette + slash commands** - press ⌘K (Ctrl+K on Windows/Linux) to open the command palette and run anything in the launcher. Type `/` for Discord-style slash commands with autocomplete and live hints for each argument - launch instances, search/install/toggle content, sync the modpack, manage worlds, servers, skins, accounts, themes and settings. You can chain commands with `;`, pin the ones you use most, and type `/help` to browse everything.
* **`brassworks` command-line tool** - drive the launcher straight from your terminal with the same commands (for example `brassworks instance launch survival` or `brassworks go settings`). Install or remove the command from Settings → Launcher; `brassworks help` and `brassworks --version` run without opening the app.
* **Custom accent colours** - a new colour picker lets you dial in any colour you like by dragging the gradient or pasting a hex code, now available for the launcher accent, instance folder colours, and during onboarding. Your custom colour sticks around even when you switch to a preset, and clearing the hex resets it.
* **Pinned commands in the menu bar** (macOS) - commands you've pinned in the palette now show up under a "Commands" menu in the top menu bar, so you can run your favourites in one click without opening the palette.
* **Custom instance branding from a file** - set an instance's icon, banner, or logo by picking an image straight from your computer with the new "Choose file" button, not just by pasting a URL.

### **Improvements:**
* **Reworked command palette** - it now fuzzy-searches every action in the launcher (grouped by area), shows each command's signature and description as you type, and lets you pin your favourite commands to the top. List commands like "show worlds" jump straight to the matching screen.
* **Syntax highlighting in descriptions and changelogs** - code blocks in mod descriptions and version changelogs are now colour-highlighted, using shades drawn from your accent colour so they match your theme.
* **Smoother content scrolling** - mod icons and details now load ahead of time, so scrolling through a big content list stays seamless instead of popping in late.
* **Instant screenshot starring** - starring or unstarring a screenshot reorders the grid right away instead of waiting for a refresh.
* **Polished toggles** - the screenshot "This instance / All" switch and the instance grid/compact switch now use the same animated segmented control as the rest of the app.
* **Accurate folder drop preview** - when you drag an instance onto a folder, the "drop here" placeholder now appears exactly where the instance will land once it's sorted, instead of always at the end.
* **Slimmer title bar** - the window title bar is a little shorter, giving the rest of the app more room.
* **Themed colour picker** - the colour picker now matches the rest of the launcher, with swatch-style handles, squared corners, and hex fields that show a focus outline. When you open it from a folder's colour menu, its border, buttons, and focus outlines all follow that folder's own colour, and the selected custom colour reads the same as the preset swatches.
* **Cleaner buttons** - the Play, Install/Update, and "Add content" buttons drop the chunky 3D ledge for the same flat style as the "Add server" button.
* **Frosted Play hero** - the main Play screen swaps its blueprint grid for a frosted-glass panel, accent-tinted with a fine grain so it has some texture. The pack type ("Modrinth pack", "Featured pack"…) now sits with the version and loader chips under the name instead of in a separate badge above it.

### **Fixes:**
* **Command palette search** - typing `/` after a search now switches cleanly to command mode and shows every action, instead of keeping the previous results around.
* **Featured pack artwork** - featured pack icons and banners render correctly again.
* **Drag instances into folders on Windows** - dragging an instance onto a folder no longer shows the "no-drop" cursor and now drops as expected.
