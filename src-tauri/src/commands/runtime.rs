use tauri::State;

use crate::bridge::runtime::{BridgeRuntime, RuntimeSnapshot};

#[tauri::command]
pub fn get_runtime_status(runtime: State<'_, BridgeRuntime>) -> RuntimeSnapshot {
    runtime.snapshot()
}
