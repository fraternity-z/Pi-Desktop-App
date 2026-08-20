use std::{
    env,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::Serialize;

use crate::{
    bridge::{
        protocol::CreatedSession,
        supervisor::{BridgeEventSink, BridgeLaunchConfig, BridgeSupervisor},
    },
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
    supervisor: Mutex<Option<Arc<BridgeSupervisor>>>,
    active_session: Mutex<Option<String>>,
    snapshot: RuntimeSnapshot,
}

impl BridgeRuntime {
    pub fn initialize(bridge_script: PathBuf, event_sink: BridgeEventSink) -> Self {
        match start_bridge(bridge_script, event_sink) {
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
                    supervisor: Mutex::new(Some(Arc::new(supervisor))),
                    active_session: Mutex::new(None),
                    snapshot,
                }
            }
            Err(error) => Self::unavailable(error),
        }
    }

    pub fn unavailable(error: AppError) -> Self {
        Self {
            supervisor: Mutex::new(None),
            active_session: Mutex::new(None),
            snapshot: unavailable_snapshot(error),
        }
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        if self.snapshot.status != "ready" {
            return self.snapshot.clone();
        }

        let health = self.supervisor().and_then(|supervisor| supervisor.health());
        match health {
            Ok(()) => self.snapshot.clone(),
            Err(error) => unavailable_snapshot(error),
        }
    }

    pub fn bridge_status(&self) -> &'static str {
        self.snapshot().status
    }

    pub fn create_session(&self, cwd: String) -> Result<CreatedSession, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let mut active_session = self
            .active_session
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))?;
        if active_session.is_some() {
            return Err(AppError::new(
                "SESSION_ALREADY_ACTIVE",
                "当前窗口已有活动会话",
            ));
        }

        let session = self.supervisor()?.create_session(&cwd)?;
        validate_session_id(&session.session_id)?;
        *active_session = Some(session.session_id.clone());
        Ok(session)
    }

    pub fn prompt(&self, session_id: String, text: String) -> Result<(), AppError> {
        ensure_valid_prompt(&text)?;
        self.ensure_active_session(&session_id)?;
        self.supervisor()?.prompt(&session_id, &text)
    }

    pub fn abort(&self, session_id: String) -> Result<(), AppError> {
        self.ensure_active_session(&session_id)?;
        self.supervisor()?.abort(&session_id)
    }

    pub fn shutdown(&self) {
        let supervisor = self
            .supervisor
            .lock()
            .ok()
            .and_then(|mut value| value.take());
        if let Some(supervisor) = supervisor {
            let _ = supervisor.shutdown();
        }
        if let Ok(mut active_session) = self.active_session.lock() {
            *active_session = None;
        }
    }

    fn supervisor(&self) -> Result<Arc<BridgeSupervisor>, AppError> {
        self.supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::new("BRIDGE_UNAVAILABLE", "Pi Bridge 当前不可用"))
    }

    fn ensure_active_session(&self, session_id: &str) -> Result<(), AppError> {
        validate_session_id(session_id)?;
        let active_session = self
            .active_session
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))?;
        match active_session.as_deref() {
            Some(active) if active == session_id => Ok(()),
            _ => Err(AppError::new(
                "SESSION_NOT_ACTIVE",
                "指定会话不是当前活动会话",
            )),
        }
    }
}

impl Drop for BridgeRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn start_bridge(
    bridge_script: PathBuf,
    event_sink: BridgeEventSink,
) -> Result<(BridgeSupervisor, RuntimeSource), AppError> {
    let runtime_paths = discover_runtime(&RuntimeDiscoveryOptions::default())?;
    let source = runtime_paths.source.clone();
    let agent_dir = system_agent_dir()?;
    let supervisor = BridgeSupervisor::start_with_event_sink(
        BridgeLaunchConfig::new(
            runtime_paths.node_path,
            bridge_script,
            runtime_paths.sdk_root,
            agent_dir,
        ),
        event_sink,
    )?;
    if let Err(error) = supervisor.health() {
        let _ = supervisor.shutdown();
        return Err(error);
    }
    Ok((supervisor, source))
}

fn canonical_workspace(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "WORKSPACE_PATH_INVALID",
            "工作区路径必须是存在的绝对目录",
        ));
    }
    let path = std::fs::canonicalize(path)
        .map_err(|_| AppError::new("WORKSPACE_PATH_INVALID", "工作区路径不存在或无法访问"))?;
    if !path.is_dir() {
        return Err(AppError::new(
            "WORKSPACE_PATH_INVALID",
            "工作区路径必须是目录",
        ));
    }
    Ok(path)
}

fn validate_session_id(session_id: &str) -> Result<(), AppError> {
    if session_id.trim().is_empty() || session_id.len() > 128 {
        return Err(AppError::new(
            "SESSION_ID_INVALID",
            "会话 id 必须为 1-128 个字符",
        ));
    }
    Ok(())
}

fn ensure_valid_prompt(text: &str) -> Result<(), AppError> {
    if text.trim().is_empty() || text.chars().count() > 200_000 {
        return Err(AppError::new(
            "PROMPT_INVALID",
            "提示内容必须为 1-200000 个字符",
        ));
    }
    Ok(())
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

    #[test]
    fn rejects_relative_workspace_path() {
        let error =
            canonical_workspace(Path::new("relative/path")).expect_err("相对工作区必须被拒绝");

        assert_eq!(error.code, "WORKSPACE_PATH_INVALID");
    }

    #[test]
    fn validates_prompt_boundaries() {
        assert_eq!(
            ensure_valid_prompt("  ")
                .expect_err("空白提示必须被拒绝")
                .code,
            "PROMPT_INVALID"
        );
        assert_eq!(ensure_valid_prompt("hello"), Ok(()));
        assert_eq!(
            ensure_valid_prompt(&"x".repeat(200_001))
                .expect_err("超长提示必须被拒绝")
                .code,
            "PROMPT_INVALID"
        );
    }
}
