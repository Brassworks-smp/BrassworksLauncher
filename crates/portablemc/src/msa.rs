
use std::io::{self, BufReader, BufWriter, Read, Seek};
use std::iter::FusedIterator;
use std::time::Duration;
use std::path::{Path, PathBuf};
use std::fmt::Debug;
use std::sync::Arc;
use std::fs::{self, File};

use reqwest::{Client, StatusCode};
use serde_json::json;
use uuid::Uuid;

use jsonwebtoken::{DecodingKey, TokenData, Validation};


#[derive(Debug, Clone)]
pub struct Auth {
    app_id: Arc<str>,
    language_code: Option<String>,
}

impl Auth {

    pub fn new(app_id: &str) -> Self {
        Self {
            app_id: Arc::from(app_id),
            language_code: None,
        }
    }

    #[inline]
    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    #[inline]
    pub fn language_code(&self) -> Option<&str> {
        self.language_code.as_deref()
    }

    #[inline]
    pub fn set_language_code(&mut self, code: impl Into<String>) -> &mut Self {
        self.language_code = Some(code.into());
        self
    }

    pub fn request_device_code(&self) -> Result<DeviceCodeFlow, AuthError> {

        crate::tokio::sync(async move {

            let req = MsDeviceAuthRequest {
                client_id: &self.app_id,
                scope: "XboxLive.signin offline_access",
                mkt: self.language_code.as_deref(),
            };

            let client = crate::http::builder().build()
                .map_err(AuthError::new_reqwest)?;

            let res = client
                .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
                .form(&req)
                .send().await
                .map_err(AuthError::new_reqwest)?;

            if res.status() != StatusCode::OK {
                return Err(AuthError::InvalidStatus(res.status().as_u16()));
            }

            let res = res
                .json::<MsDeviceAuthSuccess>().await
                .map_err(AuthError::new_reqwest)?;

            Ok(DeviceCodeFlow {
                client,
                app_id: Arc::clone(&self.app_id),
                res,
            })

        })

    }

}

#[derive(Debug, Clone)]
pub struct DeviceCodeFlow {
    client: Client,
    app_id: Arc<str>,
    res: MsDeviceAuthSuccess,
}

impl DeviceCodeFlow {

    #[inline]
    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    #[inline]
    pub fn user_code(&self) -> &str {
        &self.res.user_code
    }

    #[inline]
    pub fn verification_uri(&self) -> &str {
        &self.res.verification_uri
    }

    #[inline]
    pub fn message(&self) -> &str {
        &self.res.message
    }

    pub fn wait(&self) -> Result<Account, AuthError> {

        crate::tokio::sync(async move {

            let req = MsTokenRequest::DeviceCode {
                client_id: &self.app_id,
                device_code: &self.res.device_code,
            };
            
            let interval = Duration::from_secs(self.res.interval as u64);

            loop {

                tokio::time::sleep(interval).await;
                match request_ms_token(&self.client, &req, "XboxLive.signin").await? {
                    Ok(res) => {

                        let mut account = request_minecraft_account(&self.client, &res.access_token).await?;
                        account.app_id = self.app_id.to_string();
                        account.refresh_token = res.refresh_token;

                        break Ok(account);

                    }
                    Err(res) => {
                        match res.error.as_str() {
                            "authorization_pending" => 
                                continue,
                            "authorization_declined" => 
                                break Err(AuthError::Declined),
                            "expired_token" => 
                                break Err(AuthError::TimedOut),
                            "bad_verification_code" | _ => 
                                break Err(AuthError::Unknown(res.error_description)),
                        }
                    }
                }

            }

        })

    }

}

#[derive(Debug, Clone)]
pub struct Account {
    app_id: String,
    refresh_token: String,
    access_token: String,
    uuid: Uuid,
    username: String,
    xuid: String,
}

impl Account {

    #[inline]
    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    #[inline]
    pub fn access_token(&self) -> &str {
        &self.access_token
    }

    #[inline]
    pub fn uuid(&self) -> Uuid {
        self.uuid
    }

    #[inline]
    pub fn username(&self) -> &str {
        &self.username
    }

    #[inline]
    pub fn xuid(&self) -> &str {
        &self.xuid
    }

    pub fn request_profile(&mut self) -> Result<(), AuthError> {
        
        let client = crate::http::builder().build()
            .map_err(AuthError::new_reqwest)?;

        let profile = crate::tokio::sync(request_minecraft_profile(&client, &self.access_token))?;
        self.username = profile.name;
        Ok(())

    }

    pub fn request_refresh(&mut self) -> Result<(), AuthError> {

        crate::tokio::sync(async move {

            let client = crate::http::builder().build()
                .map_err(AuthError::new_reqwest)?;

            let req = MsTokenRequest::RefreshToken { 
                client_id: &self.app_id, 
                scope: Some("XboxLive.signin offline_access"), 
                refresh_token: &self.refresh_token, 
                client_secret: None,
            };
            
            let res = match request_ms_token(&client, &req, "XboxLive.signin").await? {
                Ok(res) => res,
                Err(res) => {
                    return Err(AuthError::Unknown(res.error_description));
                }
            };

            let account = request_minecraft_account(&client, &res.access_token).await?;
            self.refresh_token = res.refresh_token;
            self.access_token = account.access_token;
            self.uuid = account.uuid;
            self.username = account.username;

            Ok(())
            
        })
        
    }

}

async fn request_ms_token(
    client: &Client,
    req: &MsTokenRequest<'_>,
    expected_scope: &str,
) -> Result<std::result::Result<MsTokenSuccess, MsAuthError>, AuthError> {

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(req)
        .send().await
        .map_err(AuthError::new_reqwest)?;

    match res.status() {
        StatusCode::OK => {
            
            let res = res.json::<MsTokenSuccess>().await
                .map_err(AuthError::new_reqwest)?;

            if res.token_type != "Bearer" {
                return Err(AuthError::Unknown(format!("Unexpected token type: {}", res.token_type)));
            } else if res.scope != expected_scope {
                return Err(AuthError::Unknown(format!("Unexpected scope: {}", res.scope)));
            }

            Ok(Ok(res))

        }
        StatusCode::BAD_REQUEST => {
            Ok(Err(res.json::<MsAuthError>().await.map_err(AuthError::new_reqwest)?))
        }
        status => Err(AuthError::InvalidStatus(status.as_u16())),
    }
    
}

async fn request_minecraft_account(
    client: &Client,
    ms_auth_token: &str,
) -> Result<Account, AuthError> {

    let user_res = request_xbl_user(&client, ms_auth_token).await?;
    let xsts_res = request_xbl_xsts(&client, &user_res.token).await?;

    if user_res.display_claims.xui.is_empty() 
    || user_res.display_claims.xui != xsts_res.display_claims.xui {
        return Err(AuthError::Unknown(format!("Invalid or incoherent display claims.")))
    }

    let user_hash = xsts_res.display_claims.xui[0].uhs.as_str();
    let xsts_token = xsts_res.token.as_str();

    let mc_res = request_minecraft_with_xbl(&client, user_hash, xsts_token).await?;
    let mc_res_token = decode_jwt_without_validation::<MinecraftToken>(&mc_res.access_token)
        .map_err(AuthError::new_jwt)?;
    let profile_res = request_minecraft_profile(&client, &mc_res.access_token).await?;

    Ok(Account {
        app_id: String::new(),
        refresh_token: String::new(),
        access_token: mc_res.access_token,
        uuid: profile_res.id,
        username: profile_res.name,
        xuid: mc_res_token.claims.xuid,
    })

}

async fn request_xbl_user(
    client: &Client, 
    ms_auth_token: &str,
) -> Result<XblSuccess, AuthError> {

    let req = json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={ms_auth_token}"),
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let res = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&req)
        .send().await
        .map_err(AuthError::new_reqwest)?;

    match res.status() {
        StatusCode::OK => Ok(res.json::<XblSuccess>().await.map_err(AuthError::new_reqwest)?),
        status => return Err(AuthError::InvalidStatus(status.as_u16())),
    }

}

async fn request_xbl_xsts(
    client: &Client, 
    xbl_user_token: &str,
) -> Result<XblSuccess, AuthError> {

    let req = json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_user_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let res = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&req)
        .send().await
        .map_err(AuthError::new_reqwest)?;

    match res.status() {
        StatusCode::OK => Ok(res.json::<XblSuccess>().await.map_err(AuthError::new_reqwest)?),
        StatusCode::UNAUTHORIZED => {
            let res = res.json::<XblError>().await.map_err(AuthError::new_reqwest)?;
            return Err(AuthError::Unknown(res.message));
        }
        status => return Err(AuthError::InvalidStatus(status.as_u16())),
    }

}

async fn request_minecraft_with_xbl(
    client: &Client, 
    user_hash: &str, 
    xsts_token: &str,
) -> Result<MinecraftWithXblSuccess, AuthError> {

    let req = json!({
        "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}"),
    });

    let res = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&req)
        .send().await
        .map_err(AuthError::new_reqwest)?;

    let mc_res = match res.status() {
        StatusCode::OK => res.json::<MinecraftWithXblSuccess>().await.map_err(AuthError::new_reqwest)?,
        status => return Err(AuthError::InvalidStatus(status.as_u16())),
    };

    if mc_res.token_type != "Bearer" {
        return Err(AuthError::Unknown(format!("Unexpected token type: {}", mc_res.token_type)));
    }
    
    Ok(mc_res)

}

async fn request_minecraft_profile(
    client: &Client,
    access_token: &str,
) -> Result<MinecraftProfileSuccess, AuthError> {

    let res = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send().await
        .map_err(AuthError::new_reqwest)?;

    match res.status() {
        StatusCode::OK => Ok(res.json::<MinecraftProfileSuccess>().await.map_err(AuthError::new_reqwest)?),
        StatusCode::FORBIDDEN => return Err(AuthError::Unknown(format!("Forbidden access to api.minecraftservices.com, likely because the application lacks approval from Mojang, see https://minecraft.wiki/w/Microsoft_authentication."))),
        StatusCode::UNAUTHORIZED => return Err(AuthError::OutdatedToken),
        StatusCode::NOT_FOUND => return Err(AuthError::DoesNotOwnGame),
        status => return Err(AuthError::InvalidStatus(status.as_u16())),
    }

}

fn decode_jwt_without_validation<T>(token: &str) -> jsonwebtoken::errors::Result<TokenData<T>>
where 
    T: serde::de::DeserializeOwned,
{
    let key = DecodingKey::from_secret(&[]);
    let mut validation = Validation::default();
    validation.insecure_disable_signature_validation();
    validation.validate_aud = false;
    jsonwebtoken::decode(token, &key, &validation)
}

#[derive(thiserror::Error, Debug)]
#[non_exhaustive]
pub enum AuthError {
    #[error("declined")]
    Declined,
    #[error("timed out")]
    TimedOut,
    #[error("outdated token")]
    OutdatedToken,
    #[error("does not own the game")]
    DoesNotOwnGame,
    #[error("invalid status: {0}")]
    InvalidStatus(u16),
    #[error("unknown: {0}")]
    Unknown(String),
    #[error("internal: {0}")]
    Internal(#[source] Box<dyn std::error::Error + Send + Sync>),
}

impl AuthError {

    #[inline]
    fn new_reqwest(e: reqwest::Error) -> Self {
        Self::Internal(Box::new(e))
    }

    #[inline]
    fn new_jwt(e: jsonwebtoken::errors::Error) -> Self {
        Self::Internal(Box::new(e))
    }

}

#[derive(Debug, Clone, serde::Serialize)]
struct MsDeviceAuthRequest<'a> {
    client_id: &'a str,
    scope: &'a str,
    mkt: Option<&'a str>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MsDeviceAuthSuccess {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[allow(unused)]
    expires_in: u32,
    interval: u32,
    message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "grant_type")]
enum MsTokenRequest<'a> {
    #[serde(rename = "urn:ietf:params:oauth:grant-type:device_code")]
    DeviceCode {
        client_id: &'a str,
        device_code: &'a str,
    },
    #[serde(rename = "refresh_token")]
    RefreshToken {
        client_id: &'a str,
        scope: Option<&'a str>,
        refresh_token: &'a str,
        client_secret: Option<&'a str>,
    },
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MsTokenSuccess {
    token_type: String,
    scope: String,
    #[allow(unused)]
    expires_in: u32,
    access_token: String,
    #[allow(unused)]
    id_token: Option<String>,
    refresh_token: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MsAuthError {
    error: String,
    error_description: String,
    #[allow(unused)]
    trace_id: String,
    #[allow(unused)]
    correlation_id: String,
    #[allow(unused)]
    error_uri: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XblSuccess {
    display_claims: XblDisplayClaims,
    #[allow(unused)]
    issue_instant: String,
    #[allow(unused)]
    not_after: String,
    token: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct XblDisplayClaims {
    xui: Vec<XblXui>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
struct XblXui {
    uhs: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
#[allow(unused)]
struct XblError {
    identity: String,
    x_err: u32,
    message: String,
    redirect: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MinecraftWithXblSuccess {
    #[allow(unused)]
    username: String, 
    access_token: String,
    token_type: String,
    #[allow(unused)]
    expires_in: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MinecraftProfileSuccess {
    #[serde(with = "uuid::serde::simple")]
    id: Uuid,
    name: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(unused)]
struct OpenIdToken {
    nonce: Option<String>,
    email: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct MinecraftToken {
    xuid: String,
}

#[derive(Debug)]
pub struct Database {
    file: PathBuf,
}

impl Database {

    pub fn new<P: Into<PathBuf>>(file: P) -> Self {
        Self {
            file: file.into(),
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn load(&self) -> Result<Option<DatabaseData>, DatabaseError> {
        
        let reader = match File::open(&self.file) {
            Ok(reader) => reader,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let data = serde_json::from_reader::<_, DatabaseData>(BufReader::new(reader))
            .map_err(|e| DatabaseError::Corrupted.map_json_io(e))?;

        Ok(Some(data))
        
    }

    fn load_and_store<F, T>(&self, func: F) -> Result<T, DatabaseError>
    where
        F: for<'a> FnOnce(&'a mut DatabaseData, &'a mut bool) -> T,
    {

        if let Some(parent_dir) = self.file.parent() {
            fs::create_dir_all(parent_dir)?;
        }

        let mut rw = File::options()
            .write(true)
            .read(true)
            .create(true)
            .open(&self.file)?;

        let mut data;

        if rw.read(&mut [0; 1])? == 0 {
            data = DatabaseData { 
                accounts: Vec::new(),
            };
        } else {

            rw.rewind()?;

            data = serde_json::from_reader::<_, DatabaseData>(BufReader::new(&mut rw))
                .map_err(|e| DatabaseError::Corrupted.map_json_io(e))?;

        }

        let mut save = false;
        let ret = func(&mut data, &mut save);

        if save {

            rw.rewind()?;
            rw.set_len(0)?;
            
            serde_json::to_writer(BufWriter::new(rw), &data)
                .map_err(|_| DatabaseError::WriteFailed)?;

        }

        Ok(ret)

    }

    pub fn load_iter(&self) -> Result<DatabaseIter, DatabaseError> {
        self.load().map(|data| {
            DatabaseIter {
                raw: data.map(|data| data.accounts)
                    .unwrap_or_default()
                    .into_iter(),
            }
        })
    }
    
    pub fn load_from_uuid(&self, uuid: Uuid) -> Result<Option<Account>, DatabaseError> {
        self.load().map(|data| data.and_then(|data| {
            data.accounts.into_iter()
                .find(|acc| acc.uuid == uuid)
                .map(Account::from)
        }))
    }
    
    pub fn load_from_username(&self, username: &str) -> Result<Option<Account>, DatabaseError> {
        self.load().map(|data| data.and_then(|data| {
            data.accounts.into_iter()
                .find(|acc| acc.username == username)
                .map(Account::from)
        }))
    }

    pub fn remove_from_uuid(&self, uuid: Uuid) -> Result<Option<Account>, DatabaseError> {
        self.load_and_store(|data, save| {
            let index = data.accounts.iter().position(|acc| acc.uuid == uuid)?;
            *save = true;
            Some(data.accounts.remove(index).into())
        })
    }

    pub fn remove_from_username(&self, username: &str) -> Result<Option<Account>, DatabaseError> {
        self.load_and_store(|data, save| {
            let index = data.accounts.iter().position(|acc| acc.username == username)?;
            *save = true;
            Some(data.accounts.remove(index).into())
        })
    }

    pub fn store(&self, account: Account) -> Result<(), DatabaseError> {
        self.load_and_store(|data, save| {
            *save = true;
            if let Some(index) = data.accounts.iter().position(|acc| acc.uuid == account.uuid) {
                data.accounts[index] = account.into();
            } else {
                data.accounts.push(account.into());
            }
        })
    }

}

pub struct DatabaseIter {
    raw: std::vec::IntoIter<DatabaseDataAccount>,
}

impl FusedIterator for DatabaseIter {  }
impl ExactSizeIterator for DatabaseIter {  }
impl Iterator for DatabaseIter {

    type Item = Account;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        self.raw.next().map(Account::from)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.raw.size_hint()
    }

}

impl DoubleEndedIterator for DatabaseIter {
    
    #[inline]
    fn next_back(&mut self) -> Option<Self::Item> {
        self.raw.next_back().map(Account::from)
    }

}

#[derive(thiserror::Error, Debug)]
#[non_exhaustive]
pub enum DatabaseError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("corrupted")]
    Corrupted,
    #[error("write failed")]
    WriteFailed,
}

impl DatabaseError {

    fn map_json_io(self, value: serde_json::Error) -> Self {
        if let Some(kind) = value.io_error_kind() {
            Self::Io(kind.into())
        } else {
            self
        }
    }

}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DatabaseData {
    accounts: Vec<DatabaseDataAccount>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct DatabaseDataAccount {
    app_id: String,
    refresh_token: String,
    access_token: String,
    uuid: Uuid,
    username: String,
    xuid: String,
}

impl From<DatabaseDataAccount> for Account {
    fn from(value: DatabaseDataAccount) -> Self {
        Self {
            app_id: value.app_id,
            refresh_token: value.refresh_token,
            access_token: value.access_token,
            uuid: value.uuid,
            username: value.username,
            xuid: value.xuid,
        }
    }
}

impl From<Account> for DatabaseDataAccount {
    fn from(value: Account) -> Self {
        Self {
            app_id: value.app_id,
            refresh_token: value.refresh_token,
            access_token: value.access_token,
            uuid: value.uuid,
            username: value.username,
            xuid: value.xuid,
        }
    }
}
