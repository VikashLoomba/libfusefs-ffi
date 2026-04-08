use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

static REGISTRY: Lazy<Mutex<HashMap<String, RegistryEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
pub enum WorkerCommand {
    Unmount {
        reply: oneshot::Sender<Result<(), String>>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum WorkspaceLifecycle {
    Mounted = 1,
    Closing = 2,
    Closed = 3,
    Failed = 4,
}

impl WorkspaceLifecycle {
    pub fn store(self, state: &AtomicU8) {
        state.store(self as u8, Ordering::SeqCst);
    }

    pub fn load(state: &AtomicU8) -> Self {
        match state.load(Ordering::SeqCst) {
            1 => Self::Mounted,
            2 => Self::Closing,
            3 => Self::Closed,
            4 => Self::Failed,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug)]
pub struct RegistryEntry {
    pub control_tx: mpsc::Sender<WorkerCommand>,
    pub state: Arc<AtomicU8>,
}

pub fn insert_workspace(id: String, entry: RegistryEntry) {
    REGISTRY.lock().unwrap().insert(id, entry);
}

pub fn take_workspace(id: &str) -> Option<RegistryEntry> {
    REGISTRY.lock().unwrap().remove(id)
}

pub fn remove_workspace(id: &str) {
    REGISTRY.lock().unwrap().remove(id);
}

pub fn is_workspace_mounted(id: &str) -> bool {
    REGISTRY
        .lock()
        .unwrap()
        .get(id)
        .map(|entry| WorkspaceLifecycle::load(entry.state.as_ref()) == WorkspaceLifecycle::Mounted)
        .unwrap_or(false)
}
