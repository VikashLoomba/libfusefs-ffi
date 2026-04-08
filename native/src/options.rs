use crate::error::{invalid_arg, ResultExt};
use napi_derive::napi;
use std::fs;
use std::path::{Path, PathBuf};

#[napi(object)]
#[derive(Debug, Clone)]
pub struct IdMapEntry {
    pub host: u32,
    pub to: u32,
    pub len: u32,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct CreateWorkspaceOptions {
    pub repo_path: String,
    pub mount_path: String,
    pub upper_path: String,
    pub privileged: Option<bool>,
    pub allow_other: Option<bool>,
    pub uid_map: Option<Vec<IdMapEntry>>,
    pub gid_map: Option<Vec<IdMapEntry>>,
}

#[derive(Debug, Clone)]
pub struct ValidatedWorkspaceOptions {
    pub repo_path: PathBuf,
    pub mount_path: PathBuf,
    pub upper_path: PathBuf,
    pub privileged: bool,
    pub allow_other: bool,
    pub mapping: Option<String>,
}

pub fn validate_workspace_options(
    options: CreateWorkspaceOptions,
) -> napi::Result<ValidatedWorkspaceOptions> {
    let repo_path = canonical_existing_dir(&options.repo_path, "repo_path")?;
    let mount_path = canonical_existing_dir(&options.mount_path, "mount_path")?;
    let upper_path = canonical_existing_dir(&options.upper_path, "upper_path")?;

    if mount_path == upper_path {
        return Err(invalid_arg(
            "mount_path and upper_path must resolve to different directories",
        ));
    }

    ensure_not_same_or_nested(&repo_path, &mount_path, "mount_path")?;
    ensure_not_same_or_nested(&repo_path, &upper_path, "upper_path")?;
    ensure_not_same_or_nested(&mount_path, &upper_path, "upper_path")?;
    ensure_empty_directory(&mount_path, "mount_path")?;

    let mapping = serialize_mapping(options.uid_map.as_deref(), options.gid_map.as_deref())?;

    Ok(ValidatedWorkspaceOptions {
        repo_path,
        mount_path,
        upper_path,
        privileged: options.privileged.unwrap_or(false),
        allow_other: options.allow_other.unwrap_or(false),
        mapping,
    })
}

fn canonical_existing_dir(raw: &str, field: &str) -> napi::Result<PathBuf> {
    let path = absolute_path(raw, field)?;
    let metadata = fs::metadata(&path).map_err(|err| {
        invalid_arg(format!(
            "{field} must point to an existing directory: {err}"
        ))
    })?;

    if !metadata.is_dir() {
        return Err(invalid_arg(format!("{field} must point to a directory")));
    }

    fs::canonicalize(&path).context(format!("failed to canonicalize {field}"))
}

fn absolute_path(raw: &str, field: &str) -> napi::Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid_arg(format!("{field} must be a non-empty path")));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()
            .context("failed to read current working directory")?
            .join(path))
    }
}

fn ensure_empty_directory(path: &Path, label: &str) -> napi::Result<()> {
    let mut entries = fs::read_dir(path).context(format!("failed to inspect {label}"))?;
    if let Some(entry) = entries.next() {
        let entry = entry.context(format!("failed to inspect {label}"))?;
        return Err(invalid_arg(format!(
            "{label} must be empty before mounting; found {}",
            entry.path().display()
        )));
    }

    Ok(())
}

fn ensure_not_same_or_nested(base: &Path, candidate: &Path, field: &str) -> napi::Result<()> {
    if candidate == base || candidate.starts_with(base) || base.starts_with(candidate) {
        return Err(invalid_arg(format!(
            "{field} must live outside the repo and other workspace directories",
        )));
    }

    Ok(())
}

fn serialize_mapping(
    uid_map: Option<&[IdMapEntry]>,
    gid_map: Option<&[IdMapEntry]>,
) -> napi::Result<Option<String>> {
    match (uid_map, gid_map) {
        (None, None) => Ok(None),
        (Some(_), None) | (None, Some(_)) => Err(invalid_arg(
            "uid_map and gid_map must either both be provided or both be omitted",
        )),
        (Some(uid_map), Some(gid_map)) => {
            #[cfg(target_os = "macos")]
            {
                let _ = (uid_map, gid_map);
                return Err(invalid_arg(
                    "uid_map and gid_map are currently supported only on Linux",
                ));
            }

            #[cfg(target_os = "linux")]
            {
                let uid = serialize_single_map("uidmapping", uid_map)?;
                let gid = serialize_single_map("gidmapping", gid_map)?;
                Ok(Some(format!("{uid},{gid}")))
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn serialize_single_map(name: &str, entries: &[IdMapEntry]) -> napi::Result<String> {
    if entries.is_empty() {
        return Err(invalid_arg(format!(
            "{name} must contain at least one mapping entry"
        )));
    }

    let mut encoded = Vec::with_capacity(entries.len() * 3);
    for entry in entries {
        if entry.len == 0 {
            return Err(invalid_arg(format!(
                "{name} entries must have len greater than zero"
            )));
        }

        encoded.push(entry.host.to_string());
        encoded.push(entry.to.to_string());
        encoded.push(entry.len.to_string());
    }

    Ok(format!("{name}={}", encoded.join(":")))
}
