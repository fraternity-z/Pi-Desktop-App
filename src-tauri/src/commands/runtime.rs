use tauri::{AppHandle, Manager, State};

use crate::{
    bridge::{
        protocol::{
            AgentModel, AgentSessionSummary, CreatedSession, DeleteSessionsResult, PackageScope,
            PackageSummary, PackageUpdateInfo, PromptStreamingBehavior, ResourceSummary,
            SessionConfiguration, SessionConfigurationUpdate,
        },
        runtime::{BridgeRuntime, RuntimeSnapshot},
    },
    error::AppError,
    storage::WorkspaceStore,
};

#[tauri::command]
pub async fn get_runtime_status(app: AppHandle) -> Result<RuntimeSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BridgeRuntime>().snapshot())
        .await
        .map_err(|_| {
            AppError::new(
                "RUNTIME_STATUS_TASK_FAILED",
                "检测 Pi 运行时状态时任务异常终止",
            )
        })
}

#[tauri::command]
pub async fn agent_create_session(
    runtime: State<'_, BridgeRuntime>,
    cwd: String,
) -> Result<CreatedSession, AppError> {
    runtime.create_session(cwd)
}

#[tauri::command]
pub async fn agent_list_sessions(
    runtime: State<'_, BridgeRuntime>,
) -> Result<Vec<AgentSessionSummary>, AppError> {
    runtime.list_sessions()
}

#[tauri::command]
pub async fn agent_delete_sessions(
    runtime: State<'_, BridgeRuntime>,
    session_ids: Vec<String>,
) -> Result<DeleteSessionsResult, AppError> {
    runtime.delete_sessions(session_ids)
}

#[tauri::command]
pub async fn agent_open_session(
    runtime: State<'_, BridgeRuntime>,
    session_path: String,
) -> Result<CreatedSession, AppError> {
    runtime.open_session(session_path)
}

#[tauri::command]
pub async fn agent_list_models(
    runtime: State<'_, BridgeRuntime>,
) -> Result<Vec<AgentModel>, AppError> {
    runtime.list_models()
}

#[tauri::command]
pub async fn agent_list_packages(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<Vec<PackageSummary>, AppError> {
    runtime.list_packages(workspace.authorize(&cwd)?)
}

#[tauri::command]
pub async fn agent_install_package(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
    source: String,
    scope: PackageScope,
) -> Result<Vec<PackageSummary>, AppError> {
    runtime.install_package(workspace.authorize(&cwd)?, source, scope)
}

#[tauri::command]
pub async fn agent_set_package_enabled(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
    source: String,
    scope: PackageScope,
    enabled: bool,
) -> Result<Vec<PackageSummary>, AppError> {
    runtime.set_package_enabled(workspace.authorize(&cwd)?, source, scope, enabled)
}

#[tauri::command]
pub async fn agent_remove_package(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
    source: String,
    scope: PackageScope,
) -> Result<Vec<PackageSummary>, AppError> {
    runtime.remove_package(workspace.authorize(&cwd)?, source, scope)
}

#[tauri::command]
pub async fn agent_update_package(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
    source: Option<String>,
) -> Result<Vec<PackageSummary>, AppError> {
    runtime.update_package(workspace.authorize(&cwd)?, source)
}

#[tauri::command]
pub async fn agent_check_package_updates(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<Vec<PackageUpdateInfo>, AppError> {
    runtime.check_package_updates(workspace.authorize(&cwd)?)
}

#[tauri::command]
pub async fn agent_list_resources(
    runtime: State<'_, BridgeRuntime>,
    workspace: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<Vec<ResourceSummary>, AppError> {
    runtime.list_resources(workspace.authorize(&cwd)?)
}

#[tauri::command]
pub async fn agent_configure_session(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
    update: SessionConfigurationUpdate,
) -> Result<SessionConfiguration, AppError> {
    runtime.configure_session(session_id, update)
}

#[tauri::command]
pub async fn agent_prompt(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
    text: String,
    streaming_behavior: Option<PromptStreamingBehavior>,
    active_tools: Option<Vec<String>>,
) -> Result<u64, AppError> {
    runtime.prompt(session_id, text, streaming_behavior, active_tools)
}

#[tauri::command]
pub async fn agent_clear_queue(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
) -> Result<(), AppError> {
    runtime.clear_queue(session_id)
}

#[tauri::command]
pub async fn agent_abort(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
) -> Result<(), AppError> {
    runtime.abort(session_id)
}
