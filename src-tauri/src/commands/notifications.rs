use std::process::Command;

use crate::error::AppError;

#[tauri::command]
pub fn open_system_notification_settings() -> Result<(), AppError> {
    #[cfg(windows)]
    {
        notification_settings_command()
            .spawn()
            .map(|_| ())
            .map_err(|_| {
                AppError::new(
                    "NOTIFICATION_SETTINGS_OPEN_FAILED",
                    "无法打开系统通知设置，请在系统设置中手动打开通知页面",
                )
            })
    }

    #[cfg(target_os = "macos")]
    {
        Err(AppError::new(
            "NOTIFICATION_SETTINGS_UNSUPPORTED",
            "当前系统暂不支持从应用直接打开通知设置",
        ))
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Err(AppError::new(
            "NOTIFICATION_SETTINGS_UNSUPPORTED",
            "当前系统不支持从应用直接打开通知设置",
        ))
    }
}

#[cfg(windows)]
fn notification_settings_command() -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = Command::new("explorer.exe");
    command
        .arg("ms-settings:notifications")
        .creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::*;

    #[cfg(windows)]
    #[test]
    fn builds_fixed_windows_notification_settings_command() {
        let command = notification_settings_command();

        assert_eq!(command.get_program(), "explorer.exe");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![std::ffi::OsStr::new("ms-settings:notifications")]
        );
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    #[test]
    fn rejects_notification_settings_on_unsupported_platforms() {
        let error = open_system_notification_settings().expect_err("Linux 应返回稳定错误");

        assert_eq!(error.code, "NOTIFICATION_SETTINGS_UNSUPPORTED");
    }
}
