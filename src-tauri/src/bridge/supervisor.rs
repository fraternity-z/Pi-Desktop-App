use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::{
    bridge::protocol::{
        AgentModel, AgentSessionSummary, BridgeEvent, BridgeHello, BridgeResponse, CreatedSession,
        DeleteSessionsResult, PROTOCOL_VERSION, PackageScope, PackageSummary, PackageUpdateInfo,
        PromptStreamingBehavior, RequestHeaderSettings, ResourceSummary, SessionConfiguration,
        SlashCommandSummary, parse_hello_frame, valid_session_configuration, valid_slash_commands,
        validate_event, validate_frame_size,
    },
    error::AppError,
};

const DEFAULT_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_SESSION_INITIALIZATION_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_PROMPT_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_PACKAGE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_SESSION_DELETE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(20);
const BRIDGE_DIAGNOSTIC_PREFIX: &str = "PI_BRIDGE_DIAGNOSTIC ";
const MAX_BRIDGE_DIAGNOSTIC_CHARS: usize = 1_024;
const MAX_IGNORED_RESPONSE_IDS: usize = 1_024;

pub type BridgeEventSink = Arc<dyn Fn(BridgeEvent) + Send + Sync + 'static>;
pub type BridgeFaultSink = Arc<dyn Fn(AppError) + Send + Sync + 'static>;

#[derive(Debug, Clone)]
pub struct BridgeLaunchConfig {
    pub node_path: PathBuf,
    pub bridge_script: PathBuf,
    pub sdk_root: PathBuf,
    pub agent_dir: PathBuf,
    pub handshake_timeout: Duration,
    pub response_timeout: Duration,
    pub shutdown_timeout: Duration,
}

impl BridgeLaunchConfig {
    pub fn new(
        node_path: PathBuf,
        bridge_script: PathBuf,
        sdk_root: PathBuf,
        agent_dir: PathBuf,
    ) -> Self {
        Self {
            node_path,
            bridge_script,
            sdk_root,
            agent_dir,
            handshake_timeout: DEFAULT_HANDSHAKE_TIMEOUT,
            response_timeout: DEFAULT_RESPONSE_TIMEOUT,
            shutdown_timeout: DEFAULT_SHUTDOWN_TIMEOUT,
        }
    }

    fn canonicalize(self) -> Result<Self, AppError> {
        Ok(Self {
            node_path: canonical_file(
                &self.node_path,
                "NODE_PATH_INVALID",
                "Node.js 路径必须是存在的绝对文件路径",
            )?,
            bridge_script: canonical_file(
                &self.bridge_script,
                "BRIDGE_RESOURCE_MISSING",
                "Bridge 资源文件不存在",
            )?,
            sdk_root: canonical_dir(
                &self.sdk_root,
                "SDK_PATH_INVALID",
                "Pi SDK 路径必须是存在的绝对目录",
            )?,
            agent_dir: canonical_dir(
                &self.agent_dir,
                "AGENT_DIR_INVALID",
                "Pi agentDir 必须是存在的绝对目录",
            )?,
            handshake_timeout: self.handshake_timeout,
            response_timeout: self.response_timeout,
            shutdown_timeout: self.shutdown_timeout,
        })
    }
}

pub struct BridgeSupervisor {
    hello: BridgeHello,
    commands: Sender<WorkerCommand>,
    response_timeout: Duration,
    next_request_id: AtomicU64,
    connection_faulted: Arc<AtomicBool>,
    closed: Mutex<bool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BridgeSupervisor {
    pub fn start(config: BridgeLaunchConfig) -> Result<Self, AppError> {
        Self::start_with_sinks(config, Arc::new(|_| {}), Arc::new(|_| {}))
    }

    pub fn start_with_event_sink(
        config: BridgeLaunchConfig,
        event_sink: BridgeEventSink,
    ) -> Result<Self, AppError> {
        Self::start_with_sinks(config, event_sink, Arc::new(|_| {}))
    }

    pub fn start_with_sinks(
        config: BridgeLaunchConfig,
        event_sink: BridgeEventSink,
        fault_sink: BridgeFaultSink,
    ) -> Result<Self, AppError> {
        let config = config.canonicalize()?;
        let handshake_timeout = config.handshake_timeout;
        let response_timeout = config.response_timeout;
        let shutdown_timeout = config.shutdown_timeout;
        let transport = ProcessTransport::spawn(&config)?;
        Self::connect_with_sinks(
            Box::new(transport),
            handshake_timeout,
            response_timeout,
            shutdown_timeout,
            event_sink,
            fault_sink,
        )
    }

    pub fn hello(&self) -> &BridgeHello {
        &self.hello
    }

    pub(crate) fn connection_faulted(&self) -> bool {
        self.connection_faulted.load(Ordering::Acquire)
    }

    pub fn ping(&self) -> Result<(), AppError> {
        let data = self.request("ping", json!({}), self.response_timeout)?;
        if data.as_ref().and_then(|value| value.get("pong")) != Some(&Value::Bool(true)) {
            return Err(AppError::new(
                "BRIDGE_PING_INVALID",
                "Bridge ping 响应缺少 pong=true",
            ));
        }
        Ok(())
    }

    pub fn health(&self) -> Result<(), AppError> {
        let data = self.request("health", json!({}), self.response_timeout)?;
        if data
            .as_ref()
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str)
            != Some("ok")
        {
            return Err(AppError::new(
                "BRIDGE_HEALTH_INVALID",
                "Bridge health 响应缺少 status=ok",
            ));
        }
        Ok(())
    }

    pub fn configure_request_headers(
        &self,
        settings: &RequestHeaderSettings,
    ) -> Result<(), AppError> {
        self.configure_request_headers_with_timeout(settings, self.response_timeout)
    }

    pub(crate) fn configure_request_headers_with_timeout(
        &self,
        settings: &RequestHeaderSettings,
        timeout: Duration,
    ) -> Result<(), AppError> {
        let fields = serde_json::to_value(settings)
            .map_err(|_| AppError::new("BRIDGE_REQUEST_INVALID", "无法序列化请求头客户端配置"))?;
        let data = self
            .request("request-headers.configure", fields, timeout)?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_REQUEST_HEADERS_INVALID",
                    "Bridge request-headers.configure 响应缺少配置数据",
                )
            })?;
        let configured: RequestHeaderSettings = serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_REQUEST_HEADERS_INVALID",
                "Bridge request-headers.configure 响应字段无效",
            )
        })?;
        if configured != *settings {
            return Err(AppError::new(
                "BRIDGE_REQUEST_HEADERS_INVALID",
                "Bridge request-headers.configure 响应与请求不一致",
            ));
        }
        Ok(())
    }

    pub fn create_session(&self, cwd: &Path) -> Result<CreatedSession, AppError> {
        let data = self
            .request_hard(
                "session.create",
                json!({"cwd": cwd}),
                DEFAULT_SESSION_INITIALIZATION_TIMEOUT,
            )?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_SESSION_INVALID",
                    "Bridge session.create 响应缺少会话数据",
                )
            })?;
        let session: CreatedSession = serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_SESSION_INVALID",
                "Bridge session.create 响应字段无效",
            )
        })?;
        if !valid_session_configuration(&session.configuration) {
            return Err(AppError::new(
                "BRIDGE_SESSION_INVALID",
                "Bridge session.create 返回了无效的思考强度配置",
            ));
        }
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSessionSummary>, AppError> {
        let data = self
            .request("session.list", json!({}), self.response_timeout)?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_SESSION_LIST_INVALID",
                    "Bridge session.list 响应缺少会话数据",
                )
            })?;
        serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_SESSION_LIST_INVALID",
                "Bridge session.list 响应字段无效",
            )
        })
    }

    pub fn delete_sessions(
        &self,
        session_ids: &[String],
    ) -> Result<DeleteSessionsResult, AppError> {
        let data = self
            .request(
                "session.delete",
                json!({"sessionIds": session_ids}),
                DEFAULT_SESSION_DELETE_TIMEOUT,
            )?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_SESSION_DELETE_INVALID",
                    "Bridge session.delete 响应缺少清理结果",
                )
            })?;
        let result: DeleteSessionsResult = serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_SESSION_DELETE_INVALID",
                "Bridge session.delete 响应字段无效",
            )
        })?;
        let requested: HashSet<&str> = session_ids.iter().map(String::as_str).collect();
        let mut returned = HashSet::new();
        let invalid_return = result
            .deleted_session_ids
            .iter()
            .any(|id| !requested.contains(id.as_str()) || !returned.insert(id.as_str()))
            || result
                .missing_session_ids
                .iter()
                .any(|id| !requested.contains(id.as_str()) || !returned.insert(id.as_str()));
        if invalid_return || returned.len() != session_ids.len() {
            return Err(AppError::new(
                "BRIDGE_SESSION_DELETE_INVALID",
                "Bridge session.delete 响应包含未请求或重复的会话 id",
            ));
        }
        Ok(result)
    }

    pub fn open_session(&self, session_path: &Path) -> Result<CreatedSession, AppError> {
        let data = self
            .request_hard(
                "session.open",
                json!({"sessionPath": session_path}),
                DEFAULT_SESSION_INITIALIZATION_TIMEOUT,
            )?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_SESSION_INVALID",
                    "Bridge session.open 响应缺少会话数据",
                )
            })?;
        let session: CreatedSession = serde_json::from_value(data).map_err(|_| {
            AppError::new("BRIDGE_SESSION_INVALID", "Bridge session.open 响应字段无效")
        })?;
        if !valid_session_configuration(&session.configuration) {
            return Err(AppError::new(
                "BRIDGE_SESSION_INVALID",
                "Bridge session.open 返回了无效的思考强度配置",
            ));
        }
        Ok(session)
    }

    pub fn list_models(&self) -> Result<Vec<AgentModel>, AppError> {
        let data = self
            .request("model.list", json!({}), self.response_timeout)?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_MODEL_LIST_INVALID",
                    "Bridge model.list 响应缺少模型数据",
                )
            })?;
        serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_MODEL_LIST_INVALID",
                "Bridge model.list 响应字段无效",
            )
        })
    }

    pub fn list_packages(&self, cwd: &Path) -> Result<Vec<PackageSummary>, AppError> {
        self.typed_list_request(
            "package.list",
            json!({"cwd": cwd}),
            "BRIDGE_PACKAGE_LIST_INVALID",
            "Bridge package.list 响应缺少插件数据",
            "Bridge package.list 响应字段无效",
            self.response_timeout,
        )
    }

    pub fn install_package(
        &self,
        cwd: &Path,
        source: &str,
        scope: &PackageScope,
    ) -> Result<Vec<PackageSummary>, AppError> {
        self.package_mutation(
            "package.install",
            cwd,
            source,
            Some(scope),
            None,
            DEFAULT_PACKAGE_TIMEOUT,
        )
    }

    pub fn set_package_enabled(
        &self,
        cwd: &Path,
        source: &str,
        scope: &PackageScope,
        enabled: bool,
    ) -> Result<Vec<PackageSummary>, AppError> {
        self.package_mutation(
            "package.set-enabled",
            cwd,
            source,
            Some(scope),
            Some(enabled),
            self.response_timeout,
        )
    }

    pub fn remove_package(
        &self,
        cwd: &Path,
        source: &str,
        scope: &PackageScope,
    ) -> Result<Vec<PackageSummary>, AppError> {
        self.package_mutation(
            "package.remove",
            cwd,
            source,
            Some(scope),
            None,
            DEFAULT_PACKAGE_TIMEOUT,
        )
    }

    pub fn update_package(
        &self,
        cwd: &Path,
        source: Option<&str>,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let mut fields = serde_json::Map::from_iter([("cwd".to_owned(), json!(cwd))]);
        if let Some(source) = source {
            fields.insert("source".to_owned(), Value::String(source.to_owned()));
        }
        self.typed_list_request(
            "package.update",
            Value::Object(fields),
            "BRIDGE_PACKAGE_LIST_INVALID",
            "Bridge package.update 响应缺少插件数据",
            "Bridge package.update 响应字段无效",
            DEFAULT_PACKAGE_TIMEOUT,
        )
    }

    pub fn check_package_updates(&self, cwd: &Path) -> Result<Vec<PackageUpdateInfo>, AppError> {
        self.typed_list_request(
            "package.check-updates",
            json!({"cwd": cwd}),
            "BRIDGE_PACKAGE_UPDATES_INVALID",
            "Bridge package.check-updates 响应缺少更新数据",
            "Bridge package.check-updates 响应字段无效",
            DEFAULT_PACKAGE_TIMEOUT,
        )
    }

    pub fn list_resources(&self, cwd: &Path) -> Result<Vec<ResourceSummary>, AppError> {
        self.typed_list_request(
            "resource.list",
            json!({"cwd": cwd}),
            "BRIDGE_RESOURCE_LIST_INVALID",
            "Bridge resource.list 响应缺少资源数据",
            "Bridge resource.list 响应字段无效",
            self.response_timeout,
        )
    }

    pub fn list_commands(&self, session_id: &str) -> Result<Vec<SlashCommandSummary>, AppError> {
        let data = self
            .request(
                "command.list",
                json!({"sessionId": session_id}),
                self.response_timeout,
            )?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_COMMAND_LIST_INVALID",
                    "Bridge command.list 响应缺少命令数据",
                )
            })?;
        let commands: Vec<SlashCommandSummary> = serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_COMMAND_LIST_INVALID",
                "Bridge command.list 响应字段无效",
            )
        })?;
        if !valid_slash_commands(&commands) {
            return Err(AppError::new(
                "BRIDGE_COMMAND_LIST_INVALID",
                "Bridge command.list 返回了无效或重复的命令",
            ));
        }
        Ok(commands)
    }

    fn package_mutation(
        &self,
        operation: &'static str,
        cwd: &Path,
        source: &str,
        scope: Option<&PackageScope>,
        enabled: Option<bool>,
        timeout: Duration,
    ) -> Result<Vec<PackageSummary>, AppError> {
        let mut fields = serde_json::Map::from_iter([
            ("cwd".to_owned(), json!(cwd)),
            ("source".to_owned(), Value::String(source.to_owned())),
        ]);
        if let Some(scope) = scope {
            fields.insert(
                "scope".to_owned(),
                serde_json::to_value(scope)
                    .map_err(|_| AppError::new("BRIDGE_REQUEST_INVALID", "无法序列化插件作用域"))?,
            );
        }
        if let Some(enabled) = enabled {
            fields.insert("enabled".to_owned(), Value::Bool(enabled));
        }
        self.typed_list_request(
            operation,
            Value::Object(fields),
            "BRIDGE_PACKAGE_LIST_INVALID",
            "Bridge 插件操作响应缺少插件数据",
            "Bridge 插件操作响应字段无效",
            timeout,
        )
    }

    fn typed_list_request<T: serde::de::DeserializeOwned>(
        &self,
        operation: &'static str,
        fields: Value,
        code: &'static str,
        missing_message: &'static str,
        invalid_message: &'static str,
        timeout: Duration,
    ) -> Result<Vec<T>, AppError> {
        let data = self
            .request(operation, fields, timeout)?
            .ok_or_else(|| AppError::new(code, missing_message))?;
        serde_json::from_value(data).map_err(|_| AppError::new(code, invalid_message))
    }

    pub fn configure_session(
        &self,
        session_id: &str,
        model: Option<(&str, &str)>,
        thinking_level: Option<&str>,
    ) -> Result<SessionConfiguration, AppError> {
        let mut fields = serde_json::Map::from_iter([(
            "sessionId".to_owned(),
            Value::String(session_id.to_owned()),
        )]);
        if let Some((provider, id)) = model {
            fields.insert("model".to_owned(), json!({"provider": provider, "id": id}));
        }
        if let Some(thinking_level) = thinking_level {
            fields.insert(
                "thinkingLevel".to_owned(),
                Value::String(thinking_level.to_owned()),
            );
        }
        let data = self
            .request(
                "session.configure",
                Value::Object(fields),
                self.response_timeout,
            )?
            .ok_or_else(|| {
                AppError::new(
                    "BRIDGE_SESSION_CONFIG_INVALID",
                    "Bridge session.configure 响应缺少配置数据",
                )
            })?;
        let configuration: SessionConfiguration = serde_json::from_value(data).map_err(|_| {
            AppError::new(
                "BRIDGE_SESSION_CONFIG_INVALID",
                "Bridge session.configure 响应字段无效",
            )
        })?;
        if !valid_session_configuration(&configuration) {
            return Err(AppError::new(
                "BRIDGE_SESSION_CONFIG_INVALID",
                "Bridge session.configure 返回了无效的思考强度配置",
            ));
        }
        Ok(configuration)
    }

    pub fn prompt(
        &self,
        session_id: &str,
        text: &str,
        streaming_behavior: Option<&PromptStreamingBehavior>,
        active_tools: Option<&[String]>,
        image_paths: Option<&[String]>,
    ) -> Result<u64, AppError> {
        let mut fields = serde_json::Map::from_iter([
            ("sessionId".to_owned(), Value::String(session_id.to_owned())),
            ("text".to_owned(), Value::String(text.to_owned())),
        ]);
        if let Some(streaming_behavior) = streaming_behavior {
            fields.insert(
                "streamingBehavior".to_owned(),
                serde_json::to_value(streaming_behavior).map_err(|_| {
                    AppError::new("BRIDGE_REQUEST_INVALID", "无法序列化流式消息行为")
                })?,
            );
        }
        if let Some(active_tools) = active_tools {
            fields.insert(
                "activeTools".to_owned(),
                serde_json::to_value(active_tools)
                    .map_err(|_| AppError::new("BRIDGE_REQUEST_INVALID", "无法序列化工具权限"))?,
            );
        }
        if let Some(image_paths) = image_paths {
            fields.insert(
                "imagePaths".to_owned(),
                serde_json::to_value(image_paths)
                    .map_err(|_| AppError::new("BRIDGE_REQUEST_INVALID", "无法序列化图片路径"))?,
            );
        }
        self.request_with_inactivity_timeout(
            "prompt",
            Value::Object(fields),
            session_id,
            DEFAULT_PROMPT_INACTIVITY_TIMEOUT,
        )?
        .and_then(|data| data.get("finalSeq").and_then(Value::as_u64))
        .ok_or_else(|| {
            AppError::new(
                "BRIDGE_PROMPT_RESPONSE_INVALID",
                "Bridge prompt 响应缺少 finalSeq",
            )
        })
    }

    pub fn clear_queue(&self, session_id: &str) -> Result<(), AppError> {
        self.request(
            "queue.clear",
            json!({"sessionId": session_id}),
            self.response_timeout,
        )
        .map(|_| ())
    }

    pub fn abort(&self, session_id: &str) -> Result<(), AppError> {
        self.request(
            "abort",
            json!({"sessionId": session_id}),
            self.response_timeout,
        )
        .map(|_| ())
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        self.shutdown_with_timeout(self.response_timeout)
    }

    pub(crate) fn shutdown_with_timeout(&self, timeout: Duration) -> Result<(), AppError> {
        let mut closed = self
            .closed
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?;
        if *closed {
            return Ok(());
        }
        *closed = true;
        drop(closed);

        let response = self
            .request_inner("shutdown", json!({}), RequestTimeoutPolicy::Soft(timeout))
            .map(|_| ());
        let stopped = self.stop_worker();
        response.and(stopped)
    }

    #[cfg(test)]
    fn connect(
        transport: Box<dyn BridgeTransport>,
        handshake_timeout: Duration,
        response_timeout: Duration,
        shutdown_timeout: Duration,
        event_sink: BridgeEventSink,
    ) -> Result<Self, AppError> {
        Self::connect_with_sinks(
            transport,
            handshake_timeout,
            response_timeout,
            shutdown_timeout,
            event_sink,
            Arc::new(|_| {}),
        )
    }

    fn connect_with_sinks(
        mut transport: Box<dyn BridgeTransport>,
        handshake_timeout: Duration,
        response_timeout: Duration,
        shutdown_timeout: Duration,
        event_sink: BridgeEventSink,
        fault_sink: BridgeFaultSink,
    ) -> Result<Self, AppError> {
        let hello_line = transport.read_frame(handshake_timeout).map_err(|error| {
            if error.code == "BRIDGE_TIMEOUT" {
                AppError::new("BRIDGE_TIMEOUT", "等待 Pi Bridge 启动响应超时，请重新检测")
            } else {
                error
            }
        })?;
        let hello = parse_hello_frame(&hello_line)?;
        let (commands, receiver) = mpsc::channel();
        let connection_faulted = Arc::new(AtomicBool::new(false));
        let worker_connection_faulted = connection_faulted.clone();
        let worker = thread::spawn(move || {
            run_worker(
                transport,
                receiver,
                event_sink,
                fault_sink,
                shutdown_timeout,
                worker_connection_faulted,
            );
        });
        Ok(Self {
            hello,
            commands,
            response_timeout,
            next_request_id: AtomicU64::new(1),
            connection_faulted,
            closed: Mutex::new(false),
            worker: Mutex::new(Some(worker)),
        })
    }

    fn request(
        &self,
        operation: &'static str,
        fields: Value,
        timeout: Duration,
    ) -> Result<Option<Value>, AppError> {
        self.request_with_timeout_policy(operation, fields, RequestTimeoutPolicy::Soft(timeout))
    }

    fn request_hard(
        &self,
        operation: &'static str,
        fields: Value,
        timeout: Duration,
    ) -> Result<Option<Value>, AppError> {
        self.request_with_timeout_policy(operation, fields, RequestTimeoutPolicy::Hard(timeout))
    }

    fn request_with_inactivity_timeout(
        &self,
        operation: &'static str,
        fields: Value,
        session_id: &str,
        timeout: Duration,
    ) -> Result<Option<Value>, AppError> {
        self.request_with_timeout_policy(
            operation,
            fields,
            RequestTimeoutPolicy::Inactivity {
                timeout,
                session_id: session_id.to_owned(),
            },
        )
    }

    fn request_with_timeout_policy(
        &self,
        operation: &'static str,
        fields: Value,
        timeout_policy: RequestTimeoutPolicy,
    ) -> Result<Option<Value>, AppError> {
        if *self
            .closed
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge 状态锁不可用"))?
        {
            return Err(AppError::new("BRIDGE_CLOSED", "Bridge supervisor 已关闭"));
        }
        self.request_inner(operation, fields, timeout_policy)
    }

    fn request_inner(
        &self,
        operation: &'static str,
        fields: Value,
        timeout_policy: RequestTimeoutPolicy,
    ) -> Result<Option<Value>, AppError> {
        let request_id = format!(
            "rust-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let mut frame = serde_json::Map::from_iter([
            ("v".to_owned(), json!(PROTOCOL_VERSION)),
            ("id".to_owned(), json!(request_id)),
            ("op".to_owned(), json!(operation)),
        ]);
        let fields = fields
            .as_object()
            .ok_or_else(|| AppError::new("BRIDGE_REQUEST_INVALID", "Bridge 请求字段必须是对象"))?;
        frame.extend(fields.clone());

        let (reply, receiver) = mpsc::channel();
        let timeout = timeout_policy.timeout();
        let renewable = timeout_policy.is_renewable();
        let resets_connection = timeout_policy.resets_connection();
        self.commands
            .send(WorkerCommand::Request {
                id: request_id,
                operation,
                frame: Value::Object(frame).to_string(),
                deadline: Instant::now() + timeout,
                timeout_policy,
                reply,
            })
            .map_err(|_| AppError::new("BRIDGE_CLOSED", "Bridge supervisor 已关闭"))?;

        if renewable {
            receiver
                .recv()
                .map_err(|_| AppError::new("BRIDGE_EXITED", "Bridge 请求通道已断开"))?
        } else {
            match receiver.recv_timeout(timeout + WORKER_POLL_INTERVAL * 2) {
                Ok(result) => result,
                Err(RecvTimeoutError::Timeout) => {
                    if resets_connection {
                        self.connection_faulted.store(true, Ordering::Release);
                    }
                    Err(request_timeout(operation))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    Err(AppError::new("BRIDGE_EXITED", "Bridge 请求通道已断开"))
                }
            }
        }
    }

    fn stop_worker(&self) -> Result<(), AppError> {
        let mut worker = self
            .worker
            .lock()
            .map_err(|_| AppError::new("BRIDGE_STATE_POISONED", "Bridge worker 锁不可用"))?;
        let Some(handle) = worker.take() else {
            return Ok(());
        };
        let (reply, receiver) = mpsc::channel();
        let sent = self.commands.send(WorkerCommand::Stop { reply }).is_ok();
        let stopped = if sent {
            receiver.recv().unwrap_or_else(|_| {
                Err(AppError::new(
                    "BRIDGE_EXITED",
                    "Bridge worker 在停止前已退出",
                ))
            })
        } else {
            Ok(())
        };
        let _ = handle.join();
        stopped
    }
}

impl Drop for BridgeSupervisor {
    fn drop(&mut self) {
        if let Ok(mut closed) = self.closed.lock() {
            *closed = true;
        }
        let _ = self.stop_worker();
    }
}

#[derive(Debug, Clone)]
enum RequestTimeoutPolicy {
    Soft(Duration),
    Hard(Duration),
    Inactivity {
        timeout: Duration,
        session_id: String,
    },
}

impl RequestTimeoutPolicy {
    fn timeout(&self) -> Duration {
        match self {
            Self::Soft(timeout) | Self::Hard(timeout) | Self::Inactivity { timeout, .. } => {
                *timeout
            }
        }
    }

    fn is_renewable(&self) -> bool {
        matches!(self, Self::Inactivity { .. })
    }

    fn resets_connection(&self) -> bool {
        matches!(self, Self::Hard(_) | Self::Inactivity { .. })
    }

    fn renewal_timeout(&self, event: &BridgeEvent) -> Option<Duration> {
        match self {
            Self::Inactivity {
                timeout,
                session_id,
            } if session_id == &event.session_id => Some(*timeout),
            _ => None,
        }
    }
}

struct PendingRequest {
    operation: &'static str,
    deadline: Instant,
    timeout_policy: RequestTimeoutPolicy,
    reply: Sender<Result<Option<Value>, AppError>>,
}

#[derive(Default)]
struct IgnoredResponses {
    ids: HashSet<String>,
    order: VecDeque<String>,
}

impl IgnoredResponses {
    fn insert(&mut self, id: String) {
        if !self.ids.insert(id.clone()) {
            return;
        }
        self.order.push_back(id);
        while self.order.len() > MAX_IGNORED_RESPONSE_IDS {
            if let Some(expired) = self.order.pop_front() {
                self.ids.remove(&expired);
            }
        }
    }

    fn remove(&mut self, id: &str) -> bool {
        self.ids.remove(id)
    }
}

enum WorkerCommand {
    Request {
        id: String,
        operation: &'static str,
        frame: String,
        deadline: Instant,
        timeout_policy: RequestTimeoutPolicy,
        reply: Sender<Result<Option<Value>, AppError>>,
    },
    Stop {
        reply: Sender<Result<(), AppError>>,
    },
}

fn run_worker(
    mut transport: Box<dyn BridgeTransport>,
    commands: Receiver<WorkerCommand>,
    event_sink: BridgeEventSink,
    fault_sink: BridgeFaultSink,
    shutdown_timeout: Duration,
    connection_faulted: Arc<AtomicBool>,
) {
    let mut pending = HashMap::<String, PendingRequest>::new();
    let mut ignored_responses = IgnoredResponses::default();
    let mut last_event_sequence = 0;

    loop {
        if pending.is_empty() {
            match commands.recv_timeout(WORKER_POLL_INTERVAL) {
                Ok(command) => {
                    if handle_worker_command(
                        command,
                        &mut *transport,
                        &mut pending,
                        &fault_sink,
                        shutdown_timeout,
                        &connection_faulted,
                    ) {
                        return;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    let _ = transport.stop(Duration::from_millis(100));
                    return;
                }
            }
        }

        while let Ok(command) = commands.try_recv() {
            if handle_worker_command(
                command,
                &mut *transport,
                &mut pending,
                &fault_sink,
                shutdown_timeout,
                &connection_faulted,
            ) {
                return;
            }
        }

        match transport.read_frame(WORKER_POLL_INTERVAL) {
            Ok(line) => {
                if let Err(error) = handle_inbound_frame(
                    &line,
                    &mut pending,
                    &mut ignored_responses,
                    &mut last_event_sequence,
                    &event_sink,
                ) {
                    connection_faulted.store(true, Ordering::Release);
                    fail_worker(&mut pending, error, &fault_sink);
                    let _ = transport.stop(Duration::from_millis(100));
                    return;
                }
            }
            Err(error) if error.code == "BRIDGE_TIMEOUT" => {}
            Err(error) => {
                connection_faulted.store(true, Ordering::Release);
                fail_worker(&mut pending, error, &fault_sink);
                let _ = transport.stop(Duration::from_millis(100));
                return;
            }
        }
        if expire_requests(&mut pending, &mut ignored_responses, &connection_faulted) {
            fault_sink(AppError::new(
                "BRIDGE_TIMEOUT",
                "Bridge 请求超时，连接已重置",
            ));
            let _ = transport.stop(shutdown_timeout);
            return;
        }
    }
}

fn handle_worker_command(
    command: WorkerCommand,
    transport: &mut dyn BridgeTransport,
    pending: &mut HashMap<String, PendingRequest>,
    fault_sink: &BridgeFaultSink,
    shutdown_timeout: Duration,
    connection_faulted: &AtomicBool,
) -> bool {
    match command {
        WorkerCommand::Request {
            id,
            operation,
            frame,
            deadline,
            timeout_policy,
            reply,
        } => match transport.write_frame(&frame) {
            Ok(()) => {
                pending.insert(
                    id,
                    PendingRequest {
                        operation,
                        deadline,
                        timeout_policy,
                        reply,
                    },
                );
                false
            }
            Err(error) => {
                connection_faulted.store(true, Ordering::Release);
                let _ = reply.send(Err(error.clone()));
                fail_worker(pending, error, fault_sink);
                let _ = transport.stop(shutdown_timeout);
                true
            }
        },
        WorkerCommand::Stop { reply } => {
            fail_pending(
                pending,
                AppError::new("BRIDGE_CLOSED", "Bridge supervisor 已关闭"),
            );
            let result = transport.stop(shutdown_timeout);
            let _ = reply.send(result);
            true
        }
    }
}

fn handle_inbound_frame(
    line: &str,
    pending: &mut HashMap<String, PendingRequest>,
    ignored_responses: &mut IgnoredResponses,
    last_event_sequence: &mut u64,
    event_sink: &BridgeEventSink,
) -> Result<(), AppError> {
    validate_frame_size(line)?;
    let value: Value = serde_json::from_str(line)
        .map_err(|_| AppError::new("BRIDGE_INVALID_JSON", "Bridge 返回了无效 JSON"))?;

    match value.get("kind").and_then(Value::as_str) {
        Some("event") => {
            let event: BridgeEvent = serde_json::from_value(value)
                .map_err(|_| AppError::new("BRIDGE_EVENT_INVALID", "Bridge event 字段无效"))?;
            accept_event(&event, last_event_sequence)?;
            renew_inactivity_deadlines(pending, &event, Instant::now());
            event_sink(event);
            Ok(())
        }
        Some("response") => {
            let response: BridgeResponse = serde_json::from_value(value).map_err(|_| {
                AppError::new("BRIDGE_RESPONSE_INVALID", "Bridge response 字段无效")
            })?;
            if response.v != PROTOCOL_VERSION || response.kind != "response" {
                return Err(AppError::new(
                    "BRIDGE_RESPONSE_INVALID",
                    "Bridge response 协议版本或类型无效",
                ));
            }
            let Some(request) = pending.remove(&response.id) else {
                if ignored_responses.remove(&response.id) {
                    return Ok(());
                }
                return Err(AppError::new(
                    "BRIDGE_RESPONSE_INVALID",
                    "Bridge response 请求 id 未知",
                ));
            };
            let result = accept_response(request.operation, response);
            let _ = request.reply.send(result);
            Ok(())
        }
        _ => Err(AppError::new(
            "BRIDGE_FRAME_INVALID",
            "Bridge 返回了未知协议帧",
        )),
    }
}

fn accept_event(event: &BridgeEvent, last_event_sequence: &mut u64) -> Result<(), AppError> {
    if event.v != PROTOCOL_VERSION || event.kind != "event" {
        return Err(AppError::new(
            "BRIDGE_EVENT_INVALID",
            "Bridge event 协议版本或类型无效",
        ));
    }
    validate_event(event)?;
    let expected = last_event_sequence.saturating_add(1);
    if event.seq != expected {
        return Err(AppError::new(
            "BRIDGE_EVENT_SEQUENCE_INVALID",
            format!(
                "Bridge event 序号 {} 不连续，期望序号 {}",
                event.seq, expected
            ),
        ));
    }
    *last_event_sequence = event.seq;
    Ok(())
}

fn renew_inactivity_deadlines(
    pending: &mut HashMap<String, PendingRequest>,
    event: &BridgeEvent,
    now: Instant,
) -> usize {
    let mut renewed = 0;
    for request in pending.values_mut() {
        if let Some(timeout) = request.timeout_policy.renewal_timeout(event) {
            request.deadline = now + timeout;
            renewed += 1;
        }
    }
    renewed
}

fn accept_response(operation: &str, response: BridgeResponse) -> Result<Option<Value>, AppError> {
    if response.ok {
        return Ok(response.data);
    }
    let (remote_code, remote_message) = response
        .error
        .map(|error| (error.code, error.message))
        .unwrap_or_else(|| ("UNKNOWN".to_owned(), "Bridge 请求失败".to_owned()));
    if let Some(code) = public_remote_error_code(&remote_code) {
        return Err(AppError::new(
            code,
            non_empty(&remote_message, "Bridge 请求失败"),
        ));
    }
    Err(AppError::new(
        "BRIDGE_REQUEST_FAILED",
        format!("Bridge 操作 {operation} 失败"),
    ))
}

fn public_remote_error_code(code: &str) -> Option<&'static str> {
    Some(match code.trim() {
        "INVALID_REQUEST" => "INVALID_REQUEST",
        "UNSUPPORTED_PROTOCOL" => "UNSUPPORTED_PROTOCOL",
        "UNSUPPORTED_OPERATION" => "UNSUPPORTED_OPERATION",
        "FRAME_TOO_LARGE" => "FRAME_TOO_LARGE",
        "SESSION_CREATE_FAILED" => "SESSION_CREATE_FAILED",
        "SESSION_LIST_FAILED" => "SESSION_LIST_FAILED",
        "SESSION_DELETE_FAILED" => "SESSION_DELETE_FAILED",
        "SESSION_IDS_INVALID" => "SESSION_IDS_INVALID",
        "SESSION_PATH_INVALID" => "SESSION_PATH_INVALID",
        "SESSION_OPEN_FAILED" => "SESSION_OPEN_FAILED",
        "SESSION_BUSY" => "SESSION_BUSY",
        "SESSION_NOT_FOUND" => "SESSION_NOT_FOUND",
        "INVALID_SESSION" => "INVALID_SESSION",
        "SESSION_SUBSCRIBE_FAILED" => "SESSION_SUBSCRIBE_FAILED",
        "MODEL_LIST_FAILED" => "MODEL_LIST_FAILED",
        "MODEL_NOT_FOUND" => "MODEL_NOT_FOUND",
        "MODEL_UPDATE_FAILED" => "MODEL_UPDATE_FAILED",
        "THINKING_LEVEL_UPDATE_FAILED" => "THINKING_LEVEL_UPDATE_FAILED",
        "TOOL_PERMISSIONS_UNSUPPORTED" => "TOOL_PERMISSIONS_UNSUPPORTED",
        "TOOL_SELECTION_INVALID" => "TOOL_SELECTION_INVALID",
        "TOOL_PERMISSION_UPDATE_FAILED" => "TOOL_PERMISSION_UPDATE_FAILED",
        "PROMPT_FAILED" => "PROMPT_FAILED",
        "PROMPT_IMAGE_COUNT_INVALID" => "PROMPT_IMAGE_COUNT_INVALID",
        "PROMPT_IMAGE_PATH_INVALID" => "PROMPT_IMAGE_PATH_INVALID",
        "PROMPT_IMAGE_TYPE_UNSUPPORTED" => "PROMPT_IMAGE_TYPE_UNSUPPORTED",
        "PROMPT_IMAGE_EMPTY" => "PROMPT_IMAGE_EMPTY",
        "PROMPT_IMAGE_TOO_LARGE" => "PROMPT_IMAGE_TOO_LARGE",
        "PROMPT_IMAGE_READ_FAILED" => "PROMPT_IMAGE_READ_FAILED",
        "QUEUE_CLEAR_FAILED" => "QUEUE_CLEAR_FAILED",
        "ABORT_FAILED" => "ABORT_FAILED",
        "RUNTIME_CLOSED" => "RUNTIME_CLOSED",
        "REQUEST_HEADERS_UNSUPPORTED" => "REQUEST_HEADERS_UNSUPPORTED",
        "PACKAGE_MANAGER_UNSUPPORTED" => "PACKAGE_MANAGER_UNSUPPORTED",
        "PACKAGE_LIST_FAILED" => "PACKAGE_LIST_FAILED",
        "PACKAGE_INSTALL_FAILED" => "PACKAGE_INSTALL_FAILED",
        "PACKAGE_UPDATE_FAILED" => "PACKAGE_UPDATE_FAILED",
        "PACKAGE_UPDATE_CHECK_FAILED" => "PACKAGE_UPDATE_CHECK_FAILED",
        "PACKAGE_REMOVE_FAILED" => "PACKAGE_REMOVE_FAILED",
        "PACKAGE_NOT_FOUND" => "PACKAGE_NOT_FOUND",
        "RESOURCE_LIST_UNSUPPORTED" => "RESOURCE_LIST_UNSUPPORTED",
        "RESOURCE_LIST_FAILED" => "RESOURCE_LIST_FAILED",
        _ => return None,
    })
}

fn expire_requests(
    pending: &mut HashMap<String, PendingRequest>,
    ignored_responses: &mut IgnoredResponses,
    connection_faulted: &AtomicBool,
) -> bool {
    expire_requests_at(
        pending,
        ignored_responses,
        connection_faulted,
        Instant::now(),
    )
}

fn expire_requests_at(
    pending: &mut HashMap<String, PendingRequest>,
    ignored_responses: &mut IgnoredResponses,
    connection_faulted: &AtomicBool,
    now: Instant,
) -> bool {
    let expired: Vec<String> = pending
        .iter()
        .filter(|(_, request)| request.deadline <= now)
        .map(|(id, _)| id.clone())
        .collect();
    if expired.is_empty() {
        return false;
    }
    let reset_connection = expired.iter().any(|id| {
        pending
            .get(id)
            .is_some_and(|request| request.timeout_policy.resets_connection())
    });
    if reset_connection {
        connection_faulted.store(true, Ordering::Release);
    }
    for id in expired {
        if let Some(request) = pending.remove(&id) {
            let _ = request.reply.send(Err(request_timeout(request.operation)));
            if !reset_connection {
                ignored_responses.insert(id);
            }
        }
    }
    if !reset_connection {
        return false;
    }
    fail_pending(
        pending,
        AppError::new("BRIDGE_TIMEOUT", "Bridge 请求超时，连接已重置"),
    );
    true
}

fn fail_pending(pending: &mut HashMap<String, PendingRequest>, error: AppError) {
    for (_, request) in pending.drain() {
        let _ = request.reply.send(Err(error.clone()));
    }
}

fn fail_worker(
    pending: &mut HashMap<String, PendingRequest>,
    error: AppError,
    fault_sink: &BridgeFaultSink,
) {
    fail_pending(pending, error.clone());
    fault_sink(error);
}

trait BridgeTransport: Send {
    fn write_frame(&mut self, frame: &str) -> Result<(), AppError>;
    fn read_frame(&mut self, timeout: Duration) -> Result<String, AppError>;
    fn stop(&mut self, timeout: Duration) -> Result<(), AppError>;
}

enum ReaderMessage {
    Frame(String),
    Closed,
    Invalid,
}

struct ProcessTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: Receiver<ReaderMessage>,
}

impl ProcessTransport {
    fn spawn(config: &BridgeLaunchConfig) -> Result<Self, AppError> {
        let mut command = bridge_command(config);
        let mut child = command
            .spawn()
            .map_err(|_| AppError::new("BRIDGE_SPAWN_FAILED", "无法启动 Pi Bridge 子进程"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::new("BRIDGE_PIPE_FAILED", "无法连接 Bridge stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::new("BRIDGE_PIPE_FAILED", "无法连接 Bridge stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::new("BRIDGE_PIPE_FAILED", "无法连接 Bridge stderr"))?;

        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        let _ = sender.send(ReaderMessage::Closed);
                        break;
                    }
                    Ok(_) => {
                        while line.ends_with(['\r', '\n']) {
                            line.pop();
                        }
                        if sender.send(ReaderMessage::Frame(line)).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        let _ = sender.send(ReaderMessage::Invalid);
                        break;
                    }
                }
            }
        });
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(diagnostic) = sanitize_bridge_diagnostic(&line) {
                    eprintln!("{BRIDGE_DIAGNOSTIC_PREFIX}{diagnostic}");
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            stdout: receiver,
        })
    }
}

impl BridgeTransport for ProcessTransport {
    fn write_frame(&mut self, frame: &str) -> Result<(), AppError> {
        self.stdin
            .write_all(frame.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|_| AppError::new("BRIDGE_WRITE_FAILED", "写入 Bridge stdin 失败"))
    }

    fn read_frame(&mut self, timeout: Duration) -> Result<String, AppError> {
        match self.stdout.recv_timeout(timeout) {
            Ok(ReaderMessage::Frame(line)) => Ok(line),
            Ok(ReaderMessage::Closed) => {
                Err(AppError::new("BRIDGE_EXITED", "Bridge 在响应前已退出"))
            }
            Ok(ReaderMessage::Invalid) => Err(AppError::new(
                "BRIDGE_STDOUT_INVALID",
                "无法读取 Bridge stdout",
            )),
            Err(RecvTimeoutError::Timeout) => {
                Err(AppError::new("BRIDGE_TIMEOUT", "等待 Bridge 响应超时"))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(AppError::new("BRIDGE_EXITED", "Bridge stdout 已断开"))
            }
        }
    }

    fn stop(&mut self, timeout: Duration) -> Result<(), AppError> {
        let started = Instant::now();
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) if started.elapsed() < timeout => {
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err(AppError::new(
                        "BRIDGE_SHUTDOWN_TIMEOUT",
                        "Bridge 未在期限内退出，已强制终止",
                    ));
                }
                Err(_) => {
                    return Err(AppError::new(
                        "BRIDGE_WAIT_FAILED",
                        "无法读取 Bridge 子进程状态",
                    ));
                }
            }
        }
    }
}

impl Drop for ProcessTransport {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn bridge_command(config: &BridgeLaunchConfig) -> Command {
    let mut command = Command::new(&config.node_path);
    command
        .arg(&config.bridge_script)
        .arg("--sdk-root")
        .arg(&config.sdk_root)
        .arg("--agent-dir")
        .arg(&config.agent_dir)
        .arg("--protocol")
        .arg(format!("v{PROTOCOL_VERSION}"))
        .arg("--stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

fn canonical_file(
    path: &Path,
    code: &'static str,
    message: &'static str,
) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(code, message));
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| AppError::new(code, message))?;
    if !canonical.is_file() {
        return Err(AppError::new(code, message));
    }
    Ok(normalize_process_path(canonical))
}

fn canonical_dir(
    path: &Path,
    code: &'static str,
    message: &'static str,
) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(code, message));
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| AppError::new(code, message))?;
    if !canonical.is_dir() {
        return Err(AppError::new(code, message));
    }
    Ok(normalize_process_path(canonical))
}

#[cfg(windows)]
pub(crate) fn normalize_process_path(path: PathBuf) -> PathBuf {
    use std::path::{Component, Prefix};

    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path;
    };
    let mut normalized = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:\\", drive as char)),
        Prefix::VerbatimUNC(server, share) => {
            let mut root = PathBuf::from(r"\\");
            root.push(server);
            root.push(share);
            root
        }
        _ => return path,
    };
    for component in components {
        if !matches!(component, Component::RootDir) {
            normalized.push(component.as_os_str());
        }
    }
    normalized
}

#[cfg(not(windows))]
pub(crate) fn normalize_process_path(path: PathBuf) -> PathBuf {
    path
}

fn request_timeout(operation: &str) -> AppError {
    AppError::new(
        "BRIDGE_TIMEOUT",
        format!("等待 Bridge 操作 {operation} 响应超时"),
    )
}

fn sanitize_bridge_diagnostic(line: &str) -> Option<String> {
    if line.len() > MAX_BRIDGE_DIAGNOSTIC_CHARS {
        return None;
    }
    let payload = line.strip_prefix(BRIDGE_DIAGNOSTIC_PREFIX)?;
    let value: Value = serde_json::from_str(payload).ok()?;
    let object = value.as_object()?;
    if object.get("event")?.as_str()? != "performance" {
        return None;
    }
    let operation = object.get("operation")?.as_str()?;
    if !matches!(
        operation,
        "startup"
            | "model.runtime"
            | "session.create"
            | "session.open"
            | "resource.list"
            | "command.list"
    ) {
        return None;
    }
    let phase = object.get("phase")?.as_str()?;
    if !matches!(
        phase,
        "sdk.import"
            | "model.initialize"
            | "session.manager"
            | "resource.reload"
            | "session.create"
            | "history.project"
            | "total"
    ) {
        return None;
    }
    let duration_ms = object.get("durationMs")?.as_u64()?;
    if duration_ms > 24 * 60 * 60 * 1_000 {
        return None;
    }
    let outcome = object.get("outcome")?.as_str()?;
    if !matches!(outcome, "ok" | "error" | "slow") {
        return None;
    }
    Some(
        json!({
            "event": "performance",
            "operation": operation,
            "phase": phase,
            "durationMs": duration_ms,
            "outcome": outcome,
        })
        .to_string(),
    )
}

fn non_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() { fallback } else { value }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        ffi::OsString,
        sync::{Arc, Mutex},
    };

    use super::*;

    const HELLO: &str = r#"{"type":"hello","protocolVersion":1,"piVersion":"0.84.2","nodeVersion":"22.23.2","capabilities":["sessions","streaming","abort","extensions","models","session-history","session-configuration","tool-status","tool-permissions","background-sessions","thinking-stream","queue","request-header-profiles","packages","resources","context-usage","images"]}"#;

    struct MockTransport {
        reads: Arc<Mutex<VecDeque<Result<String, AppError>>>>,
        writes: Arc<Mutex<Vec<String>>>,
        stop_calls: Arc<Mutex<usize>>,
        write_error: Option<AppError>,
    }

    impl MockTransport {
        fn new(reads: impl IntoIterator<Item = Result<&'static str, AppError>>) -> Self {
            Self {
                reads: Arc::new(Mutex::new(
                    reads
                        .into_iter()
                        .map(|result| result.map(str::to_owned))
                        .collect(),
                )),
                writes: Arc::new(Mutex::new(Vec::new())),
                stop_calls: Arc::new(Mutex::new(0)),
                write_error: None,
            }
        }

        fn with_write_error(mut self, error: AppError) -> Self {
            self.write_error = Some(error);
            self
        }
    }

    impl BridgeTransport for MockTransport {
        fn write_frame(&mut self, frame: &str) -> Result<(), AppError> {
            if let Some(error) = &self.write_error {
                return Err(error.clone());
            }
            self.writes.lock().unwrap().push(frame.to_owned());
            Ok(())
        }

        fn read_frame(&mut self, _timeout: Duration) -> Result<String, AppError> {
            self.reads.lock().unwrap().pop_front().unwrap_or_else(|| {
                Err(AppError::new("BRIDGE_TIMEOUT", "测试 transport 没有更多帧"))
            })
        }

        fn stop(&mut self, _timeout: Duration) -> Result<(), AppError> {
            *self.stop_calls.lock().unwrap() += 1;
            Ok(())
        }
    }

    fn connect(transport: MockTransport) -> BridgeSupervisor {
        BridgeSupervisor::connect(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
        )
        .expect("有效 hello 应连接成功")
    }

    #[test]
    fn uses_startup_tolerant_default_handshake_timeout() {
        let config = BridgeLaunchConfig::new(
            PathBuf::from("node"),
            PathBuf::from("pi-bridge.mjs"),
            PathBuf::from("sdk"),
            PathBuf::from("agent"),
        );

        assert_eq!(config.handshake_timeout, Duration::from_secs(30));
    }

    #[test]
    fn gives_session_initialization_a_dedicated_deadline() {
        assert_eq!(DEFAULT_RESPONSE_TIMEOUT, Duration::from_secs(10));
        assert_eq!(
            DEFAULT_SESSION_INITIALIZATION_TIMEOUT,
            Duration::from_secs(60)
        );
    }

    #[test]
    fn connects_and_validates_health_response() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"status":"ok","protocolVersion":1}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        supervisor.health().expect("健康检查应成功");

        assert_eq!(supervisor.hello().pi_version, "0.84.2");
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({"v": 1, "id": "rust-1", "op": "health"})
        );
    }

    #[test]
    fn sends_and_validates_request_header_settings() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"enabled":true,"client":"codex"}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);
        let settings = RequestHeaderSettings {
            enabled: true,
            client: crate::bridge::protocol::RequestHeaderClient::Codex,
        };

        supervisor
            .configure_request_headers(&settings)
            .expect("请求头设置应同步成功");

        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({
                "v": 1,
                "id": "rust-1",
                "op": "request-headers.configure",
                "enabled": true,
                "client": "codex"
            })
        );
    }

    #[test]
    fn request_header_sync_honors_a_bounded_startup_timeout() {
        let supervisor = connect(MockTransport::new([Ok(HELLO)]));
        let settings = RequestHeaderSettings {
            enabled: true,
            client: crate::bridge::protocol::RequestHeaderClient::Codex,
        };
        let started = Instant::now();

        let error = supervisor
            .configure_request_headers_with_timeout(&settings, Duration::from_millis(20))
            .expect_err("无响应时请求头同步应超时");

        assert_eq!(error.code, "BRIDGE_TIMEOUT");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn accepts_monotonic_event_before_response() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"message.delta","data":{"delta":"a"}}"#,
            ),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"pong":true}}"#),
        ]);
        let events = Arc::new(Mutex::new(Vec::new()));
        let received_events = events.clone();
        let supervisor = BridgeSupervisor::connect(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(move |event| received_events.lock().unwrap().push(event)),
        )
        .expect("有效 hello 应连接成功");

        supervisor.ping().expect("单调事件后应继续等待响应");

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].seq, 1);
        assert_eq!(events[0].name, "message.delta");
    }

    #[test]
    fn rejects_non_monotonic_event_sequence() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"agent.started"}"#),
            Ok(r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"agent.settled"}"#),
        ]);
        let supervisor = connect(transport);

        let error = supervisor.ping().expect_err("重复事件序号必须失败");

        assert_eq!(error.code, "BRIDGE_EVENT_SEQUENCE_INVALID");
    }

    #[test]
    fn rejects_event_sequence_gap() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"event","seq":2,"sessionId":"s-1","name":"agent.started"}"#),
        ]);
        let supervisor = connect(transport);

        let error = supervisor.ping().expect_err("跳号事件序号必须失败");

        assert_eq!(error.code, "BRIDGE_EVENT_SEQUENCE_INVALID");
        assert!(error.message.contains("期望序号 1"));
    }

    #[test]
    fn maps_remote_request_error() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":false,"error":{"code":"SESSION_NOT_FOUND","message":"找不到会话"}}"#,
            ),
        ]);
        let supervisor = connect(transport);

        let error = supervisor.health().expect_err("远端错误必须映射");

        assert_eq!(error.code, "SESSION_NOT_FOUND");
        assert_eq!(error.message, "找不到会话");
    }

    #[test]
    fn hides_unknown_remote_error_details() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":false,"error":{"code":"PRIVATE_FAILURE","message":"token=secret"}}"#,
            ),
        ]);
        let supervisor = connect(transport);

        let error = supervisor.health().expect_err("未知远端错误必须降级");

        assert_eq!(error.code, "BRIDGE_REQUEST_FAILED");
        assert!(!error.message.contains("secret"));
        assert!(!error.message.contains("PRIVATE_FAILURE"));
    }

    #[test]
    fn accepts_only_allowlisted_bridge_diagnostics() {
        let diagnostic = sanitize_bridge_diagnostic(
            r#"PI_BRIDGE_DIAGNOSTIC {"event":"performance","operation":"session.open","phase":"resource.reload","durationMs":1250,"outcome":"slow","token":"secret","path":"C:\\private"}"#,
        )
        .expect("白名单性能诊断应被接受");

        assert_eq!(
            serde_json::from_str::<Value>(&diagnostic).unwrap(),
            json!({
                "event": "performance",
                "operation": "session.open",
                "phase": "resource.reload",
                "durationMs": 1250,
                "outcome": "slow"
            })
        );
        assert!(!diagnostic.contains("secret"));
        assert!(!diagnostic.contains("private"));
        assert!(sanitize_bridge_diagnostic("extension token=secret").is_none());
        assert!(sanitize_bridge_diagnostic(
            r#"PI_BRIDGE_DIAGNOSTIC {"event":"performance","operation":"prompt","phase":"total","durationMs":1,"outcome":"ok"}"#,
        )
        .is_none());
        assert!(sanitize_bridge_diagnostic(
            r#"PI_BRIDGE_DIAGNOSTIC {"event":"performance","operation":"command.list","phase":"total","durationMs":12,"outcome":"ok"}"#,
        )
        .is_some());
    }

    #[test]
    fn propagates_handshake_timeout() {
        let transport = MockTransport::new([Err(AppError::new(
            "BRIDGE_TIMEOUT",
            "等待 Bridge hello 超时",
        ))]);

        let result = BridgeSupervisor::connect(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
        );
        let error = result.err().expect("握手超时必须失败");

        assert_eq!(error.code, "BRIDGE_TIMEOUT");
        assert_eq!(error.message, "等待 Pi Bridge 启动响应超时，请重新检测");
    }

    #[test]
    fn keeps_transport_after_soft_request_deadline_and_ignores_late_response() {
        let transport = MockTransport::new([Ok(HELLO)]);
        let reads = transport.reads.clone();
        let stop_calls = transport.stop_calls.clone();
        let supervisor = BridgeSupervisor::connect(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_millis(5),
            Duration::from_millis(5),
            Arc::new(|_| {}),
        )
        .expect("有效 hello 应连接成功");

        let error = supervisor.ping().expect_err("请求截止后必须返回超时");
        reads.lock().unwrap().extend([
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"pong":true}}"#
                    .to_owned(),
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-2","ok":true,"data":{"pong":true}}"#
                    .to_owned(),
            ),
        ]);
        supervisor.ping().expect("迟到响应后连接仍应可用");

        assert_eq!(error.code, "BRIDGE_TIMEOUT");
        assert!(!supervisor.connection_faulted());
        assert_eq!(*stop_calls.lock().unwrap(), 0);
        drop(supervisor);

        assert_eq!(*stop_calls.lock().unwrap(), 1);
    }

    #[test]
    fn stops_transport_after_hard_request_deadline() {
        let transport = MockTransport::new([Ok(HELLO)]);
        let stop_calls = transport.stop_calls.clone();
        let supervisor = connect(transport);

        let error = supervisor
            .request_hard("session.open", json!({}), Duration::from_millis(5))
            .expect_err("会话初始化硬截止后必须返回超时");

        assert_eq!(error.code, "BRIDGE_TIMEOUT");
        assert!(supervisor.connection_faulted());
        drop(supervisor);
        assert_eq!(*stop_calls.lock().unwrap(), 1);
    }

    #[test]
    fn renews_prompt_inactivity_deadline_without_a_hard_limit() {
        let started = Instant::now();
        let timeout = Duration::from_secs(10 * 60);
        let original_deadline = started + timeout;
        let (reply, _receiver) = mpsc::channel();
        let mut pending = HashMap::from([(
            "rust-1".to_owned(),
            PendingRequest {
                operation: "prompt",
                deadline: original_deadline,
                timeout_policy: RequestTimeoutPolicy::Inactivity {
                    timeout,
                    session_id: "s-1".to_owned(),
                },
                reply,
            },
        )]);
        let event: BridgeEvent = serde_json::from_value(json!({
            "v": 1,
            "kind": "event",
            "seq": 1,
            "sessionId": "s-1",
            "name": "agent.started"
        }))
        .unwrap();

        let first_activity = started + Duration::from_secs(60 * 60);
        assert_eq!(
            renew_inactivity_deadlines(&mut pending, &event, first_activity),
            1
        );
        assert_eq!(pending["rust-1"].deadline, first_activity + timeout);

        let later_activity = started + Duration::from_secs(3 * 60 * 60);
        assert_eq!(
            renew_inactivity_deadlines(&mut pending, &event, later_activity),
            1
        );
        assert_eq!(pending["rust-1"].deadline, later_activity + timeout);
        assert!(pending["rust-1"].deadline > original_deadline);
    }

    #[test]
    fn does_not_renew_fixed_or_other_session_deadlines() {
        let started = Instant::now();
        let timeout = Duration::from_secs(10 * 60);
        let fixed_deadline = started + Duration::from_secs(10);
        let other_session_deadline = started + Duration::from_secs(20);
        let (fixed_reply, _fixed_receiver) = mpsc::channel();
        let (other_reply, _other_receiver) = mpsc::channel();
        let mut pending = HashMap::from([
            (
                "rust-1".to_owned(),
                PendingRequest {
                    operation: "ping",
                    deadline: fixed_deadline,
                    timeout_policy: RequestTimeoutPolicy::Soft(Duration::from_secs(10)),
                    reply: fixed_reply,
                },
            ),
            (
                "rust-2".to_owned(),
                PendingRequest {
                    operation: "prompt",
                    deadline: other_session_deadline,
                    timeout_policy: RequestTimeoutPolicy::Inactivity {
                        timeout,
                        session_id: "s-2".to_owned(),
                    },
                    reply: other_reply,
                },
            ),
        ]);
        let event: BridgeEvent = serde_json::from_value(json!({
            "v": 1,
            "kind": "event",
            "seq": 1,
            "sessionId": "s-1",
            "name": "agent.started"
        }))
        .unwrap();

        assert_eq!(
            renew_inactivity_deadlines(
                &mut pending,
                &event,
                started + Duration::from_secs(60 * 60)
            ),
            0
        );
        assert_eq!(pending["rust-1"].deadline, fixed_deadline);
        assert_eq!(pending["rust-2"].deadline, other_session_deadline);
    }

    #[test]
    fn expires_prompt_after_inactivity_deadline() {
        let (reply, receiver) = mpsc::channel();
        let mut pending = HashMap::from([(
            "rust-1".to_owned(),
            PendingRequest {
                operation: "prompt",
                deadline: Instant::now(),
                timeout_policy: RequestTimeoutPolicy::Inactivity {
                    timeout: Duration::from_secs(10 * 60),
                    session_id: "s-1".to_owned(),
                },
                reply,
            },
        )]);

        let mut ignored_responses = IgnoredResponses::default();
        let connection_faulted = AtomicBool::new(false);
        assert!(expire_requests(
            &mut pending,
            &mut ignored_responses,
            &connection_faulted,
        ));
        assert!(pending.is_empty());
        assert!(connection_faulted.load(Ordering::Acquire));
        let error = receiver.recv().unwrap().unwrap_err();
        assert_eq!(error.code, "BRIDGE_TIMEOUT");
        assert!(error.message.contains("prompt"));
    }

    #[test]
    fn keeps_session_initialization_pending_between_soft_and_hard_deadlines() {
        let started = Instant::now();
        let (soft_reply, soft_receiver) = mpsc::channel();
        let (hard_reply, hard_receiver) = mpsc::channel();
        let mut pending = HashMap::from([
            (
                "rust-soft".to_owned(),
                PendingRequest {
                    operation: "model.list",
                    deadline: started + DEFAULT_RESPONSE_TIMEOUT,
                    timeout_policy: RequestTimeoutPolicy::Soft(DEFAULT_RESPONSE_TIMEOUT),
                    reply: soft_reply,
                },
            ),
            (
                "rust-hard".to_owned(),
                PendingRequest {
                    operation: "session.open",
                    deadline: started + DEFAULT_SESSION_INITIALIZATION_TIMEOUT,
                    timeout_policy: RequestTimeoutPolicy::Hard(
                        DEFAULT_SESSION_INITIALIZATION_TIMEOUT,
                    ),
                    reply: hard_reply,
                },
            ),
        ]);
        let mut ignored_responses = IgnoredResponses::default();
        let connection_faulted = AtomicBool::new(false);

        assert!(!expire_requests_at(
            &mut pending,
            &mut ignored_responses,
            &connection_faulted,
            started + DEFAULT_RESPONSE_TIMEOUT + Duration::from_secs(1),
        ));
        assert_eq!(
            soft_receiver.recv().unwrap().unwrap_err().code,
            "BRIDGE_TIMEOUT"
        );
        assert!(pending.contains_key("rust-hard"));
        assert!(!connection_faulted.load(Ordering::Acquire));

        assert!(expire_requests_at(
            &mut pending,
            &mut ignored_responses,
            &connection_faulted,
            started + DEFAULT_SESSION_INITIALIZATION_TIMEOUT + Duration::from_secs(1),
        ));
        assert_eq!(
            hard_receiver.recv().unwrap().unwrap_err().code,
            "BRIDGE_TIMEOUT"
        );
        assert!(pending.is_empty());
        assert!(connection_faulted.load(Ordering::Acquire));
    }

    #[test]
    fn shuts_down_transport_once() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true}"#),
        ]);
        let stop_calls = transport.stop_calls.clone();
        let supervisor = connect(transport);

        supervisor.shutdown().expect("shutdown 应成功");
        supervisor.shutdown().expect("重复 shutdown 应幂等");
        drop(supervisor);

        assert_eq!(*stop_calls.lock().unwrap(), 1);
    }

    #[test]
    fn reports_unexpected_worker_fault_to_fault_sink() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"event","seq":2,"sessionId":"s-1","name":"agent.started"}"#),
        ]);
        let (fault_sender, fault_receiver) = mpsc::channel();
        let supervisor = BridgeSupervisor::connect_with_sinks(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
            Arc::new(move |error| {
                let _ = fault_sender.send(error);
            }),
        )
        .expect("有效 hello 应连接成功");

        let error = supervisor
            .ping()
            .expect_err("非法事件序号必须使 worker 退出");

        assert_eq!(error.code, "BRIDGE_EVENT_SEQUENCE_INVALID");
        let fault = fault_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("worker 故障必须通知 fault sink");
        assert_eq!(fault.code, "BRIDGE_EVENT_SEQUENCE_INVALID");
    }

    #[test]
    fn reports_transport_failure_while_idle_to_fault_sink() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Err(AppError::new("BRIDGE_EXITED", "Bridge stdout 已断开")),
        ]);
        let (fault_sender, fault_receiver) = mpsc::channel();
        let _supervisor = BridgeSupervisor::connect_with_sinks(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
            Arc::new(move |error| {
                let _ = fault_sender.send(error);
            }),
        )
        .expect("有效 hello 应连接成功");

        let error = fault_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("空闲 Bridge 退出必须通知故障 sink");

        assert_eq!(error.code, "BRIDGE_EXITED");
    }

    #[test]
    fn reports_write_failure_to_fault_sink_and_stops_transport() {
        let transport = MockTransport::new([Ok(HELLO)]).with_write_error(AppError::new(
            "BRIDGE_WRITE_FAILED",
            "写入 Bridge stdin 失败",
        ));
        let stop_calls = transport.stop_calls.clone();
        let (fault_sender, fault_receiver) = mpsc::channel();
        let supervisor = BridgeSupervisor::connect_with_sinks(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
            Arc::new(move |error| {
                let _ = fault_sender.send(error);
            }),
        )
        .expect("有效 hello 应连接成功");

        let request_error = supervisor.ping().expect_err("写入失败必须终止请求");
        let fault_error = fault_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("写入失败必须通知故障 sink");

        assert_eq!(request_error.code, "BRIDGE_WRITE_FAILED");
        assert_eq!(fault_error.code, "BRIDGE_WRITE_FAILED");
        assert_eq!(*stop_calls.lock().unwrap(), 1);
    }

    #[test]
    fn does_not_report_fault_for_normal_shutdown() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true}"#),
        ]);
        let faults = Arc::new(Mutex::new(Vec::new()));
        let received_faults = faults.clone();
        let supervisor = BridgeSupervisor::connect_with_sinks(
            Box::new(transport),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Arc::new(|_| {}),
            Arc::new(move |error| received_faults.lock().unwrap().push(error)),
        )
        .expect("有效 hello 应连接成功");

        supervisor.shutdown().expect("shutdown 应成功");

        assert!(faults.lock().unwrap().is_empty());
    }

    #[test]
    fn sends_typed_session_create_payload() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"sessionId":"s-1","cwd":"C:\\work","sessionPath":"C:\\agent\\sessions\\s.jsonl","modelFallbackMessage":"使用默认模型","configuration":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off"]},"messages":[]}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        let session = supervisor
            .create_session(Path::new(r"C:\work"))
            .expect("session.create 应返回类型化会话");

        assert_eq!(session.session_id, "s-1");
        assert_eq!(
            session.model_fallback_message.as_deref(),
            Some("使用默认模型")
        );
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({"v": 1, "id": "rust-1", "op": "session.create", "cwd": r"C:\work"})
        );
    }

    #[test]
    fn rejects_prompt_response_without_final_sequence() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true}"#),
        ]);
        let supervisor = connect(transport);

        let error = supervisor
            .prompt("s-1", "hello", None, None, None)
            .expect_err("prompt 响应必须包含最终事件序号");

        assert_eq!(error.code, "BRIDGE_PROMPT_RESPONSE_INVALID");
    }

    #[test]
    fn sends_active_tools_and_images_with_prompt() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"finalSeq":0}}"#),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);
        let tools = vec!["read".to_owned(), "edit".to_owned()];
        let images = vec![r"C:\cache\pasted.png".to_owned()];

        supervisor
            .prompt("s-1", "inspect", None, Some(&tools), Some(&images))
            .expect("prompt 应携带工具权限和图片路径");

        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({
                "v": 1,
                "id": "rust-1",
                "op": "prompt",
                "sessionId": "s-1",
                "text": "inspect",
                "activeTools": ["read", "edit"],
                "imagePaths": [r"C:\cache\pasted.png"]
            })
        );
    }

    #[test]
    fn sends_typed_catalog_and_session_configuration_requests() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":[{"provider":"openai","id":"gpt","name":"GPT","reasoning":true}]}"#,
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-2","ok":true,"data":[{"id":"saved","path":"C:\\agent\\sessions\\saved.jsonl","cwd":"C:\\work","name":null,"created":"2026-08-20T08:00:00.000Z","modified":"2026-08-20T09:00:00.000Z","messageCount":2,"firstMessage":"hello"}]}"#,
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-3","ok":true,"data":{"model":{"provider":"openai","id":"gpt","name":"GPT","reasoning":true},"thinkingLevel":"max","availableThinkingLevels":["off","minimal","low","medium","high","xhigh","max"]}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        assert_eq!(supervisor.list_models().unwrap()[0].id, "gpt");
        assert_eq!(supervisor.list_sessions().unwrap()[0].id, "saved");
        assert_eq!(
            supervisor
                .configure_session("s-1", Some(("openai", "gpt")), Some("max"))
                .unwrap()
                .thinking_level,
            "max"
        );

        let frames: Vec<Value> = writes
            .lock()
            .unwrap()
            .iter()
            .map(|frame| serde_json::from_str(frame).unwrap())
            .collect();
        assert_eq!(
            frames[0],
            json!({"v": 1, "id": "rust-1", "op": "model.list"})
        );
        assert_eq!(
            frames[1],
            json!({"v": 1, "id": "rust-2", "op": "session.list"})
        );
        assert_eq!(
            frames[2],
            json!({
                "v": 1,
                "id": "rust-3",
                "op": "session.configure",
                "sessionId": "s-1",
                "model": {"provider": "openai", "id": "gpt"},
                "thinkingLevel": "max"
            })
        );
    }

    #[test]
    fn rejects_invalid_thinking_configuration_response() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"model":null,"thinkingLevel":"high","availableThinkingLevels":["off"]}}"#,
            ),
        ]);
        let supervisor = connect(transport);

        let error = supervisor
            .configure_session("s-1", None, Some("high"))
            .expect_err("响应中的当前档位不在能力集合中必须失败");
        assert_eq!(error.code, "BRIDGE_SESSION_CONFIG_INVALID");
    }

    #[test]
    fn sends_typed_session_delete_request_and_validates_result() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"deletedSessionIds":["saved"],"missingSessionIds":["gone"]}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);
        let ids = vec!["saved".to_owned(), "gone".to_owned()];

        let result = supervisor
            .delete_sessions(&ids)
            .expect("session.delete 应返回完整结果");

        assert_eq!(result.deleted_session_ids, vec!["saved"]);
        assert_eq!(result.missing_session_ids, vec!["gone"]);
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({
                "v": 1,
                "id": "rust-1",
                "op": "session.delete",
                "sessionIds": ["saved", "gone"]
            })
        );
    }

    #[test]
    fn rejects_incomplete_session_delete_result() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"deletedSessionIds":["saved"],"missingSessionIds":[]}}"#,
            ),
        ]);
        let supervisor = connect(transport);
        let ids = vec!["saved".to_owned(), "gone".to_owned()];

        let error = supervisor
            .delete_sessions(&ids)
            .expect_err("缺少请求 id 的结果必须被拒绝");

        assert_eq!(error.code, "BRIDGE_SESSION_DELETE_INVALID");
    }

    #[test]
    fn sends_typed_package_and_resource_requests() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":[{"source":"npm:pi-test","scope":"global","kind":"npm","installedPath":"C:\\agent\\pi-test","filtered":false,"enabled":true}]}"#,
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-2","ok":true,"data":[{"source":"npm:pi-test","scope":"global","kind":"npm","installedPath":"C:\\agent\\pi-test","filtered":false,"enabled":false}]}"#,
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-3","ok":true,"data":[{"source":"npm:pi-test","displayName":"Pi Test","type":"npm","scope":"global"}]}"#,
            ),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-4","ok":true,"data":[{"kind":"skill","name":"review","path":"C:\\work\\.pi\\skills\\review\\SKILL.md","source":"npm:pi-test"}]}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        assert!(supervisor.list_packages(Path::new(r"C:\work")).unwrap()[0].enabled);
        assert!(
            !supervisor
                .set_package_enabled(
                    Path::new(r"C:\work"),
                    "npm:pi-test",
                    &PackageScope::Global,
                    false,
                )
                .unwrap()[0]
                .enabled
        );
        assert_eq!(
            supervisor
                .check_package_updates(Path::new(r"C:\work"))
                .unwrap()[0]
                .display_name,
            "Pi Test"
        );
        assert_eq!(
            supervisor.list_resources(Path::new(r"C:\work")).unwrap()[0].kind,
            "skill"
        );

        let frames: Vec<Value> = writes
            .lock()
            .unwrap()
            .iter()
            .map(|frame| serde_json::from_str(frame).unwrap())
            .collect();
        assert_eq!(
            frames,
            [
                json!({"v": 1, "id": "rust-1", "op": "package.list", "cwd": r"C:\work"}),
                json!({
                    "v": 1,
                    "id": "rust-2",
                    "op": "package.set-enabled",
                    "cwd": r"C:\work",
                    "source": "npm:pi-test",
                    "scope": "global",
                    "enabled": false
                }),
                json!({"v": 1, "id": "rust-3", "op": "package.check-updates", "cwd": r"C:\work"}),
                json!({"v": 1, "id": "rust-4", "op": "resource.list", "cwd": r"C:\work"}),
            ]
        );
    }

    #[test]
    fn sends_and_validates_command_list_request() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":[{"name":"review","description":"审查变更","source":"extension","argumentHint":"[path]"}]}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        let commands = supervisor
            .list_commands("s-1")
            .expect("command.list 应返回类型化命令");

        assert_eq!(
            commands,
            vec![SlashCommandSummary {
                name: "review".to_owned(),
                description: "审查变更".to_owned(),
                source: "extension".to_owned(),
                argument_hint: Some("[path]".to_owned()),
            }]
        );
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({
                "v": 1,
                "id": "rust-1",
                "op": "command.list",
                "sessionId": "s-1"
            })
        );
    }

    #[test]
    fn rejects_invalid_command_list_response() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":[{"name":"review","description":"one","source":"extension"},{"name":"REVIEW","description":"two","source":"prompt"}]}"#,
            ),
        ]);
        let supervisor = connect(transport);

        let error = supervisor
            .list_commands("s-1")
            .expect_err("重复命令名必须被拒绝");

        assert_eq!(error.code, "BRIDGE_COMMAND_LIST_INVALID");
    }

    #[test]
    fn opens_a_typed_saved_session() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":true,"data":{"sessionId":"saved","cwd":"C:\\work","sessionPath":"C:\\agent\\sessions\\saved.jsonl","modelFallbackMessage":null,"configuration":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off"]},"messages":[{"role":"user","content":"hello"}]}}"#,
            ),
        ]);
        let writes = transport.writes.clone();
        let supervisor = connect(transport);

        let opened = supervisor
            .open_session(Path::new(r"C:\agent\sessions\saved.jsonl"))
            .unwrap();

        assert_eq!(opened.session_id, "saved");
        assert_eq!(opened.messages[0].content, "hello");
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({
                "v": 1,
                "id": "rust-1",
                "op": "session.open",
                "sessionPath": r"C:\agent\sessions\saved.jsonl"
            })
        );
    }

    #[test]
    fn routes_abort_while_prompt_is_pending() {
        let transport = MockTransport::new([Ok(HELLO)]);
        let reads = transport.reads.clone();
        let writes = transport.writes.clone();
        let supervisor = Arc::new(connect(transport));

        let prompt_supervisor = supervisor.clone();
        let prompt =
            thread::spawn(move || prompt_supervisor.prompt("s-1", "slow task", None, None, None));
        wait_for_writes(&writes, 1);

        let abort_supervisor = supervisor.clone();
        let abort = thread::spawn(move || abort_supervisor.abort("s-1"));
        wait_for_writes(&writes, 2);

        let frames: Vec<Value> = writes
            .lock()
            .unwrap()
            .iter()
            .map(|frame| serde_json::from_str(frame).unwrap())
            .collect();
        let prompt_id = frames.iter().find(|frame| frame["op"] == "prompt").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let abort_id = frames.iter().find(|frame| frame["op"] == "abort").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        reads.lock().unwrap().extend([
            Ok(json!({"v": 1, "kind": "response", "id": abort_id, "ok": true}).to_string()),
            Ok(json!({"v": 1, "kind": "response", "id": prompt_id, "ok": true, "data": {"finalSeq": 0}}).to_string()),
        ]);

        assert_eq!(abort.join().unwrap(), Ok(()));
        assert_eq!(prompt.join().unwrap(), Ok(0));
    }

    fn wait_for_writes(writes: &Arc<Mutex<Vec<String>>>, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(1);
        while writes.lock().unwrap().len() < count {
            assert!(Instant::now() < deadline, "等待测试请求写入超时");
            thread::yield_now();
        }
    }

    #[test]
    fn builds_fixed_argument_command_without_shell() {
        let config = BridgeLaunchConfig::new(
            PathBuf::from("node"),
            PathBuf::from("pi-bridge.mjs"),
            PathBuf::from("sdk"),
            PathBuf::from("agent"),
        );
        let command = bridge_command(&config);
        let arguments: Vec<OsString> = command.get_args().map(OsString::from).collect();

        assert_eq!(command.get_program(), "node");
        assert_eq!(
            arguments,
            [
                "pi-bridge.mjs",
                "--sdk-root",
                "sdk",
                "--agent-dir",
                "agent",
                "--protocol",
                "v1",
                "--stdio",
            ]
            .map(OsString::from)
        );
    }

    #[cfg(windows)]
    #[test]
    fn removes_windows_verbatim_prefix_before_process_launch() {
        assert_eq!(
            normalize_process_path(PathBuf::from(r"\\?\C:\Pi App\node.exe")),
            PathBuf::from(r"C:\Pi App\node.exe")
        );
        assert_eq!(
            normalize_process_path(PathBuf::from(r"\\?\UNC\server\share\pi\node.exe")),
            PathBuf::from(r"\\server\share\pi\node.exe")
        );
    }
}
