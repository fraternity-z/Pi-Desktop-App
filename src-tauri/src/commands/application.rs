#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    crate::lifecycle::request_exit(app);
}
