use crate::{
    bridge::providers::{validated_web_url, LoginStatus, ProviderLogin, ProviderRequest},
    error::AppError,
};
use std::process::Command;
use tauri::AppHandle;

#[tauri::command]
pub async fn agent_provider_settings(
    app: AppHandle,
    request: ProviderRequest,
) -> Result<serde_json::Value, AppError> {
    request.validate()?;
    super::runtime::run_runtime(app, move |_, runtime| runtime.provider_settings(request)).await
}

/// Only opens the current SDK-generated authorization URL, never a renderer-supplied URL.
#[tauri::command]
pub async fn agent_open_provider_login(app: AppHandle, login_id: String) -> Result<(), AppError> {
    super::runtime::run_runtime(app, move |_, runtime| {
        let value = runtime.provider_settings(ProviderRequest::LoginStatus { login_id })?;
        let login: ProviderLogin = serde_json::from_value(value)
            .map_err(|_| AppError::new("PROVIDER_RESPONSE_INVALID", "登录状态无效"))?;
        if login.status != LoginStatus::Pending {
            return Err(AppError::new("LOGIN_NOT_PENDING", "当前登录已结束"));
        }
        let url = login
            .url
            .ok_or_else(|| AppError::new("LOGIN_URL_UNAVAILABLE", "官方授权链接尚未就绪"))?;
        let url = validated_web_url(&url, true)?;
        #[cfg(windows)]
        let mut command = {
            use std::os::windows::process::CommandExt;
            let mut command = Command::new("explorer.exe");
            command.creation_flags(0x0800_0000);
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = Command::new("open");
        #[cfg(all(not(windows), not(target_os = "macos")))]
        let mut command = Command::new("xdg-open");
        command.arg(url).spawn().map(|_| ()).map_err(|_| {
            AppError::new(
                "LOGIN_BROWSER_FAILED",
                "无法打开系统浏览器，请检查默认浏览器设置",
            )
        })
    })
    .await
}
