use tauri::{AppHandle, Manager, State};

use crate::{
    bridge::protocol::RequestHeaderSettings, error::AppError, storage::RequestHeaderSettingsStore,
};

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
