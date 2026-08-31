use tauri::{AppHandle, Manager, State};

use crate::{
    bridge::{protocol::RequestHeaderSettings, runtime::BridgeRuntime},
    discovery::RuntimeMode,
    error::AppError,
    storage::{AppSettings, AppSettingsStore, RequestHeaderSettingsStore},
};

#[tauri::command]
pub fn get_runtime_settings(store: State<'_, AppSettingsStore>) -> AppSettings {
    store.state()
}

#[tauri::command]
pub async fn set_runtime_mode(app: AppHandle, mode: String) -> Result<AppSettings, AppError> {
    let mode = RuntimeMode::parse(&mode)?;
    let store = app.state::<AppSettingsStore>();
    let previous = store.state();
    let settings = store.set_runtime_mode(mode)?;
    let runtime = app.state::<BridgeRuntime>();
    if let Err(error) = runtime.set_runtime_mode(mode) {
        // Keep persisted and in-memory preferences consistent if a poisoned
        // runtime lock prevents the switch from being applied.
        let previous_mode = RuntimeMode::parse(&previous.runtime_mode).unwrap_or_default();
        let _ = store.set_runtime_mode(previous_mode);
        return Err(error);
    }
    let request = match runtime.request_restart() {
        Ok(request) => request,
        Err(error) => {
            // A closed runtime cannot apply the new preference. Roll back both
            // copies so the next launch does not silently diverge from memory.
            let previous_mode = RuntimeMode::parse(&previous.runtime_mode).unwrap_or_default();
            let _ = runtime.set_runtime_mode(previous_mode);
            let _ = store.set_runtime_mode(previous_mode);
            return Err(error);
        }
    };
    super::runtime::schedule_runtime_restart(&app, request);
    Ok(settings)
}

#[tauri::command]
pub fn get_request_header_settings(
    store: State<'_, RequestHeaderSettingsStore>,
) -> RequestHeaderSettings {
    store.state()
}

#[tauri::command]
pub async fn update_request_header_settings(
    app: AppHandle,
    settings: RequestHeaderSettings,
) -> Result<RequestHeaderSettings, AppError> {
    super::runtime::run_runtime(app, move |app, runtime| {
        let store = app.state::<RequestHeaderSettingsStore>();
        let previous = store.state();
        runtime.configure_request_headers(settings.clone())?;
        match store.update(settings) {
            Ok(settings) => Ok(settings),
            Err(error) => {
                let _ = runtime.configure_request_headers(previous);
                Err(error)
            }
        }
    })
    .await
}
