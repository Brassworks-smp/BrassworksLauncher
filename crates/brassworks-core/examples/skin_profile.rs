use brassworks_core::Launcher;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let launcher = Launcher::new()?;
    let store = launcher.accounts()?;

    let account = store
        .selected
        .as_ref()
        .and_then(|id| store.accounts.iter().find(|a| &a.id == id))
        .or_else(|| store.accounts.iter().find(|a| a.is_microsoft()))
        .ok_or("no Microsoft account signed in — sign in via the launcher first")?;

    println!("Account: {} ({})", account.username, account.uuid);

    let profile = launcher.skin_profile(&account.id)?;
    println!("Profile name : {}", profile.name);
    println!("Profile id   : {}", profile.id);
    println!("Arm model    : {}", profile.model);
    println!(
        "Skin texture : {}",
        profile.skin_url.as_deref().unwrap_or("(none)")
    );
    if profile.capes.is_empty() {
        println!("Capes        : (none)");
    } else {
        println!("Capes        :");
        for cape in &profile.capes {
            println!(
                "  - {}{} -> {}",
                cape.name,
                if cape.active { " [ACTIVE]" } else { "" },
                cape.url
            );
        }
    }
    Ok(())
}
