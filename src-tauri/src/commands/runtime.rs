use tauri::State;

use crate::{
    bridge::{
        protocol::{
            AgentModel, AgentSessionSummary, CreatedSession, PromptStreamingBehavior,
            SessionConfiguration, SessionConfigurationUpdate,
        },
        runtime::{BridgeRuntime, RuntimeSnapshot},
    },
    error::AppError,
};

#[tauri::command]
pub fn get_runtime_status(runtime: State<'_, BridgeRuntime>) -> RuntimeSnapshot {
    runtime.snapshot()
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
) -> Result<u64, AppError> {
    runtime.prompt(session_id, text, streaming_behavior)
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
