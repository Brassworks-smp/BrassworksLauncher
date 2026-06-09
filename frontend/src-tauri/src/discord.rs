
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
                    ),
            )
        });
    }

    pub(crate) fn set_playing(&self, pack: &str, image: Option<&str>, link: Option<&str>) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let details = format!("Playing {pack}");
        let large_image = match image {
            Some(url) if url.starts_with("http") => url.to_string(),
            _ => "logo".to_string(),
        };
        let pack = pack.to_string();
        let link = link.map(|s| s.to_string());
        self.with_client(move |client| {
            let mut assets = Assets::new()
                .large_image(&large_image)
                .large_text(&pack);
            if large_image != "logo" {
                assets = assets.small_image("logo").small_text("Brassworks Launcher");
            }
            let mut activity = Activity::new()
                .details(&details)
                .state("In game")
                .timestamps(Timestamps::new().start(now))
                .assets(assets);
            if let Some(url) = link.as_deref() {
                activity = activity.buttons(vec![Button::new("View modpack", url)]);
            }
            client.set_activity(activity)
        });
    }
}
