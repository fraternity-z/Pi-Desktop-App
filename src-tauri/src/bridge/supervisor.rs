use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::{
    bridge::protocol::{
        BridgeEvent, BridgeHello, BridgeResponse, PROTOCOL_VERSION, parse_hello_frame,
        validate_frame_size,
    },
    error::AppError,
};

const DEFAULT_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

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
    transport: Box<dyn BridgeTransport>,
    hello: BridgeHello,
    response_timeout: Duration,
    shutdown_timeout: Duration,
    next_request_id: u64,
    last_event_sequence: u64,
    closed: bool,
}

impl BridgeSupervisor {
    pub fn start(config: BridgeLaunchConfig) -> Result<Self, AppError> {
        let config = config.canonicalize()?;
        let handshake_timeout = config.handshake_timeout;
        let response_timeout = config.response_timeout;
        let shutdown_timeout = config.shutdown_timeout;
        let transport = ProcessTransport::spawn(&config)?;
        Self::connect(
            Box::new(transport),
            handshake_timeout,
            response_timeout,
            shutdown_timeout,
        )
    }

    pub fn hello(&self) -> &BridgeHello {
        &self.hello
    }

    pub fn ping(&mut self) -> Result<(), AppError> {
        let data = self.request("ping")?;
        if data.as_ref().and_then(|value| value.get("pong")) != Some(&Value::Bool(true)) {
            return Err(AppError::new(
                "BRIDGE_PING_INVALID",
                "Bridge ping 响应缺少 pong=true",
            ));
        }
        Ok(())
    }

    pub fn health(&mut self) -> Result<(), AppError> {
        let data = self.request("health")?;
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

    pub fn shutdown(&mut self) -> Result<(), AppError> {
        if self.closed {
            return Ok(());
        }

        let response = self.request("shutdown").map(|_| ());
        let stopped = self.transport.stop(self.shutdown_timeout);
        self.closed = true;
        response.and(stopped)
    }

    fn connect(
        mut transport: Box<dyn BridgeTransport>,
        handshake_timeout: Duration,
        response_timeout: Duration,
        shutdown_timeout: Duration,
    ) -> Result<Self, AppError> {
        let hello_line = transport.read_frame(handshake_timeout)?;
        let hello = parse_hello_frame(&hello_line)?;
        Ok(Self {
            transport,
            hello,
            response_timeout,
            shutdown_timeout,
            next_request_id: 1,
            last_event_sequence: 0,
            closed: false,
        })
    }

    fn request(&mut self, operation: &'static str) -> Result<Option<Value>, AppError> {
        if self.closed {
            return Err(AppError::new("BRIDGE_CLOSED", "Bridge supervisor 已关闭"));
        }

        let request_id = format!("rust-{}", self.next_request_id);
        self.next_request_id += 1;
        let frame = json!({
            "v": PROTOCOL_VERSION,
            "id": request_id,
            "op": operation,
        })
        .to_string();
        self.transport.write_frame(&frame)?;

        let started = Instant::now();
        loop {
            let remaining = self
                .response_timeout
                .checked_sub(started.elapsed())
                .ok_or_else(|| request_timeout(operation))?;
            let line = self.transport.read_frame(remaining)?;
            validate_frame_size(&line)?;
            let value: Value = serde_json::from_str(&line)
                .map_err(|_| AppError::new("BRIDGE_INVALID_JSON", "Bridge 返回了无效 JSON"))?;

            match value.get("kind").and_then(Value::as_str) {
                Some("event") => {
                    let event: BridgeEvent = serde_json::from_value(value).map_err(|_| {
                        AppError::new("BRIDGE_EVENT_INVALID", "Bridge event 字段无效")
                    })?;
                    self.accept_event(&event)?;
                }
                Some("response") => {
                    let response: BridgeResponse = serde_json::from_value(value).map_err(|_| {
                        AppError::new("BRIDGE_RESPONSE_INVALID", "Bridge response 字段无效")
                    })?;
                    return self.accept_response(operation, &request_id, response);
                }
                _ => {
                    return Err(AppError::new(
                        "BRIDGE_FRAME_INVALID",
                        "Bridge 返回了未知协议帧",
                    ));
                }
            }
        }
    }

    fn accept_event(&mut self, event: &BridgeEvent) -> Result<(), AppError> {
        if event.v != PROTOCOL_VERSION || event.kind != "event" {
            return Err(AppError::new(
                "BRIDGE_EVENT_INVALID",
                "Bridge event 协议版本或类型无效",
            ));
        }
        if event.seq <= self.last_event_sequence {
            return Err(AppError::new(
                "BRIDGE_EVENT_SEQUENCE_INVALID",
                format!(
                    "Bridge event 序号 {} 未大于上一序号 {}",
                    event.seq, self.last_event_sequence
                ),
            ));
        }
        self.last_event_sequence = event.seq;
        Ok(())
    }

    fn accept_response(
        &self,
        operation: &str,
        request_id: &str,
        response: BridgeResponse,
    ) -> Result<Option<Value>, AppError> {
        if response.v != PROTOCOL_VERSION
            || response.kind != "response"
            || response.id != request_id
        {
            return Err(AppError::new(
                "BRIDGE_RESPONSE_INVALID",
                "Bridge response 协议版本、类型或请求 id 无效",
            ));
        }
        if response.ok {
            return Ok(response.data);
        }

        let (remote_code, remote_message) = response
            .error
            .map(|error| (error.code, error.message))
            .unwrap_or_else(|| ("UNKNOWN".to_owned(), "Bridge 请求失败".to_owned()));
        Err(AppError::new(
            "BRIDGE_REQUEST_FAILED",
            format!(
                "Bridge 操作 {operation} 失败（{}）：{}",
                non_empty(&remote_code, "UNKNOWN"),
                non_empty(&remote_message, "Bridge 请求失败")
            ),
        ))
    }
}

impl Drop for BridgeSupervisor {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.transport.stop(Duration::from_millis(100));
            self.closed = true;
        }
    }
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
            let mut reader = BufReader::new(stderr);
            let mut sink = std::io::sink();
            let _ = std::io::copy(&mut reader, &mut sink);
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
fn normalize_process_path(path: PathBuf) -> PathBuf {
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
fn normalize_process_path(path: PathBuf) -> PathBuf {
    path
}

fn request_timeout(operation: &str) -> AppError {
    AppError::new(
        "BRIDGE_TIMEOUT",
        format!("等待 Bridge 操作 {operation} 响应超时"),
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

    const HELLO: &str = r#"{"type":"hello","protocolVersion":1,"piVersion":"0.84.2","nodeVersion":"22.23.2","capabilities":["sessions","streaming","abort","extensions"]}"#;

    struct MockTransport {
        reads: VecDeque<Result<String, AppError>>,
        writes: Arc<Mutex<Vec<String>>>,
        stop_calls: Arc<Mutex<usize>>,
    }

    impl MockTransport {
        fn new(reads: impl IntoIterator<Item = Result<&'static str, AppError>>) -> Self {
            Self {
                reads: reads
                    .into_iter()
                    .map(|result| result.map(str::to_owned))
                    .collect(),
                writes: Arc::new(Mutex::new(Vec::new())),
                stop_calls: Arc::new(Mutex::new(0)),
            }
        }
    }

    impl BridgeTransport for MockTransport {
        fn write_frame(&mut self, frame: &str) -> Result<(), AppError> {
            self.writes.lock().unwrap().push(frame.to_owned());
            Ok(())
        }

        fn read_frame(&mut self, _timeout: Duration) -> Result<String, AppError> {
            self.reads.pop_front().unwrap_or_else(|| {
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
        )
        .expect("有效 hello 应连接成功")
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
        let mut supervisor = connect(transport);

        supervisor.health().expect("健康检查应成功");

        assert_eq!(supervisor.hello().pi_version, "0.84.2");
        assert_eq!(
            serde_json::from_str::<Value>(&writes.lock().unwrap()[0]).unwrap(),
            json!({"v": 1, "id": "rust-1", "op": "health"})
        );
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
        let mut supervisor = connect(transport);

        supervisor.ping().expect("单调事件后应继续等待响应");

        assert_eq!(supervisor.last_event_sequence, 1);
    }

    #[test]
    fn rejects_non_monotonic_event_sequence() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"agent.started"}"#),
            Ok(r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"agent.settled"}"#),
        ]);
        let mut supervisor = connect(transport);

        let error = supervisor.ping().expect_err("重复事件序号必须失败");

        assert_eq!(error.code, "BRIDGE_EVENT_SEQUENCE_INVALID");
    }

    #[test]
    fn maps_remote_request_error() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(
                r#"{"v":1,"kind":"response","id":"rust-1","ok":false,"error":{"code":"SESSION_NOT_FOUND","message":"找不到会话"}}"#,
            ),
        ]);
        let mut supervisor = connect(transport);

        let error = supervisor.health().expect_err("远端错误必须映射");

        assert_eq!(error.code, "BRIDGE_REQUEST_FAILED");
        assert!(error.message.contains("SESSION_NOT_FOUND"));
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
        );
        let error = result.err().expect("握手超时必须失败");

        assert_eq!(error.code, "BRIDGE_TIMEOUT");
    }

    #[test]
    fn shuts_down_transport_once() {
        let transport = MockTransport::new([
            Ok(HELLO),
            Ok(r#"{"v":1,"kind":"response","id":"rust-1","ok":true}"#),
        ]);
        let stop_calls = transport.stop_calls.clone();
        let mut supervisor = connect(transport);

        supervisor.shutdown().expect("shutdown 应成功");
        supervisor.shutdown().expect("重复 shutdown 应幂等");
        drop(supervisor);

        assert_eq!(*stop_calls.lock().unwrap(), 1);
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
