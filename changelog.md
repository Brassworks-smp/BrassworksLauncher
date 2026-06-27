### **Additions:**
* **Advanced content filters** - a filter panel in the content, datapack, and modpack browsers lets you narrow results like the Modrinth and CurseForge websites. Pick categories, sort by downloads, follows, newest, or recently updated, and (on Modrinth) filter by environment, license, open source, and last-updated date. An Advanced tab lets you browse content for any Minecraft version or loader, ignoring the instance's pinned setup, with a one-click "newest released" shortcut.
* **Share your modpack** - turn any instance into a link you can send to friends. Brassworks publishes the pack to a free GitHub repo for you, and the link opens in their launcher and installs an auto-updating copy that stays in sync whenever you publish changes. Connect once with a GitHub access token (stored only on your computer), then share with a single click - or save it as a `.packwiz` file instead.
* **Choose what you share** - a built-in content editor lets you pick exactly which mods, configs, and files go into the shared pack, optionally enable flavors so friends can choose variants at install time, and publish updates, sync your copy back from the shared version, or unlink at any time.
* **Export your modpacks** - turn any instance into a shareable pack in four formats: packwiz, packwiz with unsup, Modrinth (`.mrpack`), or CurseForge (`.zip`). A guided window lets you pick exactly which mods, configs, and files to include, name the pack and set its author and version, and export straight to your Downloads folder.
* **Full packwiz support** - exports build a complete packwiz pack (`pack.toml`, `index.toml`, and per-mod metafiles) with correct hashes, so the result installs cleanly in any packwiz-compatible launcher.
* **Full unsup support** - export packwiz packs with the unsup layer for richer distribution: selectable flavors that let players choose variants (different mods or assets) at install time, plus signed packs so installers can verify they're genuine.
* **Optional mods** - mark any Modrinth or CurseForge mod as optional so players can turn it on or off when they install. On packwiz packs you can also add a description and choose whether it starts enabled.
* **Saved exports** - keep an export setup as a reusable config and re-export the same pack with a single click whenever it changes.
* **Import packwiz packs from a file** - import a packwiz `.zip` from your computer, with the same optional and flavor pickers you get when installing from a URL.
* **Right-click an instance** - a context menu gives you quick access to play, settings, the game folder, sharing, and more without opening the gear panel.

### **Improvements:**
* **Pack icons stick around** - exported packs now embed their icon, importing a pack reads it back in, and installing a Modrinth or CurseForge modpack saves its icon locally so it shows up offline.
* **Blocked mods stay installable** - CurseForge mods that can't be redistributed are bundled directly into packwiz and Modrinth exports, and hashes are written correctly for every format so packs verify cleanly.
* **Steadier loader versions** - choosing the "stable" loader now pins the exact version at creation, so your instance won't quietly drift onto a newer build later on.

### **Fixes:**
* **Export selection** - you can now tick a second file in a folder where one was already selected; the list no longer left checkboxes stale.
* **Install links** - opening a share link or double-clicking a `.packwiz` file while the launcher is starting up now reliably hands off to the install screen instead of being dropped.
* **Linux rendering** - applied the WebKit DMA-BUF workaround so the window renders correctly on more Linux setups.
