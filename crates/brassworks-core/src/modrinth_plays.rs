use serde::Serialize;

use crate::error::{CoreError, Result};

const UA: &str = "BrassworksLauncher (github.com/Brassworks-smp)";

const MOJANG_JOIN_URL: &str = "https://sessionserver.mojang.com/session/minecraft/join";
const MODRINTH_SERVER_PLAY_URL: &str =
    "https://api.modrinth.com/analytics/minecraft-server-play";

#[derive(Serialize)]
struct JoinServerBody<'a> {
    #[serde(rename = "accessToken")]
    access_token: &'a str,
    #[serde(rename = "selectedProfile")]
    selected_profile: String,
    #[serde(rename = "serverId")]
    server_id: &'a str,
}

#[derive(Serialize)]
struct ServerPlayBody<'a> {
    project_id: &'a str,
    username: &'a str,
    server_id: &'a str,
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| CoreError::Remote(e.to_string()))
}

fn random_server_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn report_server_play(
    access_token: &str,
    uuid: &str,
    username: &str,
    project_id: &str,
) -> Result<()> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Ok(());
    }

    let server_id = random_server_id();
        let selected_profile = uuid.replace('-', "");

    let http = client()?;

        let join = http
        .post(MOJANG_JOIN_URL)
        .json(&JoinServerBody {
            access_token,
            selected_profile,
            server_id: &server_id,
        })
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if join.status().as_u16() == 401 || join.status().as_u16() == 403 {
        return Err(CoreError::Unauthorized);
    }
    if !join.status().is_success() {
        return Err(CoreError::Remote(format!(
            "mojang joinServer -> {}",
            join.status()
        )));
    }

        let play = http
        .post(MODRINTH_SERVER_PLAY_URL)
        .json(&ServerPlayBody {
            project_id,
            username,
            server_id: &server_id,
        })
        .send()
        .map_err(|e| CoreError::Remote(e.to_string()))?;
    if !play.status().is_success() {
        return Err(CoreError::Remote(format!(
            "modrinth minecraft-server-play -> {}",
            play.status()
        )));
    }

    Ok(())
}
