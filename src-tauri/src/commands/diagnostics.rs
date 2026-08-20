use serde::Serialize;

use crate::bridge::protocol::PROTOCOL_VERSION;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureStatus {
    renderer: &'static str,
    core: &'static str,
    bridge: &'static str,
    protocol_version: u16,
}

#[tauri::command]
pub fn get_architecture_status() -> ArchitectureStatus {
    ArchitectureStatus {
        renderer: "ready",
        core: "ready",
        bridge: "not-started",
        protocol_version: PROTOCOL_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_all_architecture_layers() {
        let status = get_architecture_status();

        assert_eq!(status.renderer, "ready");
        assert_eq!(status.core, "ready");
        assert_eq!(status.bridge, "not-started");
        assert_eq!(status.protocol_version, 1);
    }
}
