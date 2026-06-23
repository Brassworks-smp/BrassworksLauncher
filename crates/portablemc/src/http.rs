
use reqwest::{Client, ClientBuilder};


pub const USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));

pub fn builder() -> ClientBuilder {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(30))
}

/// Build a fresh client for the caller.
///
/// Each download op runs inside its own short-lived current-thread tokio runtime
/// (see [`crate::tokio::sync`]), which is dropped when the op returns. A reqwest
/// `Client` keeps a connection pool whose hyper dispatch tasks are spawned on the
/// runtime that first drove it; if we cached one client process-wide and reused
/// it across those ephemeral runtimes, a later request could pick up a pooled
/// connection whose dispatch task died with an earlier runtime, failing with
/// `User(DispatchGone)` ("runtime dropped the dispatch task") or a truncated
/// `IncompleteMessage`. This is rare for a single sequential install but becomes
/// near-certain under concurrency. Building a fresh client per call keeps every
/// connection's lifetime contained within the one runtime that uses it.
pub fn client() -> reqwest::Result<Client> {
    builder().build()
}
