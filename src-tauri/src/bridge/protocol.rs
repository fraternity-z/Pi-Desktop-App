use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

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
pub struct CreatedSession {
    pub session_id: String,
    pub model_fallback_message: Option<String>,
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

    for capability in ["sessions", "streaming", "abort", "extensions"] {
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
        let result = validate_hello(&hello(1, &["sessions", "streaming", "abort", "extensions"]));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn deserializes_bridge_json_shape() {
        let value: BridgeHello = serde_json::from_str(
            r#"{"type":"hello","protocolVersion":1,"piVersion":"0.84.2","nodeVersion":"22.23.2","capabilities":["sessions","streaming","abort","extensions"]}"#,
        )
        .expect("Bridge hello JSON 必须可反序列化");

        assert_eq!(validate_hello(&value), Ok(()));
        assert_eq!(value.pi_version, "0.84.2");
    }

    #[test]
    fn rejects_incompatible_protocol() {
        let error = validate_hello(&hello(2, &["sessions", "streaming", "abort", "extensions"]))
            .expect_err("协议版本不兼容时必须失败");

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
        let mut value = hello(1, &["sessions", "streaming", "abort", "extensions"]);
        value.message_type = "event".to_owned();

        let error = validate_hello(&value).expect_err("首帧类型错误时必须失败");

        assert_eq!(error.code, "BRIDGE_HELLO_INVALID");
    }

    #[test]
    fn rejects_missing_runtime_version() {
        let mut value = hello(1, &["sessions", "streaming", "abort", "extensions"]);
        value.pi_version.clear();

        let error = validate_hello(&value).expect_err("运行时版本缺失时必须失败");

        assert_eq!(error.code, "BRIDGE_RUNTIME_VERSION_MISSING");
    }

    #[test]
    fn rejects_unsupported_node_version() {
        let mut value = hello(1, &["sessions", "streaming", "abort", "extensions"]);
        value.node_version = "22.18.0".to_owned();

        let error = validate_hello(&value).expect_err("旧 Node.js 版本必须被拒绝");

        assert_eq!(error.code, "NODE_VERSION_UNSUPPORTED");
    }

    #[test]
    fn rejects_unsupported_pi_version() {
        let mut value = hello(1, &["sessions", "streaming", "abort", "extensions"]);
        value.pi_version = "0.86.0".to_owned();

        let error = validate_hello(&value).expect_err("超出范围的 Pi SDK 必须被拒绝");

        assert_eq!(error.code, "SDK_VERSION_UNSUPPORTED");
    }

    #[test]
    fn rejects_malformed_runtime_version() {
        let mut value = hello(1, &["sessions", "streaming", "abort", "extensions"]);
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
}
