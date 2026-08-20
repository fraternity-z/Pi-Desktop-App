use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHello {
    #[serde(rename = "type")]
    pub message_type: String,
    pub protocol_version: u16,
    pub pi_version: String,
    pub node_version: String,
    pub capabilities: Vec<String>,
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
}
