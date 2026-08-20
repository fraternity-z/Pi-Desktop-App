use serde::Serialize;
use tauri::State;

use crate::bridge::{protocol::PROTOCOL_VERSION, runtime::BridgeRuntime};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureStatus {
    renderer: &'static str,
    core: &'static str,
    bridge: &'static str,
    protocol_version: u16,
}

#[tauri::command]
pub fn get_architecture_status(runtime: State<'_, BridgeRuntime>) -> ArchitectureStatus {
    architecture_status(runtime.bridge_status())
}

fn architecture_status(bridge: &'static str) -> ArchitectureStatus {
    ArchitectureStatus {
        renderer: "ready",
        core: "ready",
        bridge,
        protocol_version: PROTOCOL_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_all_architecture_layers() {
        let status = architecture_status("ready");

        assert_eq!(status.renderer, "ready");
        assert_eq!(status.core, "ready");
        assert_eq!(status.bridge, "ready");
        assert_eq!(status.protocol_version, 1);
    }
}
