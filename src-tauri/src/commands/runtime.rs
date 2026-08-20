use tauri::State;

use crate::{
    bridge::{
        protocol::CreatedSession,
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
pub async fn agent_prompt(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
    text: String,
) -> Result<(), AppError> {
    runtime.prompt(session_id, text)
}

#[tauri::command]
pub async fn agent_abort(
    runtime: State<'_, BridgeRuntime>,
    session_id: String,
) -> Result<(), AppError> {
    runtime.abort(session_id)
}
