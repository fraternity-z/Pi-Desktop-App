use std::{
    env,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;

use crate::{
    bridge::supervisor::{BridgeLaunchConfig, BridgeSupervisor},
    discovery::{RuntimeDiscoveryOptions, RuntimeSource, discover_runtime},
    error::AppError,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub status: &'static str,
    pub runtime_source: Option<&'static str>,
    pub pi_version: Option<String>,
    pub node_version: Option<String>,
    pub error: Option<AppError>,
}

pub struct BridgeRuntime {
    supervisor: Mutex<Option<BridgeSupervisor>>,
    snapshot: RuntimeSnapshot,
}

impl BridgeRuntime {
    pub fn initialize(bridge_script: PathBuf) -> Self {
        match start_bridge(bridge_script) {
            Ok((supervisor, source)) => {
                let hello = supervisor.hello();
                let snapshot = RuntimeSnapshot {
                    status: "ready",
                    runtime_source: Some(source_label(&source)),
                    pi_version: Some(hello.pi_version.clone()),
                    node_version: Some(hello.node_version.clone()),
                    error: None,
                };
                Self {
                    supervisor: Mutex::new(Some(supervisor)),
                    snapshot,
                }
            }
            Err(error) => Self::unavailable(error),
        }
    }

    pub fn unavailable(error: AppError) -> Self {
        Self {
            supervisor: Mutex::new(None),
            snapshot: unavailable_snapshot(error),
        }
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        if self.snapshot.status != "ready" {
            return self.snapshot.clone();
        }

        let health = self
            .supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))
            .and_then(|mut value| {
                value
                    .as_mut()
                    .ok_or_else(|| AppError::new("BRIDGE_CLOSED", "Bridge supervisor 已关闭"))?
                    .health()
            });
        match health {
            Ok(()) => self.snapshot.clone(),
            Err(error) => unavailable_snapshot(error),
        }
    }

    pub fn bridge_status(&self) -> &'static str {
        self.snapshot().status
    }

    pub fn shutdown(&self) {
        let supervisor = self
            .supervisor
            .lock()
            .ok()
            .and_then(|mut value| value.take());
        if let Some(mut supervisor) = supervisor {
            let _ = supervisor.shutdown();
        }
    }
}

impl Drop for BridgeRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn start_bridge(bridge_script: PathBuf) -> Result<(BridgeSupervisor, RuntimeSource), AppError> {
    let runtime_paths = discover_runtime(&RuntimeDiscoveryOptions::default())?;
    let source = runtime_paths.source.clone();
    let agent_dir = system_agent_dir()?;
    let mut supervisor = BridgeSupervisor::start(BridgeLaunchConfig::new(
        runtime_paths.node_path,
        bridge_script,
        runtime_paths.sdk_root,
        agent_dir,
    ))?;
    if let Err(error) = supervisor.health() {
        let _ = supervisor.shutdown();
        return Err(error);
    }
    Ok((supervisor, source))
}

fn system_agent_dir() -> Result<PathBuf, AppError> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            AppError::new("AGENT_DIR_INVALID", "无法确定用户主目录以解析 ~/.pi/agent")
        })?;
    canonical_agent_dir(&home.join(".pi").join("agent"))
}

fn canonical_agent_dir(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "AGENT_DIR_INVALID",
            "Pi agentDir 必须是存在的绝对目录",
        ));
    }
    let path = std::fs::canonicalize(path)
        .map_err(|_| AppError::new("AGENT_DIR_INVALID", "Pi agentDir 不存在或无法访问"))?;
    if !path.is_dir() {
        return Err(AppError::new("AGENT_DIR_INVALID", "Pi agentDir 必须是目录"));
    }
    Ok(path)
}

fn source_label(source: &RuntimeSource) -> &'static str {
    match source {
        RuntimeSource::ExplicitPaths => "explicit-paths",
        RuntimeSource::ExplicitPiCommand => "explicit-pi-command",
        RuntimeSource::PathPiCommand => "path-pi-command",
    }
}

fn unavailable_snapshot(error: AppError) -> RuntimeSnapshot {
    RuntimeSnapshot {
        status: "unavailable",
        runtime_source: None,
        pi_version: None,
        node_version: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_runtime_exposes_stable_non_sensitive_snapshot() {
        let runtime =
            BridgeRuntime::unavailable(AppError::new("RUNTIME_NOT_FOUND", "未找到可用运行时"));

        let snapshot = runtime.snapshot();

        assert_eq!(runtime.bridge_status(), "unavailable");
        assert_eq!(snapshot.status, "unavailable");
        assert_eq!(snapshot.error.unwrap().code, "RUNTIME_NOT_FOUND");
        assert_eq!(snapshot.pi_version, None);
        assert_eq!(snapshot.node_version, None);
    }

    #[test]
    fn maps_runtime_source_to_public_label() {
        assert_eq!(
            source_label(&RuntimeSource::ExplicitPaths),
            "explicit-paths"
        );
        assert_eq!(
            source_label(&RuntimeSource::ExplicitPiCommand),
            "explicit-pi-command"
        );
        assert_eq!(
            source_label(&RuntimeSource::PathPiCommand),
            "path-pi-command"
        );
    }
}
