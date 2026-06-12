use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use brassworks_core::Launcher;
use serde::Serialize;

use crate::discord::Discord;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) launcher: Launcher,
    pub(crate) running: Arc<Mutex<HashSet<String>>>,
    pub(crate) children: Arc<Mutex<HashMap<String, Child>>>,
    pub(crate) cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) discord: Arc<Discord>,
}

impl AppState {
    pub(crate) fn arm_cancel(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(id.to_string(), flag.clone());
        }
        flag
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct ExitInfo {
    pub(crate) instance_id: String,
    pub(crate) code: Option<i32>,
    pub(crate) error: Option<String>,
    pub(crate) cancelled: bool,
}

pub(crate) type CmdResult<T> = Result<T, String>;

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
