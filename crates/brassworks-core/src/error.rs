
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("i/o error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to (de)serialize {what}: {source}")]
    Serde {
        what: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("instance '{0}' was not found")]
    InstanceNotFound(String),

    #[error("an instance with id '{0}' already exists")]
    InstanceExists(String),

    #[error("no account is configured; add an account before launching")]
    NoAccount,

    #[error("could not resolve a data directory for the launcher")]
    NoDataDir,

    #[error("instance '{0}' is already running")]
    AlreadyRunning(String),

    #[error("the launcher process failed: {0}")]
    Launch(String),

    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("modpack error: {0}")]
    Modpack(String),

    #[error("remote request failed: {0}")]
    Remote(String),

    #[error("the operation was cancelled")]
    Cancelled,
}

impl CoreError {
    pub fn is_cancelled(&self) -> bool {
        matches!(self, CoreError::Cancelled)
    }
}

impl From<packwiz::PackwizError> for CoreError {
    fn from(e: packwiz::PackwizError) -> Self {
        match e {
            packwiz::PackwizError::Cancelled => CoreError::Cancelled,
            other => CoreError::Modpack(other.to_string()),
        }
    }
}

impl CoreError {
    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub(crate) fn serde(what: impl Into<String>, source: serde_json::Error) -> Self {
        Self::Serde {
            what: what.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
