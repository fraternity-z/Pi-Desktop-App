use tauri::State;

use crate::{
    error::AppError,
    storage::{WorkspaceState, WorkspaceStore},
};

#[tauri::command]
pub fn workspace_get_state(store: State<'_, WorkspaceStore>) -> WorkspaceState {
    store.state()
}

#[tauri::command]
pub fn workspace_remember(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<WorkspaceState, AppError> {
    store.remember(&cwd)
}

#[tauri::command]
pub fn workspace_remove_recent(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<WorkspaceState, AppError> {
    store.remove_recent(&cwd)
}

#[tauri::command]
pub fn workspace_ensure_conversation(store: State<'_, WorkspaceStore>) -> Result<String, AppError> {
    store.ensure_conversation()
}
