pub mod bridge;
mod commands;
pub mod discovery;
pub mod error;
pub mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::diagnostics::get_architecture_status
        ])
        .run(tauri::generate_context!())
        .expect("启动 Pi Desktop 的 Tauri Runtime 失败");
}
