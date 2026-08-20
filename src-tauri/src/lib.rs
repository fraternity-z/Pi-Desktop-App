pub mod bridge;
mod commands;
pub mod discovery;
pub mod error;
pub mod storage;

use std::sync::Arc;

use tauri::{Emitter, Manager, path::BaseDirectory};

use crate::{
    bridge::{protocol::BridgeEvent, runtime::BridgeRuntime, supervisor::BridgeEventSink},
    error::AppError,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let event_app = app.handle().clone();
            let event_sink: BridgeEventSink = Arc::new(move |event: BridgeEvent| {
                let _ = event_app.emit("agent://event", event);
            });
            let runtime = app
                .path()
                .resolve("resources/pi-bridge/pi-bridge.mjs", BaseDirectory::Resource)
                .map(|path| BridgeRuntime::initialize(path, event_sink))
                .unwrap_or_else(|_| {
                    BridgeRuntime::unavailable(AppError::new(
                        "BRIDGE_RESOURCE_MISSING",
                        "无法解析打包的 Bridge 资源路径",
                    ))
                });
            app.manage(runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::diagnostics::get_architecture_status,
            commands::runtime::get_runtime_status,
            commands::runtime::agent_create_session,
            commands::runtime::agent_prompt,
            commands::runtime::agent_abort
        ])
        .run(tauri::generate_context!())
        .expect("启动 Pi Desktop 的 Tauri Runtime 失败");
}
