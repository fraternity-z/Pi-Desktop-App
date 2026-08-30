use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_TOOL_DISPLAY_CHARS: usize = 120_000;
pub const THINKING_LEVELS: &[&str] = &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RequestHeaderClient {
    #[default]
    ClaudeCode,
    Codex,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestHeaderSettings {
    pub enabled: bool,
    pub client: RequestHeaderClient,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHello {
    #[serde(rename = "type")]
    pub message_type: String,
    pub protocol_version: u16,
    pub pi_version: String,
    pub node_version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct BridgeStartupError {
    #[serde(rename = "type")]
    pub message_type: String,
    pub error: BridgeErrorPayload,
}

#[derive(Debug, Deserialize)]
pub struct BridgeResponse {
    pub v: u16,
    pub kind: String,
    pub id: String,
    pub ok: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<BridgeErrorPayload>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub v: u16,
    pub kind: String,
    pub seq: u64,
    pub session_id: String,
    pub name: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub reasoning: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTool {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub tokens: u64,
    pub context_window: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackageScope {
    Global,
    Project,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageSummary {
    pub source: String,
    pub scope: PackageScope,
    pub kind: String,
    pub installed_path: Option<String>,
    pub filtered: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageUpdateInfo {
    pub source: String,
    pub display_name: String,
    #[serde(rename = "type")]
    pub update_type: String,
    pub scope: PackageScope,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelection {
    pub provider: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigurationUpdate {
    pub model: Option<ModelSelection>,
    pub thinking_level: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PromptStreamingBehavior {
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessages {
    pub steering: Vec<String>,
    pub follow_up: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolDisplayFormat {
    Text,
    Json,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolDisplayPayload {
    pub text: String,
    pub format: ToolDisplayFormat,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageSummary {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<ToolDisplayPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<ToolDisplayPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfiguration {
    pub model: Option<AgentModel>,
    pub thinking_level: String,
    pub available_thinking_levels: Vec<String>,
    #[serde(default)]
    pub available_tools: Vec<AgentTool>,
    #[serde(default)]
    pub active_tool_names: Vec<String>,
    #[serde(default)]
    pub default_tool_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSession {
    pub session_id: String,
    pub cwd: String,
    pub session_path: Option<String>,
    pub model_fallback_message: Option<String>,
    pub configuration: SessionConfiguration,
    pub messages: Vec<AgentMessageSummary>,
    #[serde(default)]
    pub queued_messages: QueuedMessages,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub context_usage: Option<ContextUsage>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: String,
    pub path: String,
    pub cwd: String,
    pub name: Option<String>,
    pub created: String,
    pub modified: String,
    pub message_count: u64,
    pub first_message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionsResult {
    pub deleted_session_ids: Vec<String>,
    pub missing_session_ids: Vec<String>,
}

pub fn validate_hello(hello: &BridgeHello) -> Result<(), AppError> {
    if hello.message_type != "hello" {
        return Err(AppError::new(
            "BRIDGE_HELLO_INVALID",
            "Bridge 首帧必须为 hello",
        ));
    }

    if hello.protocol_version != PROTOCOL_VERSION {
        return Err(AppError::new(
            "BRIDGE_PROTOCOL_INCOMPATIBLE",
            format!(
                "Bridge 协议版本 {} 与桌面协议版本 {} 不兼容",
                hello.protocol_version, PROTOCOL_VERSION
            ),
        ));
    }

    if hello.pi_version.trim().is_empty() || hello.node_version.trim().is_empty() {
        return Err(AppError::new(
            "BRIDGE_RUNTIME_VERSION_MISSING",
            "Bridge hello 缺少 Pi 或 Node 运行时版本",
        ));
    }

    validate_node_version(&hello.node_version)?;
    validate_pi_version(&hello.pi_version)?;

    for capability in [
        "sessions",
        "streaming",
        "abort",
        "extensions",
        "models",
        "session-history",
        "session-configuration",
        "tool-status",
        "tool-permissions",
        "background-sessions",
        "thinking-stream",
        "queue",
        "request-header-profiles",
        "packages",
        "resources",
        "context-usage",
        "images",
    ] {
        if !hello.capabilities.iter().any(|item| item == capability) {
            return Err(AppError::new(
                "BRIDGE_CAPABILITY_MISSING",
                format!("Bridge 缺少必需能力 {capability}"),
            ));
        }
    }

    Ok(())
}

pub fn parse_hello_frame(line: &str) -> Result<BridgeHello, AppError> {
    validate_frame_size(line)?;
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|_| AppError::new("BRIDGE_INVALID_JSON", "Bridge 首帧不是有效 JSON"))?;

    match value.get("type").and_then(serde_json::Value::as_str) {
        Some("hello") => {
            let hello: BridgeHello = serde_json::from_value(value).map_err(|_| {
                AppError::new("BRIDGE_HELLO_INVALID", "Bridge hello 字段不完整或类型错误")
            })?;
            validate_hello(&hello)?;
            Ok(hello)
        }
        Some("startup.error") => {
            let failure: BridgeStartupError = serde_json::from_value(value).map_err(|_| {
                AppError::new(
                    "BRIDGE_STARTUP_ERROR_INVALID",
                    "Bridge startup.error 字段不完整或类型错误",
                )
            })?;
            let code = sanitize_remote_field(&failure.error.code, "UNKNOWN");
            let message = sanitize_remote_field(&failure.error.message, "Bridge 启动失败");
            Err(AppError::new(
                "BRIDGE_STARTUP_FAILED",
                format!("Bridge 启动失败（{code}）：{message}"),
            ))
        }
        _ => Err(AppError::new(
            "BRIDGE_HELLO_INVALID",
            "Bridge 首帧必须为 hello 或 startup.error",
        )),
    }
}

pub fn validate_frame_size(line: &str) -> Result<(), AppError> {
    if line.len() > MAX_FRAME_BYTES {
        return Err(AppError::new(
            "BRIDGE_FRAME_TOO_LARGE",
            "Bridge 协议帧超过 1 MiB 限制",
        ));
    }
    Ok(())
}

pub fn validate_event(event: &BridgeEvent) -> Result<(), AppError> {
    if event.session_id.trim().is_empty() || event.session_id.len() > 128 {
        return Err(AppError::new(
            "BRIDGE_EVENT_INVALID",
            "Bridge event 会话 id 必须为 1-128 个字符",
        ));
    }
    match event.name.as_str() {
        "agent.started" | "agent.settled" => {
            if event.data.is_some() {
                return Err(invalid_event_data(&event.name));
            }
        }
        "message.delta" | "thinking.delta" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| data.len() == 1 && data.contains_key("delta"));
            let delta = data
                .and_then(|data| data.get("delta"))
                .and_then(serde_json::Value::as_str)
                .filter(|delta| delta.len() <= MAX_FRAME_BYTES);
            if delta.is_none() {
                return Err(invalid_event_data(&event.name));
            }
        }
        "user.message" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| data.len() == 1 && data.contains_key("content"));
            let content = data
                .and_then(|data| data.get("content"))
                .and_then(serde_json::Value::as_str)
                .filter(|content| !content.trim().is_empty() && content.chars().count() <= 200_000);
            if content.is_none() {
                return Err(invalid_event_data(&event.name));
            }
        }
        "message.completed" => {
            let reason = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| data.len() == 1)
                .and_then(|data| data.get("reason"))
                .and_then(serde_json::Value::as_str);
            if !matches!(reason, Some("stop" | "length" | "toolUse")) {
                return Err(invalid_event_data(&event.name));
            }
        }
        "message.failed" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| data.len() == 2);
            let reason = data
                .and_then(|data| data.get("reason"))
                .and_then(serde_json::Value::as_str);
            let message = data
                .and_then(|data| data.get("message"))
                .and_then(serde_json::Value::as_str)
                .filter(|message| !message.trim().is_empty() && message.len() <= 512);
            if !matches!(reason, Some("aborted" | "error" | "pending" | "deferred"))
                || message.is_none()
            {
                return Err(invalid_event_data(&event.name));
            }
        }
        "tool.started" | "tool.completed" | "tool.failed" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| invalid_event_data(&event.name))?;
            let detail_key = if event.name == "tool.started" {
                "input"
            } else {
                "output"
            };
            let valid_shape = data.len() == 2
                || (data.len() == 3
                    && data.contains_key(detail_key)
                    && valid_tool_display_payload(data.get(detail_key)));
            if !valid_shape
                || !valid_bounded_text(data.get("toolCallId"), 256)
                || !valid_bounded_text(data.get("toolName"), 128)
            {
                return Err(invalid_event_data(&event.name));
            }
        }
        "queue.updated" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| {
                    data.len() == 2
                        && data.contains_key("steering")
                        && data.contains_key("followUp")
                });
            if data.and_then(|data| {
                Some(
                    valid_queue_messages(data.get("steering")?)
                        && valid_queue_messages(data.get("followUp")?),
                )
            }) != Some(true)
            {
                return Err(invalid_event_data(&event.name));
            }
        }
        "session.configurationChanged" => {
            let data = event
                .data
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .filter(|data| {
                    (data.len() == 3 || data.len() == 6)
                        && data.contains_key("model")
                        && data.contains_key("thinkingLevel")
                        && data.contains_key("availableThinkingLevels")
                        && valid_model_value(data.get("model"))
                        && (data.len() == 3
                            || (data.contains_key("availableTools")
                                && data.contains_key("activeToolNames")
                                && data.contains_key("defaultToolNames")))
                });
            let configuration = event
                .data
                .clone()
                .filter(|_| data.is_some())
                .and_then(|data| serde_json::from_value::<SessionConfiguration>(data).ok())
                .filter(valid_session_configuration);
            if configuration.is_none() {
                return Err(invalid_event_data(&event.name));
            }
        }
        "session.usageChanged" => {
            if let Some(data) = event.data.clone() {
                let usage = serde_json::from_value::<ContextUsage>(data)
                    .ok()
                    .filter(valid_context_usage);
                if usage.is_none() {
                    return Err(invalid_event_data(&event.name));
                }
            }
        }
        _ => {
            return Err(AppError::new(
                "BRIDGE_EVENT_INVALID",
                "Bridge event 名称不受支持",
            ));
        }
    }
    Ok(())
}

fn valid_model_value(value: Option<&serde_json::Value>) -> bool {
    value.is_some_and(|value| {
        value.is_null()
            || value.as_object().is_some_and(|model| {
                model.len() == 4
                    && model.contains_key("provider")
                    && model.contains_key("id")
                    && model.contains_key("name")
                    && model.contains_key("reasoning")
            })
    })
}

pub(crate) fn valid_session_configuration(configuration: &SessionConfiguration) -> bool {
    let model_valid = configuration.model.as_ref().is_none_or(|model| {
        !model.provider.trim().is_empty()
            && model.provider.len() <= 128
            && !model.id.trim().is_empty()
            && model.id.len() <= 256
            && !model.name.trim().is_empty()
            && model.name.len() <= 256
    });
    let available_names: std::collections::HashSet<&str> = configuration
        .available_tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect();
    let tools_valid = configuration.available_tools.len() <= 256
        && available_names.len() == configuration.available_tools.len()
        && configuration
            .available_tools
            .iter()
            .all(|tool| valid_tool_name(&tool.name) && tool.description.chars().count() <= 1_024);
    let mut thinking_names = std::collections::HashSet::new();
    let thinking_levels_valid = !configuration.available_thinking_levels.is_empty()
        && configuration.available_thinking_levels.len() <= THINKING_LEVELS.len()
        && configuration.available_thinking_levels.iter().all(|level| {
            THINKING_LEVELS.contains(&level.as_str()) && thinking_names.insert(level.as_str())
        });
    model_valid
        && THINKING_LEVELS.contains(&configuration.thinking_level.as_str())
        && thinking_levels_valid
        && configuration
            .available_thinking_levels
            .iter()
            .any(|level| level == &configuration.thinking_level)
        && tools_valid
        && valid_tool_selection(&configuration.active_tool_names, &available_names)
        && valid_tool_selection(&configuration.default_tool_names, &available_names)
}

fn valid_context_usage(usage: &ContextUsage) -> bool {
    usage.context_window > 0 && usage.percent.is_finite() && (0.0..=100.0).contains(&usage.percent)
}

fn valid_tool_selection(
    names: &[String],
    available_names: &std::collections::HashSet<&str>,
) -> bool {
    if names.len() > 256 {
        return false;
    }
    let mut unique = std::collections::HashSet::new();
    names.iter().all(|name| {
        valid_tool_name(name) && available_names.contains(name.as_str()) && unique.insert(name)
    })
}

fn valid_tool_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 && !name.contains(['\r', '\n', '\0'])
}

fn valid_bounded_text(value: Option<&serde_json::Value>, maximum_length: usize) -> bool {
    value
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty() && value.len() <= maximum_length)
}

fn valid_tool_display_payload(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(|value| serde_json::from_value::<ToolDisplayPayload>(value.clone()).ok())
        .is_some_and(|payload| {
            !payload.text.trim().is_empty()
                && payload.text.chars().count() <= MAX_TOOL_DISPLAY_CHARS
        })
}

fn valid_queue_messages(value: &serde_json::Value) -> bool {
    let Some(messages) = value.as_array().filter(|messages| messages.len() <= 64) else {
        return false;
    };
    let mut total = 0;
    for message in messages {
        let Some(message) = message
            .as_str()
            .filter(|message| !message.trim().is_empty() && message.chars().count() <= 200_000)
        else {
            return false;
        };
        total += message.chars().count();
        if total > 400_000 {
            return false;
        }
    }
    true
}

fn invalid_event_data(name: &str) -> AppError {
    AppError::new(
        "BRIDGE_EVENT_INVALID",
        format!("Bridge event {name} 数据无效"),
    )
}

fn validate_node_version(version: &str) -> Result<(), AppError> {
    let (major, minor, _) = parse_version(version, "Node.js")?;
    if major < 22 || (major == 22 && minor < 19) {
        return Err(AppError::new(
            "NODE_VERSION_UNSUPPORTED",
            format!("Node.js {version} 不受支持，需要 22.19 或更高版本"),
        ));
    }
    Ok(())
}

fn validate_pi_version(version: &str) -> Result<(), AppError> {
    let (major, minor, _) = parse_version(version, "Pi SDK")?;
    if major != 0 || !(83..86).contains(&minor) {
        return Err(AppError::new(
            "SDK_VERSION_UNSUPPORTED",
            format!("Pi SDK {version} 不受支持，需要 >=0.83 且 <0.86"),
        ));
    }
    Ok(())
}

fn parse_version(version: &str, runtime_name: &str) -> Result<(u64, u64, u64), AppError> {
    let normalized = version
        .trim()
        .strip_prefix('v')
        .unwrap_or(version.trim())
        .split('-')
        .next()
        .unwrap_or_default();
    let mut parts = normalized.split('.');
    let major = parts.next().and_then(|part| part.parse().ok());
    let minor = parts.next().and_then(|part| part.parse().ok());
    let patch = parts.next().unwrap_or("0").parse().ok();
    if parts.next().is_some() || major.is_none() || minor.is_none() || patch.is_none() {
        return Err(AppError::new(
            "BRIDGE_RUNTIME_VERSION_INVALID",
            format!("{runtime_name} 版本格式无效：{version}"),
        ));
    }
    Ok((major.unwrap(), minor.unwrap(), patch.unwrap()))
}

fn sanitize_remote_field<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    let value = value.trim();
    if value.is_empty() { fallback } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_CAPABILITIES: &[&str] = &[
        "sessions",
        "streaming",
        "abort",
        "extensions",
        "models",
        "session-history",
        "session-configuration",
        "tool-status",
        "tool-permissions",
        "background-sessions",
        "thinking-stream",
        "queue",
        "request-header-profiles",
        "packages",
        "resources",
        "context-usage",
        "images",
    ];

    fn hello(protocol_version: u16, capabilities: &[&str]) -> BridgeHello {
        BridgeHello {
            message_type: "hello".to_owned(),
            protocol_version,
            pi_version: "0.84.2".to_owned(),
            node_version: "22.19.0".to_owned(),
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
        }
    }

    #[test]
    fn accepts_compatible_hello() {
        let result = validate_hello(&hello(1, ALL_CAPABILITIES));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn deserializes_bridge_json_shape() {
        let value: BridgeHello = serde_json::from_str(
            r#"{"type":"hello","protocolVersion":1,"piVersion":"0.84.2","nodeVersion":"22.23.2","capabilities":["sessions","streaming","abort","extensions","models","session-history","session-configuration","tool-status","tool-permissions","background-sessions","thinking-stream","queue","request-header-profiles","packages","resources","context-usage","images"]}"#,
        )
        .expect("Bridge hello JSON 必须可反序列化");

        assert_eq!(validate_hello(&value), Ok(()));
        assert_eq!(value.pi_version, "0.84.2");
    }

    #[test]
    fn rejects_incompatible_protocol() {
        let error =
            validate_hello(&hello(2, ALL_CAPABILITIES)).expect_err("协议版本不兼容时必须失败");

        assert_eq!(error.code, "BRIDGE_PROTOCOL_INCOMPATIBLE");
    }

    #[test]
    fn rejects_missing_capability() {
        let error = validate_hello(&hello(1, &["sessions", "streaming", "abort"]))
            .expect_err("缺少必需能力时必须失败");

        assert_eq!(error.code, "BRIDGE_CAPABILITY_MISSING");
    }

    #[test]
    fn rejects_non_hello_frame() {
        let mut value = hello(1, ALL_CAPABILITIES);
        value.message_type = "event".to_owned();

        let error = validate_hello(&value).expect_err("首帧类型错误时必须失败");

        assert_eq!(error.code, "BRIDGE_HELLO_INVALID");
    }

    #[test]
    fn rejects_missing_runtime_version() {
        let mut value = hello(1, ALL_CAPABILITIES);
        value.pi_version.clear();

        let error = validate_hello(&value).expect_err("运行时版本缺失时必须失败");

        assert_eq!(error.code, "BRIDGE_RUNTIME_VERSION_MISSING");
    }

    #[test]
    fn rejects_unsupported_node_version() {
        let mut value = hello(1, ALL_CAPABILITIES);
        value.node_version = "22.18.0".to_owned();

        let error = validate_hello(&value).expect_err("旧 Node.js 版本必须被拒绝");

        assert_eq!(error.code, "NODE_VERSION_UNSUPPORTED");
    }

    #[test]
    fn rejects_unsupported_pi_version() {
        let mut value = hello(1, ALL_CAPABILITIES);
        value.pi_version = "0.86.0".to_owned();

        let error = validate_hello(&value).expect_err("超出范围的 Pi SDK 必须被拒绝");

        assert_eq!(error.code, "SDK_VERSION_UNSUPPORTED");
    }

    #[test]
    fn rejects_malformed_runtime_version() {
        let mut value = hello(1, ALL_CAPABILITIES);
        value.node_version = "current".to_owned();

        let error = validate_hello(&value).expect_err("非法版本格式必须被拒绝");

        assert_eq!(error.code, "BRIDGE_RUNTIME_VERSION_INVALID");
    }

    #[test]
    fn maps_structured_startup_error() {
        let error = parse_hello_frame(
            r#"{"type":"startup.error","error":{"code":"SDK_IMPORT_FAILED","message":"无法加载 Pi SDK 模块"}}"#,
        )
        .expect_err("startup.error 必须映射为稳定错误");

        assert_eq!(error.code, "BRIDGE_STARTUP_FAILED");
        assert!(error.message.contains("SDK_IMPORT_FAILED"));
    }

    #[test]
    fn rejects_oversized_frame() {
        let error =
            validate_frame_size(&"x".repeat(MAX_FRAME_BYTES + 1)).expect_err("超大帧必须被拒绝");

        assert_eq!(error.code, "BRIDGE_FRAME_TOO_LARGE");
    }

    #[test]
    fn validates_tool_event_contract() {
        let legacy: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"tool.started","data":{"toolCallId":"tool-1","toolName":"read"}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&legacy), Ok(()));

        let started: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":2,"sessionId":"s-1","name":"tool.started","data":{"toolCallId":"tool-1","toolName":"read","input":{"text":"{\n  \"path\": \"C:\\\\work\\\\README.md\"\n}","format":"json","truncated":false}}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&started), Ok(()));

        let completed: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":3,"sessionId":"s-1","name":"tool.completed","data":{"toolCallId":"tool-1","toolName":"read","output":{"text":"read ok","format":"text","truncated":false}}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&completed), Ok(()));

        let invalid: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"tool.started","data":{"toolCallId":"tool-1","toolName":"read","args":{"path":"secret"}}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&invalid)
                .expect_err("额外工具参数必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );

        for invalid in [
            r#"{"v":1,"kind":"event","seq":4,"sessionId":"s-1","name":"tool.started","data":{"toolCallId":"tool-1","toolName":"read","output":{"text":"wrong phase","format":"text","truncated":false}}}"#,
            r#"{"v":1,"kind":"event","seq":5,"sessionId":"s-1","name":"tool.completed","data":{"toolCallId":"tool-1","toolName":"read","output":{"text":"bad shape","format":"text","truncated":false,"raw":true}}}"#,
            r#"{"v":1,"kind":"event","seq":6,"sessionId":"s-1","name":"tool.completed","data":{"toolCallId":"tool-1","toolName":"read","output":{"text":"bad format","format":"markdown","truncated":false}}}"#,
        ] {
            let event: BridgeEvent = serde_json::from_str(invalid).unwrap();
            assert_eq!(
                validate_event(&event)
                    .expect_err("错误的工具展示载荷必须失败")
                    .code,
                "BRIDGE_EVENT_INVALID"
            );
        }

        let oversized = BridgeEvent {
            v: 1,
            kind: "event".to_owned(),
            seq: 7,
            session_id: "s-1".to_owned(),
            name: "tool.completed".to_owned(),
            data: Some(serde_json::json!({
                "toolCallId": "tool-1",
                "toolName": "read",
                "output": {
                    "text": "x".repeat(MAX_TOOL_DISPLAY_CHARS + 1),
                    "format": "text",
                    "truncated": true
                }
            })),
        };
        assert_eq!(
            validate_event(&oversized)
                .expect_err("超长工具展示载荷必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }

    #[test]
    fn validates_queue_event_contract() {
        let event: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"queue.updated","data":{"steering":["guide"],"followUp":["later"]}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&event), Ok(()));

        let invalid: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"queue.updated","data":{"steering":[1],"followUp":[]}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&invalid)
                .expect_err("非字符串队列项必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }

    #[test]
    fn validates_context_usage_event_contract() {
        let event: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.usageChanged","data":{"tokens":4096,"contextWindow":32768,"percent":12.5}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&event), Ok(()));

        let invalid: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.usageChanged","data":{"tokens":4096,"contextWindow":0,"percent":120}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&invalid)
                .expect_err("越界上下文占用必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }

    #[test]
    fn rejects_unknown_event_name_and_invalid_configuration() {
        let unknown: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"extension.ui"}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&unknown).expect_err("未知事件必须失败").code,
            "BRIDGE_EVENT_INVALID"
        );

        let invalid_configuration: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"ultra","availableThinkingLevels":[]}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&invalid_configuration)
                .expect_err("无效会话配置事件必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }

    #[test]
    fn validates_sdk_tool_configuration_and_legacy_payloads() {
        let current: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off"],"availableTools":[{"name":"read","description":"Read files"},{"name":"bash","description":"Run commands"}],"activeToolNames":["read"],"defaultToolNames":["read","bash"]}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&current), Ok(()));

        let legacy: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off"]}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&legacy), Ok(()));

        let invalid: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off"],"availableTools":[{"name":"read","description":"Read files"}],"activeToolNames":["bash"],"defaultToolNames":["read"]}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&invalid)
                .expect_err("未知活动工具必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }

    #[test]
    fn validates_complete_thinking_levels_and_current_membership() {
        let full: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"max","availableThinkingLevels":["off","minimal","low","medium","high","xhigh","max"]}}"#,
        )
        .unwrap();
        assert_eq!(validate_event(&full), Ok(()));

        let mismatch: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"high","availableThinkingLevels":["off"]}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&mismatch)
                .expect_err("当前档位不在能力集合中必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );

        let duplicate: BridgeEvent = serde_json::from_str(
            r#"{"v":1,"kind":"event","seq":1,"sessionId":"s-1","name":"session.configurationChanged","data":{"model":null,"thinkingLevel":"off","availableThinkingLevels":["off","off"]}}"#,
        )
        .unwrap();
        assert_eq!(
            validate_event(&duplicate)
                .expect_err("重复的思考档位必须失败")
                .code,
            "BRIDGE_EVENT_INVALID"
        );
    }
}
