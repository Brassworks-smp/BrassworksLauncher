### **Additions:**
* A brand new **Worlds** tab — every singleplayer world in an instance shows up with its real in-game thumbnail (or a classic grass-block icon if it doesnt have one), plus its game mode, difficulty, last-played time and size. Star ur favourites, jump straight to the world folder, or delete a world right from here
* A per-world **datapack manager** — browse and install datapacks straight from Modrinth and CurseForge into any world, exactly like the content page. Manage the ones u already have (enable, disable, remove), see each pack's logo, description and which site it came from, and click an installed one to change its version or update it later
* A brand new **Servers** tab — add, edit, reorder and remove servers without ever opening the game. Each server gets live-pinged so u can see its MOTD, player count, version, icon and ping right in the list, and it follows SRV records so community server addresses actually connect
* **Star ur favourites** — worlds, servers and screenshots can all be starred now (just like pinning an instance), each with a quick "starred only" filter, and ur stars are saved per instance
* When making a custom instance u can now **type a Minecraft version by hand** instead of scrolling through the giant dropdown

### **Improvements:**
* A big pass of polish and animation across the whole app — pages fade in as u switch tabs, windows ease open and shut instead of popping in and out, the highlight slides between tabs and filters, dropdowns expand smoothly, and the version and changelog lists glide into place
* The content list now animates when u switch category or filter, and moving between browse, details and versions inside Add Content / Install Modpack slides instead of snapping
* Worlds, servers, screenshots and datapacks all got proper search, filters and hover states so they feel like the rest of the launcher, and the per-instance Java cards now match the ones in the main settings
* The Content page remembers what it loaded, so reopening it for the same instance is instant instead of loading from scratch every single time
* Once u dismiss the "possible duplicate mods" warning it stays dismissed for that instance instead of popping up every time u open the page
* Sliders now fill and glide as u drag them, and the star buttons and tab highlights all match the brass theme

### **Fixes:**
* Skins and capes load properly in the installed app now — they were quietly failing in release builds (and only working while developing) because Mojang hands them out over insecure links, so now we fix the links up and ur skin, capes and account avatars actually show
* Browsing datapacks on CurseForge shows actual datapacks now instead of regular mods, and installing one grabs the real datapack file
* The version u already have installed shows a clear "Installed" tag instead of letting u reinstall the exact same thing
