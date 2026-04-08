use crate::error::{generic_error, ResultExt};
use crate::options::ValidatedWorkspaceOptions;
use crate::registry::{
    insert_workspace, is_workspace_mounted, remove_workspace, take_workspace, RegistryEntry,
    WorkerCommand, WorkspaceLifecycle,
};
use libfuse_fs::overlayfs::config::Config as OverlayConfig;
use libfuse_fs::overlayfs::CachePolicy as OverlayCachePolicy;
use libfuse_fs::overlayfs::OverlayFs;
use libfuse_fs::passthrough::{new_passthroughfs_layer, PassthroughArgs, PassthroughFs};
use napi_derive::napi;
use rfuse3::raw::{MountHandle, Session};
use rfuse3::MountOptions;
use std::ffi::OsString;
use std::path::Path;
use std::sync::atomic::AtomicU8;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

#[napi(object)]
#[derive(Debug, Clone)]
pub struct WorkspaceDescriptor {
    pub id: String,
    pub repo_path: String,
    pub mount_path: String,
    pub upper_path: String,
    pub platform: String,
    pub fs_kind: String,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct PlatformSupport {
    pub platform: String,
    pub supported: bool,
    pub reason: Option<String>,
}

pub fn native_support() -> PlatformSupport {
    let platform = std::env::consts::OS.to_string();
    let reason = runtime_support_reason();

    PlatformSupport {
        platform,
        supported: reason.is_none(),
        reason,
    }
}

fn runtime_support_reason() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        if !Path::new("/dev/fuse").exists() {
            return Some("/dev/fuse is not available; install and enable FUSE support".to_string());
        }

        return None;
    }

    #[cfg(target_os = "macos")]
    {
        if !Path::new("/dev/macfuse0").exists() && !Path::new("/dev/osxfuse0").exists() {
            return Some(
                "macFUSE device not found; install and load macFUSE before creating agent workspaces"
                    .to_string(),
            );
        }

        return None;
    }

    #[allow(unreachable_code)]
    Some("libfusefs-ffi supports only Linux and macOS".to_string())
}

pub async fn create_workspace(
    options: ValidatedWorkspaceOptions,
) -> napi::Result<WorkspaceDescriptor> {
    let id = Uuid::new_v4().to_string();
    let state = Arc::new(AtomicU8::new(WorkspaceLifecycle::Mounted as u8));
    let filesystem = build_overlay_filesystem(&options).await?;
    let mount_handle = mount_overlay_filesystem(filesystem, &options, &id).await?;

    let (control_tx, control_rx) = mpsc::channel(1);
    insert_workspace(
        id.clone(),
        RegistryEntry {
            control_tx,
            state: state.clone(),
        },
    );

    tokio::spawn(workspace_worker(
        id.clone(),
        mount_handle,
        control_rx,
        state,
        Instant::now(),
    ));

    Ok(WorkspaceDescriptor {
        id,
        repo_path: options.repo_path.display().to_string(),
        mount_path: options.mount_path.display().to_string(),
        upper_path: options.upper_path.display().to_string(),
        platform: std::env::consts::OS.to_string(),
        fs_kind: "overlayfs".to_string(),
    })
}

pub async fn close_workspace(id: String) -> napi::Result<bool> {
    let Some(entry) = take_workspace(&id) else {
        return Ok(false);
    };

    WorkspaceLifecycle::Closing.store(entry.state.as_ref());
    let (reply_tx, reply_rx) = oneshot::channel();

    if entry
        .control_tx
        .send(WorkerCommand::Unmount { reply: reply_tx })
        .await
        .is_err()
    {
        return Ok(false);
    }

    match reply_rx.await {
        Ok(Ok(())) => Ok(true),
        Ok(Err(message)) => Err(generic_error(format!(
            "failed to close workspace {id}: {message}"
        ))),
        Err(_) => Ok(false),
    }
}

pub fn workspace_is_mounted(id: String) -> bool {
    is_workspace_mounted(&id)
}

async fn build_overlay_filesystem(options: &ValidatedWorkspaceOptions) -> napi::Result<OverlayFs> {
    let lower =
        Arc::new(build_passthrough_layer(&options.repo_path, options.mapping.as_deref()).await?);
    let upper =
        Arc::new(build_passthrough_layer(&options.upper_path, options.mapping.as_deref()).await?);

    let config = OverlayConfig {
        mountpoint: options.mount_path.clone(),
        do_import: true,
        cache_policy: OverlayCachePolicy::Auto,
        ..Default::default()
    };

    OverlayFs::new(Some(upper), vec![lower], config, 1)
        .context("failed to initialize overlay filesystem")
}

async fn build_passthrough_layer(
    root_dir: &Path,
    mapping: Option<&str>,
) -> napi::Result<PassthroughFs> {
    new_passthroughfs_layer(PassthroughArgs { root_dir, mapping })
        .await
        .context("failed to initialize passthrough layer")
}

async fn mount_overlay_filesystem(
    filesystem: OverlayFs,
    options: &ValidatedWorkspaceOptions,
    id: &str,
) -> napi::Result<MountHandle> {
    let mut mount_options = MountOptions::default();
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };

    #[cfg(target_os = "linux")]
    mount_options.force_readdir_plus(true);

    mount_options
        .uid(uid)
        .gid(gid)
        .allow_other(options.allow_other);
    mount_options.fs_name(format!("agentfs-{id}"));

    let mount_path: OsString = OsString::from(options.mount_path.as_os_str());

    let session = Session::new(mount_options);
    let mount_result = if options.privileged {
        session.mount(filesystem, mount_path).await
    } else {
        session
            .mount_with_unprivileged(filesystem, mount_path)
            .await
    };

    mount_result.map_err(|err| {
        generic_error(format!(
            "failed to mount overlay filesystem at {}: {err}",
            options.mount_path.display()
        ))
    })
}

async fn workspace_worker(
    id: String,
    mut mount_handle: MountHandle,
    mut control_rx: mpsc::Receiver<WorkerCommand>,
    state: Arc<AtomicU8>,
    created_at: Instant,
) {
    let outcome: Result<(), String> = tokio::select! {
        result = &mut mount_handle => result.map_err(|error| error.to_string()),
        command = control_rx.recv() => {
            match command {
                Some(WorkerCommand::Unmount { reply }) => {
                    WorkspaceLifecycle::Closing.store(state.as_ref());
                    let result = graceful_unmount(mount_handle, created_at).await;
                    let _ = reply.send(result.clone());
                    result
                }
                None => Ok(()),
            }
        }
    };

    if outcome.is_ok() {
        WorkspaceLifecycle::Closed.store(state.as_ref());
    } else {
        WorkspaceLifecycle::Failed.store(state.as_ref());
    }

    remove_workspace(&id);
}

async fn graceful_unmount(mount_handle: MountHandle, created_at: Instant) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let minimum_lifetime = Duration::from_millis(300);
        let elapsed = created_at.elapsed();
        if elapsed < minimum_lifetime {
            tokio::time::sleep(minimum_lifetime - elapsed).await;
        }
    }

    mount_handle
        .unmount()
        .await
        .map_err(|error| error.to_string())
}
