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

    #[error("session expired")]
    Unauthorized,

    #[error("modpack error: {0}")]
    Modpack(String),

    #[error("remote request failed: {0}")]
    Remote(String),

    #[error("the operation was cancelled")]
    Cancelled,
}

#[cfg(test)]
mod error_tests {
    use super::CoreError;

    #[test]
    fn instance_messages() {
        assert_eq!(
            CoreError::InstanceNotFound("survival".into()).to_string(),
            "instance 'survival' was not found"
        );
        assert_eq!(
            CoreError::InstanceExists("creative".into()).to_string(),
            "an instance with id 'creative' already exists"
        );
        assert_eq!(
            CoreError::AlreadyRunning("hardcore".into()).to_string(),
            "instance 'hardcore' is already running"
        );
    }

    #[test]
    fn unit_variant_messages() {
        assert_eq!(
            CoreError::NoAccount.to_string(),
            "no account is configured; add an account before launching"
        );
        assert_eq!(
            CoreError::NoDataDir.to_string(),
            "could not resolve a data directory for the launcher"
        );
        assert_eq!(CoreError::Unauthorized.to_string(), "session expired");
        assert_eq!(CoreError::Cancelled.to_string(), "the operation was cancelled");
    }

    #[test]
    fn wrapped_string_messages() {
        assert_eq!(CoreError::Launch("boom".into()).to_string(), "the launcher process failed: boom");
        assert_eq!(CoreError::Auth("bad token".into()).to_string(), "authentication failed: bad token");
        assert_eq!(CoreError::Modpack("missing".into()).to_string(), "modpack error: missing");
        assert_eq!(CoreError::Remote("timeout".into()).to_string(), "remote request failed: timeout");
    }

    #[test]
    fn io_helper_carries_path() {
        let err = CoreError::io(
            "some/file.json",
            std::io::Error::new(std::io::ErrorKind::NotFound, "nope"),
        );
        let msg = err.to_string();
        assert!(msg.contains("some/file.json"));
        assert!(msg.starts_with("i/o error on"));
    }

    #[test]
    fn serde_helper_carries_what() {
        let parse: Result<i32, _> = serde_json::from_str("not a number");
        let err = CoreError::serde("settings", parse.unwrap_err());
        let msg = err.to_string();
        assert!(msg.contains("settings"));
        assert!(msg.starts_with("failed to (de)serialize"));
    }
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
