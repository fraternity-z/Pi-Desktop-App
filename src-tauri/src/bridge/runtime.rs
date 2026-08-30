use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;

use crate::{
    bridge::{
        protocol::{
            AgentModel, AgentSessionSummary, CreatedSession, DeleteSessionsResult, PackageScope,
            PackageSummary, PackageUpdateInfo, PromptStreamingBehavior, RequestHeaderSettings,
            ResourceSummary, SessionConfiguration, SessionConfigurationUpdate, THINKING_LEVELS,
        },
        supervisor::{
            BridgeEventSink, BridgeFaultSink, BridgeLaunchConfig, BridgeSupervisor,
            normalize_process_path,
        },
    },
    discovery::{RuntimeDiscoveryOptions, RuntimePaths, RuntimeSource, discover_runtime},
    error::AppError,
    image::{
        MAX_PROMPT_IMAGE_BYTES, MAX_PROMPT_IMAGES, detect_image_format, image_format_for_path,
    },
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

pub type RuntimeStatusSink = Arc<dyn Fn(RuntimeSnapshot) + Send + Sync + 'static>;

pub struct BridgeRuntime {
    supervisor: Mutex<SupervisorSlot>,
    supervisor_ready: Condvar,
    runtime_paths: Mutex<Option<RuntimePaths>>,
    known_sessions: Mutex<HashSet<String>>,
    snapshot: Mutex<RuntimeSnapshot>,
    status_sink: RuntimeStatusSink,
    request_header_settings: Mutex<RequestHeaderSettings>,
    launch: Option<RuntimeLaunchContext>,
    closed: AtomicBool,
}

#[derive(Default)]
struct SupervisorSlot {
    supervisor: Option<Arc<BridgeSupervisor>>,
    starting: bool,
    attempt: u64,
    last_error: Option<AppError>,
}

#[derive(Clone)]
struct RuntimeLaunchContext {
    bridge_script: PathBuf,
    event_sink: BridgeEventSink,
    fault_sink: BridgeFaultSink,
}

impl BridgeRuntime {
    pub fn initialize(
        bridge_script: PathBuf,
        event_sink: BridgeEventSink,
        request_header_settings: RequestHeaderSettings,
    ) -> Self {
        Self::initialize_with_sinks(
            bridge_script,
            event_sink,
            Arc::new(|_| {}),
            Arc::new(|_| {}),
            request_header_settings,
        )
    }

    pub fn initialize_with_fault_sink(
        bridge_script: PathBuf,
        event_sink: BridgeEventSink,
        fault_sink: BridgeFaultSink,
        request_header_settings: RequestHeaderSettings,
    ) -> Self {
        Self::initialize_with_sinks(
            bridge_script,
            event_sink,
            fault_sink,
            Arc::new(|_| {}),
            request_header_settings,
        )
    }

    pub fn initialize_with_sinks(
        bridge_script: PathBuf,
        event_sink: BridgeEventSink,
        fault_sink: BridgeFaultSink,
        status_sink: RuntimeStatusSink,
        request_header_settings: RequestHeaderSettings,
    ) -> Self {
        let launch = RuntimeLaunchContext {
            bridge_script,
            event_sink,
            fault_sink,
        };
        Self {
            supervisor: Mutex::new(SupervisorSlot::default()),
            supervisor_ready: Condvar::new(),
            runtime_paths: Mutex::new(None),
            known_sessions: Mutex::new(HashSet::new()),
            snapshot: Mutex::new(starting_snapshot()),
            status_sink,
            request_header_settings: Mutex::new(request_header_settings),
            launch: Some(launch),
            closed: AtomicBool::new(false),
        }
    }

    pub fn unavailable(error: AppError, request_header_settings: RequestHeaderSettings) -> Self {
        Self {
            supervisor: Mutex::new(SupervisorSlot::default()),
            supervisor_ready: Condvar::new(),
            runtime_paths: Mutex::new(None),
            known_sessions: Mutex::new(HashSet::new()),
            snapshot: Mutex::new(unavailable_snapshot(error)),
            status_sink: Arc::new(|_| {}),
            request_header_settings: Mutex::new(request_header_settings),
            launch: None,
            closed: AtomicBool::new(false),
        }
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot_value()
    }

    pub(crate) fn warm_up(&self) -> RuntimeSnapshot {
        let _ = self.supervisor();
        self.snapshot_value()
    }

    pub fn restart(&self) -> RuntimeSnapshot {
        let supervisor = self
            .supervisor
            .lock()
            .ok()
            .and_then(|mut slot| slot.supervisor.take());
        if let Some(supervisor) = supervisor {
            let _ = supervisor.shutdown();
        }
        if let Ok(mut known_sessions) = self.known_sessions.lock() {
            known_sessions.clear();
        }
        self.set_snapshot(starting_snapshot());
        let _ = self.supervisor();
        self.snapshot_value()
    }

    pub fn bridge_status(&self) -> &'static str {
        self.snapshot().status
    }

    pub fn create_session(&self, cwd: String) -> Result<CreatedSession, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let session = self.with_supervisor(|supervisor| supervisor.create_session(&cwd))?;
        validate_session_id(&session.session_id)?;
        self.remember_session(&session.session_id)?;
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSessionSummary>, AppError> {
        self.with_supervisor(|supervisor| supervisor.list_sessions())
    }

    pub fn delete_sessions(
        &self,
        session_ids: Vec<String>,
    ) -> Result<DeleteSessionsResult, AppError> {
        let session_ids = validate_session_ids(&session_ids)?;
        let result = self.with_supervisor(|supervisor| supervisor.delete_sessions(&session_ids))?;
        if let Ok(mut known_sessions) = self.known_sessions.lock() {
            for session_id in &session_ids {
                known_sessions.remove(session_id.trim());
            }
        }
        Ok(result)
    }

    pub fn open_session(&self, session_path: String) -> Result<CreatedSession, AppError> {
        let session_path = canonical_session_path(Path::new(session_path.trim()))?;
        let session = self.with_supervisor(|supervisor| supervisor.open_session(&session_path))?;
        validate_session_id(&session.session_id)?;
        self.remember_session(&session.session_id)?;
        Ok(session)
    }

    pub fn list_models(&self) -> Result<Vec<AgentModel>, AppError> {
        self.with_supervisor(|supervisor| supervisor.list_models())
    }

    pub fn list_packages(&self, cwd: String) -> Result<Vec<PackageSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        self.with_supervisor(|supervisor| supervisor.list_packages(&cwd))
    }

    pub fn install_package(
        &self,
        cwd: String,
        source: String,
        scope: PackageScope,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let source = validate_package_source(&source)?;
        self.with_supervisor(|supervisor| supervisor.install_package(&cwd, source, &scope))
    }

    pub fn set_package_enabled(
        &self,
        cwd: String,
        source: String,
        scope: PackageScope,
        enabled: bool,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let source = validate_package_source(&source)?;
        self.with_supervisor(|supervisor| {
            supervisor.set_package_enabled(&cwd, source, &scope, enabled)
        })
    }

    pub fn remove_package(
        &self,
        cwd: String,
        source: String,
        scope: PackageScope,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let source = validate_package_source(&source)?;
        self.with_supervisor(|supervisor| supervisor.remove_package(&cwd, source, &scope))
    }

    pub fn update_package(
        &self,
        cwd: String,
        source: Option<String>,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        let source = source.as_deref().map(validate_package_source).transpose()?;
        self.with_supervisor(|supervisor| supervisor.update_package(&cwd, source))
    }

    pub fn check_package_updates(&self, cwd: String) -> Result<Vec<PackageUpdateInfo>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        self.with_supervisor(|supervisor| supervisor.check_package_updates(&cwd))
    }

    pub fn list_resources(&self, cwd: String) -> Result<Vec<ResourceSummary>, AppError> {
        let cwd = canonical_workspace(Path::new(cwd.trim()))?;
        self.with_supervisor(|supervisor| supervisor.list_resources(&cwd))
    }

    pub fn configure_request_headers(
        &self,
        settings: RequestHeaderSettings,
    ) -> Result<RequestHeaderSettings, AppError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(AppError::new("BRIDGE_CLOSED", "Pi Bridge 已关闭"));
        }
        let previous = {
            let mut current = self
                .request_header_settings
                .lock()
                .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "请求头客户端设置锁不可用"))?;
            std::mem::replace(&mut *current, settings.clone())
        };
        let supervisor = self
            .supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?
            .supervisor
            .clone();
        if let Some(supervisor) = supervisor
            && let Err(error) = supervisor.configure_request_headers(&settings)
        {
            if let Ok(mut current) = self.request_header_settings.lock() {
                *current = previous;
            }
            if should_discard_supervisor(&error, &supervisor) {
                self.discard_supervisor(&supervisor, error.clone());
            }
            return Err(error);
        }
        Ok(settings)
    }

    pub fn configure_session(
        &self,
        session_id: String,
        update: SessionConfigurationUpdate,
    ) -> Result<SessionConfiguration, AppError> {
        validate_session_configuration_update(&update)?;
        self.ensure_known_session(&session_id)?;
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

    pub fn prompt(
        &self,
        session_id: String,
        text: String,
        streaming_behavior: Option<PromptStreamingBehavior>,
        active_tools: Option<Vec<String>>,
        image_paths: Option<Vec<String>>,
        image_root: Option<PathBuf>,
    ) -> Result<u64, AppError> {
        ensure_valid_prompt(&text)?;
        validate_active_tools(active_tools.as_deref())?;
        let image_paths =
            validate_prompt_image_paths(image_paths.as_deref(), image_root.as_deref())?;
        self.ensure_known_session(&session_id)?;
        self.with_supervisor(|supervisor| {
            supervisor.prompt(
                &session_id,
                &text,
                streaming_behavior.as_ref(),
                active_tools.as_deref(),
                image_paths.as_deref(),
            )
        })
    }

    pub fn clear_queue(&self, session_id: String) -> Result<(), AppError> {
        self.ensure_known_session(&session_id)?;
        self.with_supervisor(|supervisor| supervisor.clear_queue(&session_id))
    }

    pub fn abort(&self, session_id: String) -> Result<(), AppError> {
        self.ensure_known_session(&session_id)?;
        self.with_supervisor(|supervisor| supervisor.abort(&session_id))
    }

    pub fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        let supervisor = self
            .supervisor
            .lock()
            .ok()
            .and_then(|mut slot| slot.supervisor.take());
        if let Some(supervisor) = supervisor {
            let _ = supervisor.shutdown();
        }
        if let Ok(mut known_sessions) = self.known_sessions.lock() {
            known_sessions.clear();
        }
    }

    fn supervisor(&self) -> Result<Arc<BridgeSupervisor>, AppError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(AppError::new("BRIDGE_CLOSED", "Pi Bridge 已关闭"));
        }
        let launch = self
            .launch
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::new("BRIDGE_UNAVAILABLE", "Pi Bridge 当前不可用"))?;
        let request_header_settings = self
            .request_header_settings
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "请求头客户端设置锁不可用"))?
            .clone();
        let mut slot = self
            .supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?;
        if let Some(supervisor) = slot.supervisor.as_ref() {
            return Ok(supervisor.clone());
        }

        if slot.starting {
            loop {
                slot = self.supervisor_ready.wait(slot).map_err(|_| {
                    AppError::new("BRIDGE_STATE_POISONED", "Bridge 启动等待锁不可用")
                })?;
                if let Some(supervisor) = slot.supervisor.as_ref() {
                    return Ok(supervisor.clone());
                }
                if !slot.starting {
                    return Err(slot.last_error.clone().unwrap_or_else(|| {
                        AppError::new("BRIDGE_START_FAILED", "Pi Bridge 启动失败")
                    }));
                }
            }
        }

        slot.starting = true;
        slot.attempt = slot.attempt.wrapping_add(1);
        slot.last_error = None;
        let attempt = slot.attempt;
        drop(slot);
        self.set_snapshot(starting_snapshot());

        let started = self.start_bridge_cached(&launch, &request_header_settings);
        let mut slot = self
            .supervisor
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?;
        if slot.attempt != attempt {
            self.supervisor_ready.notify_all();
            return Err(AppError::new(
                "BRIDGE_STATE_INVALID",
                "Bridge 启动状态发生了意外变化",
            ));
        }

        slot.starting = false;
        let result = match started {
            Ok((supervisor, source)) if !self.closed.load(Ordering::Acquire) => {
                let snapshot = ready_snapshot(supervisor.hello(), &source);
                let supervisor = Arc::new(supervisor);
                slot.supervisor = Some(supervisor.clone());
                slot.last_error = None;
                Ok((supervisor, snapshot))
            }
            Ok((supervisor, _)) => {
                let _ = supervisor.shutdown();
                let error = AppError::new("BRIDGE_CLOSED", "Pi Bridge 已关闭");
                slot.last_error = Some(error.clone());
                Err(error)
            }
            Err(error) => {
                slot.last_error = Some(error.clone());
                Err(error)
            }
        };
        self.supervisor_ready.notify_all();
        drop(slot);

        match result {
            Ok((supervisor, snapshot)) => {
                self.set_snapshot(snapshot);
                Ok(supervisor)
            }
            Err(error) => {
                self.set_snapshot(unavailable_snapshot(error.clone()));
                Err(error)
            }
        }
    }

    fn start_bridge_cached(
        &self,
        launch: &RuntimeLaunchContext,
        request_header_settings: &RequestHeaderSettings,
    ) -> Result<(BridgeSupervisor, RuntimeSource), AppError> {
        start_with_cached_runtime_paths(
            &self.runtime_paths,
            || discover_runtime(&RuntimeDiscoveryOptions::default()),
            |runtime_paths| start_bridge_with_paths(runtime_paths, launch, request_header_settings),
        )
    }

    fn discard_supervisor(&self, supervisor: &Arc<BridgeSupervisor>, error: AppError) {
        if let Ok(mut slot) = self.supervisor.lock()
            && slot
                .supervisor
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, supervisor))
        {
            slot.supervisor = None;
            slot.last_error = Some(error.clone());
        }
        if let Ok(mut known_sessions) = self.known_sessions.lock() {
            known_sessions.clear();
        }
        self.set_snapshot(unavailable_snapshot(error));
    }

    fn with_supervisor<T>(
        &self,
        operation: impl FnOnce(&BridgeSupervisor) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let supervisor = self.supervisor()?;
        match operation(&supervisor) {
            Err(error) if should_discard_supervisor(&error, &supervisor) => {
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
            *current = snapshot.clone();
            drop(current);
            (self.status_sink)(snapshot);
        }
    }

    fn remember_session(&self, session_id: &str) -> Result<(), AppError> {
        self.known_sessions
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))?
            .insert(session_id.to_owned());
        Ok(())
    }

    fn ensure_known_session(&self, session_id: &str) -> Result<(), AppError> {
        validate_session_id(session_id)?;
        let known_sessions = self
            .known_sessions
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "会话状态锁不可用"))?;
        if known_sessions.contains(session_id) {
            Ok(())
        } else {
            Err(AppError::new(
                "SESSION_NOT_OPEN",
                "指定会话尚未在当前运行时中打开",
            ))
        }
    }
}

impl Drop for BridgeRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn start_with_cached_runtime_paths<T>(
    cache: &Mutex<Option<RuntimePaths>>,
    discover: impl FnOnce() -> Result<RuntimePaths, AppError>,
    mut start: impl FnMut(RuntimePaths) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let cached = cache
        .lock()
        .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "运行时路径缓存锁不可用"))?
        .clone();
    if let Some(runtime_paths) = cached {
        match start(runtime_paths) {
            Ok(started) => return Ok(started),
            Err(_) => {
                if let Ok(mut cached) = cache.lock() {
                    *cached = None;
                }
            }
        }
    }

    let runtime_paths = discover()?;
    let started = start(runtime_paths.clone())?;
    if let Ok(mut cached) = cache.lock() {
        *cached = Some(runtime_paths);
    }
    Ok(started)
}

fn start_bridge_with_paths(
    runtime_paths: RuntimePaths,
    launch: &RuntimeLaunchContext,
    request_header_settings: &RequestHeaderSettings,
) -> Result<(BridgeSupervisor, RuntimeSource), AppError> {
    let source = runtime_paths.source.clone();
    let agent_dir = system_agent_dir()?;
    let supervisor = BridgeSupervisor::start_with_sinks(
        BridgeLaunchConfig::new(
            runtime_paths.node_path,
            launch.bridge_script.clone(),
            runtime_paths.sdk_root,
            agent_dir,
        ),
        launch.event_sink.clone(),
        launch.fault_sink.clone(),
    )?;
    if request_headers_need_startup_sync(request_header_settings)
        && let Err(error) = supervisor.configure_request_headers(request_header_settings)
    {
        let _ = supervisor.shutdown();
        return Err(error);
    }
    Ok((supervisor, source))
}

fn request_headers_need_startup_sync(settings: &RequestHeaderSettings) -> bool {
    settings.enabled
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
        && !THINKING_LEVELS.contains(&level)
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

fn validate_session_ids(session_ids: &[String]) -> Result<Vec<String>, AppError> {
    if session_ids.is_empty() || session_ids.len() > 1024 {
        return Err(AppError::new(
            "SESSION_IDS_INVALID",
            "会话 id 数量必须为 1-1024 项",
        ));
    }
    let mut unique = HashSet::new();
    let mut normalized = Vec::with_capacity(session_ids.len());
    for session_id in session_ids {
        validate_session_id(session_id)?;
        let trimmed = session_id.trim();
        if session_id.contains(['\r', '\n', '\0'])
            || trimmed.is_empty()
            || !unique.insert(trimmed.to_owned())
        {
            return Err(AppError::new(
                "SESSION_IDS_INVALID",
                "会话 id 包含换行、空字符或重复值",
            ));
        }
        normalized.push(trimmed.to_owned());
    }
    Ok(normalized)
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

fn validate_prompt_image_paths(
    image_paths: Option<&[String]>,
    image_root: Option<&Path>,
) -> Result<Option<Vec<String>>, AppError> {
    let Some(image_paths) = image_paths else {
        return Ok(None);
    };
    if image_paths.is_empty() || image_paths.len() > MAX_PROMPT_IMAGES {
        return Err(AppError::new(
            "PROMPT_IMAGE_COUNT_INVALID",
            format!("图片数量必须为 1-{MAX_PROMPT_IMAGES} 张"),
        ));
    }
    let image_root = image_root.ok_or_else(|| {
        AppError::new(
            "PROMPT_IMAGE_PATH_INVALID",
            "图片路径不在应用授权的缓存目录中",
        )
    })?;
    let image_root = std::fs::canonicalize(image_root).map_err(|_| {
        AppError::new(
            "PROMPT_IMAGE_PATH_INVALID",
            "图片路径不在应用授权的缓存目录中",
        )
    })?;

    let mut unique = HashSet::new();
    let mut normalized = Vec::with_capacity(image_paths.len());
    for image_path in image_paths {
        let image_path = image_path.trim();
        if image_path.is_empty()
            || image_path.chars().count() > 4_096
            || image_path.contains(['\r', '\n', '\0'])
        {
            return Err(AppError::new(
                "PROMPT_IMAGE_PATH_INVALID",
                "图片路径必须为不含换行或空字符的绝对路径",
            ));
        }
        let image_path = Path::new(image_path);
        if !image_path.is_absolute() {
            return Err(AppError::new(
                "PROMPT_IMAGE_PATH_INVALID",
                "图片路径必须为不含换行或空字符的绝对路径",
            ));
        }
        let expected_format = image_format_for_path(image_path).ok_or_else(|| {
            AppError::new(
                "PROMPT_IMAGE_TYPE_UNSUPPORTED",
                "仅支持 PNG、JPEG、GIF 或 WebP 图片",
            )
        })?;
        let canonical = std::fs::canonicalize(image_path).map_err(|_| {
            AppError::new(
                "PROMPT_IMAGE_READ_FAILED",
                "图片不存在、无法访问或不是普通文件",
            )
        })?;
        if !canonical.starts_with(&image_root) {
            return Err(AppError::new(
                "PROMPT_IMAGE_PATH_INVALID",
                "图片路径不在应用授权的缓存目录中",
            ));
        }
        let metadata = std::fs::metadata(&canonical).map_err(|_| {
            AppError::new(
                "PROMPT_IMAGE_READ_FAILED",
                "图片不存在、无法访问或不是普通文件",
            )
        })?;
        if !metadata.is_file() {
            return Err(AppError::new(
                "PROMPT_IMAGE_READ_FAILED",
                "图片不存在、无法访问或不是普通文件",
            ));
        }
        if metadata.len() == 0 {
            return Err(AppError::new("PROMPT_IMAGE_EMPTY", "图片文件不能为空"));
        }
        if metadata.len() > MAX_PROMPT_IMAGE_BYTES {
            return Err(AppError::new(
                "PROMPT_IMAGE_TOO_LARGE",
                "单张图片不能超过 10 MiB",
            ));
        }
        let bytes = std::fs::read(&canonical)
            .map_err(|_| AppError::new("PROMPT_IMAGE_READ_FAILED", "图片文件无法读取"))?;
        if bytes.is_empty() {
            return Err(AppError::new("PROMPT_IMAGE_EMPTY", "图片文件不能为空"));
        }
        if bytes.len() as u64 > MAX_PROMPT_IMAGE_BYTES {
            return Err(AppError::new(
                "PROMPT_IMAGE_TOO_LARGE",
                "单张图片不能超过 10 MiB",
            ));
        }
        if detect_image_format(&bytes) != Some(expected_format) {
            return Err(AppError::new(
                "PROMPT_IMAGE_TYPE_UNSUPPORTED",
                "图片内容与扩展名不匹配，或格式不受支持",
            ));
        }
        let canonical = normalize_process_path(canonical);
        if !unique.insert(canonical.clone()) {
            return Err(AppError::new(
                "PROMPT_IMAGE_PATH_INVALID",
                "图片列表包含重复路径",
            ));
        }
        normalized.push(canonical.to_string_lossy().into_owned());
    }
    Ok(Some(normalized))
}

fn validate_active_tools(active_tools: Option<&[String]>) -> Result<(), AppError> {
    let Some(active_tools) = active_tools else {
        return Ok(());
    };
    if active_tools.len() > 256 {
        return Err(AppError::new(
            "TOOL_SELECTION_INVALID",
            "工具权限最多包含 256 个工具",
        ));
    }
    let mut names = std::collections::HashSet::new();
    if active_tools.iter().any(|name| {
        name.trim().is_empty()
            || name.chars().count() > 128
            || name.contains(['\r', '\n', '\0'])
            || !names.insert(name)
    }) {
        return Err(AppError::new(
            "TOOL_SELECTION_INVALID",
            "工具权限包含无效或重复的工具名称",
        ));
    }
    Ok(())
}

fn validate_package_source(source: &str) -> Result<&str, AppError> {
    let source = source.trim();
    if source.is_empty() || source.chars().count() > 4096 || source.contains(['\r', '\n', '\0']) {
        return Err(AppError::new(
            "PACKAGE_SOURCE_INVALID",
            "插件来源必须为 1-4096 个不含换行或空字符的字符",
        ));
    }
    Ok(source)
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

fn starting_snapshot() -> RuntimeSnapshot {
    RuntimeSnapshot {
        status: "starting",
        runtime_source: None,
        pi_version: None,
        node_version: None,
        error: None,
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
            | "BRIDGE_TIMEOUT"
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

fn should_discard_supervisor(error: &AppError, supervisor: &BridgeSupervisor) -> bool {
    is_connection_failure(error)
        && (error.code != "BRIDGE_TIMEOUT" || supervisor.connection_faulted())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    #[test]
    fn unavailable_runtime_exposes_stable_non_sensitive_snapshot() {
        let runtime = BridgeRuntime::unavailable(
            AppError::new("RUNTIME_NOT_FOUND", "未找到可用运行时"),
            RequestHeaderSettings::default(),
        );

        let snapshot = runtime.snapshot();

        assert_eq!(runtime.bridge_status(), "unavailable");
        assert_eq!(snapshot.status, "unavailable");
        assert_eq!(snapshot.error.unwrap().code, "RUNTIME_NOT_FOUND");
        assert_eq!(snapshot.pi_version, None);
        assert_eq!(snapshot.node_version, None);
    }

    #[test]
    fn initialized_runtime_defers_bridge_startup() {
        let runtime = BridgeRuntime::initialize(
            PathBuf::from("missing-bridge.mjs"),
            Arc::new(|_| {}),
            RequestHeaderSettings::default(),
        );

        assert!(runtime.supervisor.lock().unwrap().supervisor.is_none());
        let snapshot = runtime.snapshot_value();
        assert_eq!(snapshot.status, "starting");
        assert_eq!(snapshot.error, None);
    }

    #[test]
    fn warm_up_preserves_a_stable_unavailable_snapshot() {
        let runtime = BridgeRuntime::unavailable(
            AppError::new("RUNTIME_NOT_FOUND", "未找到可用运行时"),
            RequestHeaderSettings::default(),
        );

        let snapshot = runtime.warm_up();

        assert_eq!(snapshot.status, "unavailable");
        assert_eq!(snapshot.error.unwrap().code, "RUNTIME_NOT_FOUND");
    }

    #[test]
    fn startup_syncs_request_headers_only_when_enabled() {
        assert!(!request_headers_need_startup_sync(
            &RequestHeaderSettings::default()
        ));
        assert!(!request_headers_need_startup_sync(&RequestHeaderSettings {
            enabled: false,
            client: crate::bridge::protocol::RequestHeaderClient::Codex,
        }));
        assert!(request_headers_need_startup_sync(&RequestHeaderSettings {
            enabled: true,
            client: crate::bridge::protocol::RequestHeaderClient::ClaudeCode,
        }));
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
    fn reuses_valid_runtime_paths_without_rediscovery() {
        let paths = test_runtime_paths("cached");
        let cache = Mutex::new(Some(paths.clone()));
        let discoveries = AtomicUsize::new(0);

        let started = start_with_cached_runtime_paths(
            &cache,
            || {
                discoveries.fetch_add(1, Ordering::Relaxed);
                Ok(test_runtime_paths("unexpected"))
            },
            Ok,
        )
        .expect("有效缓存应直接启动");

        assert_eq!(started, paths);
        assert_eq!(discoveries.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn invalidates_failed_runtime_paths_and_rediscovers_once() {
        let stale = test_runtime_paths("stale");
        let fresh = test_runtime_paths("fresh");
        let cache = Mutex::new(Some(stale.clone()));
        let discoveries = AtomicUsize::new(0);
        let starts = AtomicUsize::new(0);

        let started = start_with_cached_runtime_paths(
            &cache,
            || {
                discoveries.fetch_add(1, Ordering::Relaxed);
                Ok(fresh.clone())
            },
            |paths| {
                starts.fetch_add(1, Ordering::Relaxed);
                if paths == stale {
                    Err(AppError::new("BRIDGE_SPAWN_FAILED", "缓存路径已失效"))
                } else {
                    Ok(paths)
                }
            },
        )
        .expect("缓存失效后应以新发现路径启动");

        assert_eq!(started, fresh);
        assert_eq!(discoveries.load(Ordering::Relaxed), 1);
        assert_eq!(starts.load(Ordering::Relaxed), 2);
        assert_eq!(*cache.lock().unwrap(), Some(fresh));
    }

    fn test_runtime_paths(label: &str) -> RuntimePaths {
        RuntimePaths {
            node_path: PathBuf::from(format!("{label}-node")),
            sdk_root: PathBuf::from(format!("{label}-sdk")),
            pi_command: None,
            source: RuntimeSource::ExplicitPaths,
        }
    }

    #[test]
    fn unavailable_runtime_keeps_request_header_settings_for_future_restart() {
        let runtime = BridgeRuntime::unavailable(
            AppError::new("RUNTIME_NOT_FOUND", "未找到可用运行时"),
            RequestHeaderSettings::default(),
        );
        let settings = RequestHeaderSettings {
            enabled: true,
            client: crate::bridge::protocol::RequestHeaderClient::Codex,
        };

        assert_eq!(
            runtime.configure_request_headers(settings.clone()),
            Ok(settings)
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
    fn validates_active_tool_boundaries() {
        assert_eq!(validate_active_tools(Some(&[])), Ok(()));
        assert_eq!(
            validate_active_tools(Some(&["read".to_owned(), "edit".to_owned()])),
            Ok(())
        );
        assert_eq!(
            validate_active_tools(Some(&["read".to_owned(), "read".to_owned()]))
                .expect_err("重复工具必须被拒绝")
                .code,
            "TOOL_SELECTION_INVALID"
        );
        assert_eq!(
            validate_active_tools(Some(&["bad\nname".to_owned()]))
                .expect_err("换行工具名必须被拒绝")
                .code,
            "TOOL_SELECTION_INVALID"
        );
    }

    #[test]
    fn validates_and_normalizes_prompt_images() {
        let (image_root, image_path) =
            prompt_image_fixture("valid.png", b"\x89PNG\r\n\x1a\nfixture");

        let result = validate_prompt_image_paths(
            Some(&[image_path.to_string_lossy().into_owned()]),
            Some(&image_root),
        )
        .expect("有效 PNG 应通过校验")
        .expect("图片列表应保留");

        assert_eq!(result.len(), 1);
        assert!(Path::new(&result[0]).is_absolute());
        std::fs::remove_dir_all(image_root).expect("测试图片目录应可删除");
    }

    #[test]
    fn rejects_invalid_prompt_images_without_exposing_paths() {
        let (image_root, spoofed) = prompt_image_fixture("spoofed.png", b"not an image");
        let spoofed_text = spoofed.to_string_lossy().into_owned();
        let error = validate_prompt_image_paths(
            Some(std::slice::from_ref(&spoofed_text)),
            Some(&image_root),
        )
        .expect_err("伪装图片必须被拒绝");
        assert_eq!(error.code, "PROMPT_IMAGE_TYPE_UNSUPPORTED");
        assert!(!error.message.contains(&spoofed_text));

        assert_eq!(
            validate_prompt_image_paths(Some(&["relative.png".to_owned()]), Some(&image_root))
                .expect_err("相对路径必须被拒绝")
                .code,
            "PROMPT_IMAGE_PATH_INVALID"
        );
        assert_eq!(
            validate_prompt_image_paths(Some(&[]), Some(&image_root))
                .expect_err("空图片列表必须被拒绝")
                .code,
            "PROMPT_IMAGE_COUNT_INVALID"
        );

        let (outside_root, outside) =
            prompt_image_fixture("outside.png", b"\x89PNG\r\n\x1a\nfixture");
        let outside_text = outside.to_string_lossy().into_owned();
        let error = validate_prompt_image_paths(
            Some(std::slice::from_ref(&outside_text)),
            Some(&image_root),
        )
        .expect_err("授权缓存目录外的图片必须被拒绝");
        assert_eq!(error.code, "PROMPT_IMAGE_PATH_INVALID");
        assert!(!error.message.contains(&outside_text));

        std::fs::remove_dir_all(image_root).expect("测试图片目录应可删除");
        std::fs::remove_dir_all(outside_root).expect("目录外测试图片应可删除");
    }

    #[test]
    fn rejects_duplicate_prompt_images() {
        let (image_root, image_path) =
            prompt_image_fixture("duplicate.png", b"\x89PNG\r\n\x1a\nfixture");
        let image_path = image_path.to_string_lossy().into_owned();

        let error = validate_prompt_image_paths(
            Some(&[image_path.clone(), image_path.clone()]),
            Some(&image_root),
        )
        .expect_err("重复图片必须被拒绝");

        assert_eq!(error.code, "PROMPT_IMAGE_PATH_INVALID");
        std::fs::remove_dir_all(image_root).expect("测试图片目录应可删除");
    }

    fn prompt_image_fixture(name: &str, bytes: &[u8]) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "pi-desktop-prompt-image-{}-{}-{name}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("系统时间必须有效")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("应可创建测试图片目录");
        let path = root.join(name);
        std::fs::write(&path, bytes).expect("应可创建测试图片");
        (root, path)
    }

    #[test]
    fn validates_package_source_boundaries() {
        assert_eq!(validate_package_source("npm:pi-test"), Ok("npm:pi-test"));
        assert_eq!(
            validate_package_source("  ")
                .expect_err("空插件来源必须被拒绝")
                .code,
            "PACKAGE_SOURCE_INVALID"
        );
        assert_eq!(
            validate_package_source("npm:ok\ntoken=secret")
                .expect_err("包含换行的插件来源必须被拒绝")
                .code,
            "PACKAGE_SOURCE_INVALID"
        );
    }

    #[test]
    fn validates_session_configuration_boundaries() {
        let valid = SessionConfigurationUpdate {
            model: None,
            thinking_level: Some("high".to_owned()),
        };
        assert_eq!(validate_session_configuration_update(&valid), Ok(()));

        for level in ["xhigh", "max"] {
            let extended = SessionConfigurationUpdate {
                model: None,
                thinking_level: Some(level.to_owned()),
            };
            assert_eq!(validate_session_configuration_update(&extended), Ok(()));
        }

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
    fn validates_and_normalizes_session_id_batches() {
        let ids = vec![" saved ".to_owned(), "gone".to_owned()];
        assert_eq!(validate_session_ids(&ids).unwrap(), ["saved", "gone"]);
        assert_eq!(
            validate_session_ids(&[])
                .expect_err("空会话 id 列表必须被拒绝")
                .code,
            "SESSION_IDS_INVALID"
        );
        assert_eq!(
            validate_session_ids(&["same".to_owned(), " same ".to_owned()])
                .expect_err("规范化后重复的会话 id 必须被拒绝")
                .code,
            "SESSION_IDS_INVALID"
        );
        assert_eq!(
            validate_session_ids(&["bad\nname".to_owned()])
                .expect_err("包含换行的会话 id 必须被拒绝")
                .code,
            "SESSION_IDS_INVALID"
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
    fn reports_missing_formal_session_file() {
        let missing = std::env::temp_dir().join(format!(
            "pi-desktop-missing-session-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("系统时间必须有效")
                .as_nanos()
        ));
        let error = canonical_session_path(&missing).expect_err("缺失的正式会话文件必须被拒绝");

        assert_eq!(error.code, "SESSION_PATH_INVALID");
        assert_eq!(error.message, "会话文件不存在或无法访问");
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
        assert!(is_connection_failure(&AppError::new(
            "BRIDGE_TIMEOUT",
            "请求超时"
        )));
    }
}
