#[derive(Debug, thiserror::Error)]
pub enum PackwizError {
    #[error("network error: {0}")]
    Http(String),

    #[error("failed to parse {what}: {source}")]
    Toml {
        what: String,
        #[source]
        source: toml::de::Error,
    },

    #[error("i/o error on {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("hash mismatch for {file}: expected {expected}, got {actual}")]
    HashMismatch {
        file: String,
        expected: String,
        actual: String,
    },

    #[error("unsupported download mode '{0}' — only Modrinth and direct URLs are supported")]
    UnsupportedMode(String),

    #[error("the operation was cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl PackwizError {
    pub(crate) fn http(e: impl std::fmt::Display) -> Self {
        Self::Http(e.to_string())
    }

    pub(crate) fn io(path: impl Into<String>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub(crate) fn toml(what: impl Into<String>, source: toml::de::Error) -> Self {
        Self::Toml {
            what: what.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, PackwizError>;
