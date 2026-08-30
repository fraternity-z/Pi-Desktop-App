use tauri::{AppHandle, Manager};

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
    image::PROMPT_IMAGE_CACHE_DIR,
    storage::WorkspaceStore,
};

#[tauri::command]
pub async fn get_runtime_status(app: AppHandle) -> Result<RuntimeSnapshot, AppError> {
    Ok(app.state::<BridgeRuntime>().snapshot())
}

#[tauri::command]
pub async fn restart_runtime(app: AppHandle) -> Result<RuntimeSnapshot, AppError> {
    run_runtime(app, |_, runtime| Ok(runtime.restart())).await
}

#[tauri::command]
pub async fn agent_create_session(app: AppHandle, cwd: String) -> Result<CreatedSession, AppError> {
    run_runtime(app, move |_, runtime| runtime.create_session(cwd)).await
}

#[tauri::command]
pub async fn agent_list_sessions(app: AppHandle) -> Result<Vec<AgentSessionSummary>, AppError> {
    run_runtime(app, |_, runtime| runtime.list_sessions()).await
}

#[tauri::command]
pub async fn agent_delete_sessions(
    app: AppHandle,
    session_ids: Vec<String>,
) -> Result<DeleteSessionsResult, AppError> {
    run_runtime(app, move |_, runtime| runtime.delete_sessions(session_ids)).await
}

#[tauri::command]
pub async fn agent_open_session(
    app: AppHandle,
    session_path: String,
) -> Result<CreatedSession, AppError> {
    run_runtime(app, move |_, runtime| runtime.open_session(session_path)).await
}

#[tauri::command]
pub async fn agent_list_models(app: AppHandle) -> Result<Vec<AgentModel>, AppError> {
    run_runtime(app, |_, runtime| runtime.list_models()).await
}

#[tauri::command]
pub async fn agent_list_packages(
    app: AppHandle,
    cwd: String,
) -> Result<Vec<PackageSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.list_packages(app.state::<WorkspaceStore>().authorize(&cwd)?)
    })
    .await
}

#[tauri::command]
pub async fn agent_install_package(
    app: AppHandle,
    cwd: String,
    source: String,
    scope: PackageScope,
) -> Result<Vec<PackageSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.install_package(
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            source,
            scope,
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_set_package_enabled(
    app: AppHandle,
    cwd: String,
    source: String,
    scope: PackageScope,
    enabled: bool,
) -> Result<Vec<PackageSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.set_package_enabled(
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            source,
            scope,
            enabled,
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_remove_package(
    app: AppHandle,
    cwd: String,
    source: String,
    scope: PackageScope,
) -> Result<Vec<PackageSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.remove_package(
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            source,
            scope,
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_update_package(
    app: AppHandle,
    cwd: String,
    source: Option<String>,
) -> Result<Vec<PackageSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.update_package(app.state::<WorkspaceStore>().authorize(&cwd)?, source)
    })
    .await
}

#[tauri::command]
pub async fn agent_check_package_updates(
    app: AppHandle,
    cwd: String,
) -> Result<Vec<PackageUpdateInfo>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.check_package_updates(app.state::<WorkspaceStore>().authorize(&cwd)?)
    })
    .await
}

#[tauri::command]
pub async fn agent_list_resources(
    app: AppHandle,
    cwd: String,
) -> Result<Vec<ResourceSummary>, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.list_resources(app.state::<WorkspaceStore>().authorize(&cwd)?)
    })
    .await
}

#[tauri::command]
pub async fn agent_configure_session(
    app: AppHandle,
    session_id: String,
    update: SessionConfigurationUpdate,
) -> Result<SessionConfiguration, AppError> {
    run_runtime(app, move |_, runtime| {
        runtime.configure_session(session_id, update)
    })
    .await
}

#[tauri::command]
pub async fn agent_prompt(
    app: AppHandle,
    session_id: String,
    text: String,
    streaming_behavior: Option<PromptStreamingBehavior>,
    active_tools: Option<Vec<String>>,
    image_paths: Option<Vec<String>>,
) -> Result<u64, AppError> {
    run_runtime(app, move |app, runtime| {
        let image_root = if image_paths.is_some() {
            Some(
                app.path()
                    .app_cache_dir()
                    .map_err(|_| {
                        AppError::new("PROMPT_IMAGE_PATH_INVALID", "无法解析图片缓存目录")
                    })?
                    .join(PROMPT_IMAGE_CACHE_DIR),
            )
        } else {
            None
        };
        runtime.prompt(
            session_id,
            text,
            streaming_behavior,
            active_tools,
            image_paths,
            image_root,
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_clear_queue(app: AppHandle, session_id: String) -> Result<(), AppError> {
    run_runtime(app, move |_, runtime| runtime.clear_queue(session_id)).await
}

#[tauri::command]
pub async fn agent_abort(app: AppHandle, session_id: String) -> Result<(), AppError> {
    run_runtime(app, move |_, runtime| runtime.abort(session_id)).await
}

pub(crate) async fn run_runtime<T: Send + 'static>(
    app: AppHandle,
    task: impl FnOnce(&AppHandle, &BridgeRuntime) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<BridgeRuntime>();
        task(&app, &runtime)
    })
    .await
    .map_err(|_| AppError::new("BRIDGE_OPERATION_TASK_FAILED", "Pi Bridge 操作任务异常终止"))?
}
