#![cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(unused))]

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("libfusefs-ffi supports only Linux and macOS");

mod error;
mod options;
mod registry;
mod workspace;

use napi::Result;
use napi_derive::napi;
use options::{validate_workspace_options, CreateWorkspaceOptions, IdMapEntry};
pub use workspace::{PlatformSupport, WorkspaceDescriptor};

#[napi]
pub fn native_support() -> PlatformSupport {
    workspace::native_support()
}

#[napi]
pub async fn create_workspace_native(
    options: CreateWorkspaceOptions,
) -> Result<WorkspaceDescriptor> {
    let validated = validate_workspace_options(options)?;
    workspace::create_workspace(validated).await
}

#[napi]
pub async fn close_workspace_native(id: String) -> Result<bool> {
    workspace::close_workspace(id).await
}

#[napi]
pub fn is_workspace_mounted_native(id: String) -> bool {
    workspace::workspace_is_mounted(id)
}

#[allow(dead_code)]
fn _type_markers(_: IdMapEntry) {}
