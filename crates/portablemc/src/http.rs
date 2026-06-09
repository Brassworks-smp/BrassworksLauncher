
use once_cell::sync::OnceCell;
use reqwest::{Client, ClientBuilder};


pub const USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));

pub fn builder() -> ClientBuilder {
    Client::builder().user_agent(USER_AGENT)
}

pub fn client() -> reqwest::Result<Client> {
    static INSTANCE: OnceCell<Client> = OnceCell::new();
    let inst = INSTANCE.get_or_try_init(|| {
        builder().build()
    })?;
    Ok(inst.clone())
}
