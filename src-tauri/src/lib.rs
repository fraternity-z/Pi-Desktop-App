pub mod bridge;
mod commands;
pub mod discovery;
pub mod error;
pub mod storage;

use std::sync::Arc;

use tauri::{Emitter, Manager, path::BaseDirectory};

use crate::{
    bridge::{
        protocol::BridgeEvent,
        runtime::BridgeRuntime,
        supervisor::{BridgeEventSink, BridgeFaultSink},
    },
    error::AppError,
    storage::{RequestHeaderSettingsStore, WorkspaceStore},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| error.to_string())?;
            let request_header_store = RequestHeaderSettingsStore::new(config_dir.clone());
            let request_header_settings = request_header_store.state();
            let event_app = app.handle().clone();
            let event_sink: BridgeEventSink = Arc::new(move |event: BridgeEvent| {
                let _ = event_app.emit("agent://event", event);
            });
            let fault_app = app.handle().clone();
            let fault_sink: BridgeFaultSink = Arc::new(move |error: AppError| {
                let _ = fault_app.emit("runtime://fault", error);
            });
            let runtime = app
                .path()
                .resolve("resources/pi-bridge/pi-bridge.mjs", BaseDirectory::Resource)
                .map(|path| {
                    BridgeRuntime::initialize_with_fault_sink(
                        path,
                        event_sink,
                        fault_sink,
                        request_header_settings.clone(),
                    )
                })
                .unwrap_or_else(|_| {
                    BridgeRuntime::unavailable(
                        AppError::new("BRIDGE_RESOURCE_MISSING", "无法解析打包的 Bridge 资源路径"),
                        request_header_settings,
                    )
                });
            app.manage(runtime);
            app.manage(request_header_store);
            let documents_dir = app
                .path()
                .document_dir()
                .map_err(|error| error.to_string())?;
            app.manage(WorkspaceStore::new(config_dir, documents_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::appearance::install_appearance_background,
            commands::appearance::import_appearance_theme,
            commands::appearance::export_appearance_theme,
            commands::diagnostics::get_architecture_status,
            commands::notifications::open_system_notification_settings,
            commands::browser::browser_sidebar_open,
            commands::browser::browser_sidebar_update_bounds,
            commands::browser::browser_sidebar_hide,
            commands::runtime::get_runtime_status,
            commands::runtime::agent_create_session,
            commands::runtime::agent_list_sessions,
            commands::runtime::agent_delete_sessions,
            commands::runtime::agent_open_session,
            commands::runtime::agent_list_models,
            commands::runtime::agent_list_packages,
            commands::runtime::agent_install_package,
            commands::runtime::agent_set_package_enabled,
            commands::runtime::agent_remove_package,
            commands::runtime::agent_update_package,
            commands::runtime::agent_check_package_updates,
            commands::runtime::agent_list_resources,
            commands::runtime::agent_configure_session,
            commands::runtime::agent_prompt,
            commands::runtime::agent_clear_queue,
            commands::runtime::agent_abort,
            commands::settings::get_request_header_settings,
            commands::settings::update_request_header_settings,
            commands::git::git_get_status,
            commands::git::git_get_diff,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_init,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_create_branch,
            commands::workspace::workspace_get_state,
            commands::workspace::workspace_remember,
            commands::workspace::workspace_remove_recent,
            commands::workspace::workspace_ensure_conversation,
            commands::workspace::workspace_reveal,
            commands::workspace::workspace_read_file,
            commands::workspace::workspace_open_file,
            commands::workspace::workspace_reveal_file,
            commands::workspace::workspace_search_paths,
            commands::workspace::workspace_get_worktree_options,
            commands::workspace::workspace_create_worktree
        ])
        .run(tauri::generate_context!())
        .expect("启动 Pi Desktop 的 Tauri Runtime 失败");
}
