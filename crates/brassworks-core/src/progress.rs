use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchStage {
    Resolving,
    CheckingUpdates,
    SyncingModpack,
    LoadingVersion,
    Downloading,
    PreparingJvm,
    InstallingLoader,
    Launching,
    Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchProgress {
    pub instance_id: String,
    pub stage: LaunchStage,
    pub message: String,
    pub current: u64,
    pub total: u64,
}

impl LaunchProgress {
    pub(crate) fn new(
        instance_id: &str,
        stage: LaunchStage,
        message: impl Into<String>,
    ) -> Self {
        Self {
            instance_id: instance_id.to_string(),
            stage,
            message: message.into(),
            current: 0,
            total: 0,
        }
    }

    pub(crate) fn with_progress(mut self, current: u64, total: u64) -> Self {
        self.current = current;
        self.total = total;
        self
    }
}

pub type ProgressSink = dyn FnMut(LaunchProgress) + Send;
