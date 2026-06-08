
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
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

    pub(crate) fn set_playing(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        self.with_client(|client| {
            client.set_activity(
                Activity::new()
                    .details("Playing on the Brassworks SMP")
                    .state("In game")
                    .timestamps(Timestamps::new().start(now))
                    .assets(
                        Assets::new()
                            .large_image("logo")
                            .large_text("Brassworks SMP"),
                    ),
            )
        });
    }
}
