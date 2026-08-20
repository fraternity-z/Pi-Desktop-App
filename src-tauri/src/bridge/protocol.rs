use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeHello {
    pub protocol_version: u16,
    pub node_version: String,
    pub capabilities: Vec<String>,
}

pub fn validate_hello(hello: &BridgeHello) -> Result<(), AppError> {
    if hello.protocol_version != PROTOCOL_VERSION {
        return Err(AppError::new(
            "BRIDGE_PROTOCOL_INCOMPATIBLE",
            format!(
                "Bridge 协议版本 {} 与桌面协议版本 {} 不兼容",
                hello.protocol_version, PROTOCOL_VERSION
            ),
        ));
    }

    for capability in ["ping", "health", "shutdown"] {
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
            protocol_version,
            node_version: "22.19.0".to_owned(),
            capabilities: capabilities.iter().map(|item| (*item).to_owned()).collect(),
        }
    }

    #[test]
    fn accepts_compatible_hello() {
        let result = validate_hello(&hello(1, &["ping", "health", "shutdown"]));

        assert_eq!(result, Ok(()));
    }

    #[test]
    fn rejects_incompatible_protocol() {
        let error = validate_hello(&hello(2, &["ping", "health", "shutdown"]))
            .expect_err("协议版本不兼容时必须失败");

        assert_eq!(error.code, "BRIDGE_PROTOCOL_INCOMPATIBLE");
    }

    #[test]
    fn rejects_missing_capability() {
        let error =
            validate_hello(&hello(1, &["ping", "health"])).expect_err("缺少必需能力时必须失败");

        assert_eq!(error.code, "BRIDGE_CAPABILITY_MISSING");
    }
}
