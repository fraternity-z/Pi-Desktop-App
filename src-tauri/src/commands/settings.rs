use tauri::State;

use crate::{
    bridge::{protocol::RequestHeaderSettings, runtime::BridgeRuntime},
    error::AppError,
    storage::RequestHeaderSettingsStore,
};

#[tauri::command]
pub fn get_request_header_settings(
    store: State<'_, RequestHeaderSettingsStore>,
) -> RequestHeaderSettings {
    store.state()
}

#[tauri::command]
pub async fn update_request_header_settings(
    runtime: State<'_, BridgeRuntime>,
    store: State<'_, RequestHeaderSettingsStore>,
    settings: RequestHeaderSettings,
) -> Result<RequestHeaderSettings, AppError> {
    let previous = store.state();
    runtime.configure_request_headers(settings.clone())?;
    match store.update(settings) {
        Ok(settings) => Ok(settings),
        Err(error) => {
            let _ = runtime.configure_request_headers(previous);
            Err(error)
        }
    }
}
