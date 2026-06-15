use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{
    activity::{Activity, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};

const APP_ID: &str = match option_env!("DISCORD_APP_ID") {
    Some(id) => id,
    None => "1513659845818060981",
};

const WEBSITE_URL: &str = "https://brassworks.opnsoc.org";
const DISCORD_URL: &str = "https://brassworks.opnsoc.org/discord";

pub(crate) struct Discord {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl Discord {
    pub(crate) fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }

    fn with_client<F>(&self, f: F)
    where
        F: FnOnce(&mut DiscordIpcClient) -> Result<(), Box<dyn std::error::Error>>,
    {
        let mut guard = match self.client.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if guard.is_none() {
            if let Ok(mut client) = DiscordIpcClient::new(APP_ID) {
                if client.connect().is_ok() {
                    *guard = Some(client);
                }
            }
        }
        if let Some(client) = guard.as_mut() {
            if f(client).is_err() {
                *guard = None;
            }
        }
    }

            pub(crate) fn clear(&self) {
        let mut guard = match self.client.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(mut client) = guard.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
    }

    pub(crate) fn set_idle(&self) {
        self.with_client(|client| {
            client.set_activity(
                Activity::new()
                    .details("In the launcher")
                    .state("Idle")
                    .assets(
                        Assets::new()
                            .large_image("logo")
                            .large_text("Brassworks Launcher"),
                    )
                    .buttons(vec![
                        Button::new("Website", WEBSITE_URL),
                        Button::new("Discord", DISCORD_URL),
                    ]),
            )
        });
    }

    pub(crate) fn set_playing(&self, pack: &str, image: Option<&str>, link: Option<&str>) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let details = format!("Playing {pack}");
                        let modpack_image = match image {
            Some(url) if url.starts_with("http") => Some(url.to_string()),
            _ => None,
        };
        let pack = pack.to_string();
        let link = link.map(|s| s.to_string());
        self.with_client(move |client| {
            let mut assets = Assets::new()
                .large_image("logo")
                .large_text("Brassworks Launcher");
            if let Some(mp) = modpack_image.as_deref() {
                assets = assets.small_image(mp).small_text(&pack);
            }
            let mut activity = Activity::new()
                .details(&details)
                .state("In game")
                .timestamps(Timestamps::new().start(now))
                .assets(assets);
                                    let buttons = match link.as_deref() {
                Some(url) => vec![
                    Button::new("View modpack", url),
                    Button::new("Discord", DISCORD_URL),
                ],
                None => vec![
                    Button::new("Website", WEBSITE_URL),
                    Button::new("Discord", DISCORD_URL),
                ],
            };
            activity = activity.buttons(buttons);
            client.set_activity(activity)
        });
    }
}
