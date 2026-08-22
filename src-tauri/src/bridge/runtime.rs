use std::{
    env,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;

use crate::{
    bridge::{
        protocol::{
            AgentModel, AgentSessionSummary, CreatedSession, SessionConfiguration,
            SessionConfigurationUpdate,
        },
        supervisor::{
            BridgeEventSink, BridgeLaunchConfig, BridgeSupervisor, normalize_process_path,
        },
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
    snapshot: Mutex<RuntimeSnapshot>,
    launch: Option<RuntimeLaunchContext>,
    closed: AtomicBool,
}

#[derive(Clone)]
struct RuntimeLaunchContext {
    bridge_script: PathBuf,
    event_sink: BridgeEventSink,
}

impl BridgeRuntime {
    pub fn initialize(bridge_script: PathBuf, event_sink: BridgeEventSink) -> Self {
        let launch = RuntimeLaunchContext {
            bridge_script,
            event_sink,
        };
        match start_bridge(launch.bridge_script.clone(), launch.event_sink.clone()) {
            Ok((supervisor, source)) => {
                let snapshot = ready_snapshot(supervisor.hello(), &source);
                Self {
                    supervisor: Mutex::new(Some(Arc::new(supervisor))),
                    active_session: Mutex::new(None),
                    snapshot: Mutex::new(snapshot),
                    launch: Some(launch),
                    closed: AtomicBool::new(false),
                }
            }
            Err(error) => Self {
                supervisor: Mutex::new(None),
                active_session: Mutex::new(None),
                snapshot: Mutex::new(unavailable_snapshot(error)),
                launch: Some(launch),
                closed: AtomicBool::new(false),
            },
        }
    }

    pub fn unavailable(error: AppError) -> Self {
        Self {
            supervisor: Mutex::new(None),
            active_session: Mutex::new(None),
            snapshot: Mutex::new(unavailable_snapshot(error)),
            launch: None,
            closed: AtomicBool::new(false),
        }
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        match self.supervisor() {
            Ok(supervisor) => match supervisor.health() {
                Ok(()) => self.snapshot_value(),
                Err(error) => {
                    self.discard_supervisor(&supervisor, error);
                    let _ = self.supervisor();
                    self.snapshot_value()
                }
            },
            Err(_) => self.snapshot_value(),
        }
    }

    pub fn bridge_status(&self) -> &'static str {
        self.snapshot().status
    }

    pub fn create_session(&self, cwd: String) -> Result<CreatedSession, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let session = self.with_supervisor(|supervisor| supervisor.create_session(&cwd))?;
        validate_session_id(&session.session_id)?;
        *self
            .active_session
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))? =
            Some(session.session_id.clone());
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSessionSummary>, AppError> {
        self.with_supervisor(|supervisor| supervisor.list_sessions())
    }

    pub fn open_session(&self, session_path: String) -> Result<CreatedSession, AppError> {
        let session_path = canonical_session_path(Path::new(session_path.trim()))?;
        let session = self.with_supervisor(|supervisor| supervisor.open_session(&session_path))?;
        validate_session_id(&session.session_id)?;
        *self
            .active_session
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))? =
            Some(session.session_id.clone());
        Ok(session)
    }

    pub fn list_models(&self) -> Result<Vec<AgentModel>, AppError> {
        self.with_supervisor(|supervisor| supervisor.list_models())
    }

    pub fn configure_session(
        &self,
        session_id: String,
        update: SessionConfigurationUpdate,
    ) -> Result<SessionConfiguration, AppError> {
        validate_session_configuration_update(&update)?;
        self.ensure_active_session(&session_id)?;
        self.with_supervisor(|supervisor| {
            supervisor.configure_session(
                &session_id,
                update
                    .model
                    .as_ref()
                    .map(|model| (model.provider.as_str(), model.id.as_str())),
                update.thinking_level.as_deref(),
            )
        })
    }

    pub fn prompt(&self, session_id: String, text: String) -> Result<u64, AppError> {
        ensure_valid_prompt(&text)?;
        self.ensure_active_session(&session_id)?;
        self.with_supervisor(|supervisor| supervisor.prompt(&session_id, &text))
    }

    pub fn abort(&self, session_id: String) -> Result<(), AppError> {
        self.ensure_active_session(&session_id)?;
        self.with_supervisor(|supervisor| supervisor.abort(&session_id))
    }

    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
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
        if self.closed.load(Ordering::Acquire) {
            return Err(AppError::new("BRIDGE_CLOSED", "Pi Bridge 已关闭"));
        }
        let mut slot = self
            .supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?;
        if let Some(supervisor) = slot.as_ref() {
            return Ok(supervisor.clone());
        }
        let launch = self
            .launch
            .as_ref()
            .ok_or_else(|| AppError::new("BRIDGE_UNAVAILABLE", "Pi Bridge 当前不可用"))?;
        match start_bridge(launch.bridge_script.clone(), launch.event_sink.clone()) {
            Ok((supervisor, source)) => {
                let snapshot = ready_snapshot(supervisor.hello(), &source);
                let supervisor = Arc::new(supervisor);
                *slot = Some(supervisor.clone());
                self.set_snapshot(snapshot);
                Ok(supervisor)
            }
            Err(error) => {
                self.set_snapshot(unavailable_snapshot(error.clone()));
                Err(error)
            }
        }
    }

    fn discard_supervisor(&self, supervisor: &Arc<BridgeSupervisor>, error: AppError) {
        if let Ok(mut slot) = self.supervisor.lock()
            && slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, supervisor))
        {
            *slot = None;
        }
        if let Ok(mut active_session) = self.active_session.lock() {
            *active_session = None;
        }
        self.set_snapshot(unavailable_snapshot(error));
    }

    fn with_supervisor<T>(
        &self,
        operation: impl FnOnce(&BridgeSupervisor) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let supervisor = self.supervisor()?;
        match operation(&supervisor) {
            Err(error) if is_connection_failure(&error) => {
                self.discard_supervisor(&supervisor, error.clone());
                Err(error)
            }
            result => result,
        }
    }

    fn snapshot_value(&self) -> RuntimeSnapshot {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| {
                unavailable_snapshot(AppError::new("BRIDGE_STATE_POISONED", "运行时状态锁不可用"))
            })
    }

    fn set_snapshot(&self, snapshot: RuntimeSnapshot) {
        if let Ok(mut current) = self.snapshot.lock() {
            *current = snapshot;
        }
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
    Ok(normalize_process_path(path))
}

fn canonical_session_path(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return Err(AppError::new(
            "SESSION_PATH_INVALID",
            "会话路径必须是 Pi sessions 目录中的 JSONL 文件",
        ));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| AppError::new("SESSION_PATH_INVALID", "会话文件不存在或无法访问"))?;
    let sessions_root = std::fs::canonicalize(system_agent_dir()?.join("sessions"))
        .map_err(|_| AppError::new("SESSION_PATH_INVALID", "Pi sessions 目录不存在或无法访问"))?;
    if !canonical.is_file() || !canonical.starts_with(&sessions_root) {
        return Err(AppError::new(
            "SESSION_PATH_INVALID",
            "会话文件不在授权的 Pi sessions 目录中",
        ));
    }
    Ok(normalize_process_path(canonical))
}

fn validate_session_configuration_update(
    update: &SessionConfigurationUpdate,
) -> Result<(), AppError> {
    if update.model.is_none() && update.thinking_level.is_none() {
        return Err(AppError::new(
            "SESSION_CONFIG_INVALID",
            "会话配置至少需要一个变更项",
        ));
    }
    if let Some(model) = &update.model
        && (model.provider.trim().is_empty()
            || model.provider.len() > 128
            || model.id.trim().is_empty()
            || model.id.len() > 256)
    {
        return Err(AppError::new(
            "MODEL_SELECTION_INVALID",
            "模型 provider 或 id 无效",
        ));
    }
    if let Some(level) = update.thinking_level.as_deref()
        && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].contains(&level)
    {
        return Err(AppError::new(
            "THINKING_LEVEL_INVALID",
            "思考强度不是 Pi SDK 支持的值",
        ));
    }
    Ok(())
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

fn ready_snapshot(
    hello: &crate::bridge::protocol::BridgeHello,
    source: &RuntimeSource,
) -> RuntimeSnapshot {
    RuntimeSnapshot {
        status: "ready",
        runtime_source: Some(source_label(source)),
        pi_version: Some(hello.pi_version.clone()),
        node_version: Some(hello.node_version.clone()),
        error: None,
    }
}

fn is_connection_failure(error: &AppError) -> bool {
    matches!(
        error.code,
        "BRIDGE_CLOSED"
            | "BRIDGE_EXITED"
            | "BRIDGE_WRITE_FAILED"
            | "BRIDGE_STDOUT_INVALID"
            | "BRIDGE_INVALID_JSON"
            | "BRIDGE_EVENT_INVALID"
            | "BRIDGE_EVENT_SEQUENCE_INVALID"
            | "BRIDGE_RESPONSE_INVALID"
            | "BRIDGE_PROMPT_RESPONSE_INVALID"
            | "BRIDGE_FRAME_INVALID"
    )
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

    #[cfg(windows)]
    #[test]
    fn canonical_workspace_returns_node_compatible_windows_path() {
        let current_dir = std::env::current_dir().expect("测试工作目录应存在");

        let workspace = canonical_workspace(&current_dir).expect("测试工作目录应可规范化");

        assert!(!workspace.to_string_lossy().starts_with(r"\\?\"));
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

    #[test]
    fn validates_session_configuration_boundaries() {
        let valid = SessionConfigurationUpdate {
            model: None,
            thinking_level: Some("high".to_owned()),
        };
        assert_eq!(validate_session_configuration_update(&valid), Ok(()));

        let empty = SessionConfigurationUpdate {
            model: None,
            thinking_level: None,
        };
        assert_eq!(
            validate_session_configuration_update(&empty)
                .expect_err("空配置必须被拒绝")
                .code,
            "SESSION_CONFIG_INVALID"
        );

        let invalid_level = SessionConfigurationUpdate {
            model: None,
            thinking_level: Some("ultra".to_owned()),
        };
        assert_eq!(
            validate_session_configuration_update(&invalid_level)
                .expect_err("未知思考强度必须被拒绝")
                .code,
            "THINKING_LEVEL_INVALID"
        );
    }

    #[test]
    fn rejects_untrusted_session_paths_before_file_access() {
        assert_eq!(
            canonical_session_path(Path::new("relative.jsonl"))
                .expect_err("相对会话路径必须被拒绝")
                .code,
            "SESSION_PATH_INVALID"
        );
        assert_eq!(
            canonical_session_path(Path::new(r"C:\outside\session.txt"))
                .expect_err("非 JSONL 会话路径必须被拒绝")
                .code,
            "SESSION_PATH_INVALID"
        );
    }

    #[test]
    fn classifies_only_connection_failures_for_restart() {
        assert!(is_connection_failure(&AppError::new(
            "BRIDGE_EXITED",
            "Bridge 已退出"
        )));
        assert!(is_connection_failure(&AppError::new(
            "BRIDGE_EVENT_SEQUENCE_INVALID",
            "事件跳号"
        )));
        assert!(!is_connection_failure(&AppError::new(
            "SESSION_BUSY",
            "会话忙"
        )));
        assert!(!is_connection_failure(&AppError::new(
            "BRIDGE_TIMEOUT",
            "请求超时"
        )));
    }
}
