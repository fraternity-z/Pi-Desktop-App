use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    AppHandle, Manager, RunEvent, Window, WindowEvent,
    menu::{Menu, MenuBuilder, MenuEvent},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_dialog::DialogExt;

use crate::{bridge::runtime::BridgeRuntime, error::AppError};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "pi-desktop-tray";
const SHOW_ID: &str = "pi-desktop-show";
const EXIT_ID: &str = "pi-desktop-exit";

#[derive(Default)]
pub(crate) struct ExitState {
    started: AtomicBool,
    ready: AtomicBool,
}

impl ExitState {
    fn begin(&self) -> bool {
        !self.started.swap(true, Ordering::AcqRel)
    }

    fn finish(&self, shutdown: impl FnOnce()) {
        shutdown();
        self.ready.store(true, Ordering::Release);
    }

    fn should_prevent_exit(&self) -> bool {
        !self.ready.load(Ordering::Acquire)
    }
}

fn menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, AppError> {
    MenuBuilder::new(app)
        .text(SHOW_ID, "显示主界面")
        .separator()
        .text(EXIT_ID, "退出应用")
        .build()
        .map_err(|_| AppError::new("TRAY_MENU_FAILED", "无法创建应用菜单"))
}

pub(crate) fn initialize(app: &AppHandle) -> Result<(), AppError> {
    if let Err(error) = ensure_tray(app) {
        app.set_menu(menu(app)?).map_err(|_| {
            AppError::new("APP_MENU_FAILED", "托盘和备用菜单均不可用，无法启动应用")
        })?;
        report_error(app, error);
    }
    Ok(())
}

fn ensure_tray(app: &AppHandle) -> Result<(), AppError> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        AppError::new(
            "TRAY_ICON_MISSING",
            "应用图标不可用，主界面将保持打开；可从应用菜单退出应用",
        )
    })?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Pi Desktop")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|_| {
            AppError::new(
                "TRAY_INITIALIZATION_FAILED",
                "无法创建系统托盘，主界面将保持打开；可从应用菜单退出应用",
            )
        })?;
    Ok(())
}

pub(crate) fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_ID => show_main_window(app),
        EXIT_ID => request_exit(app.clone()),
        _ => {}
    }
}

fn restore_window(
    show: impl FnOnce() -> Result<(), AppError>,
    unminimize: impl FnOnce() -> Result<(), AppError>,
    focus: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let shown = show();
    let restored = unminimize();
    let focused = focus();
    shown.and(restored).and(focused)
}

fn show_main_window(app: &AppHandle) {
    let result = app
        .get_window(MAIN_WINDOW)
        .ok_or_else(|| {
            AppError::new(
                "MAIN_WINDOW_MISSING",
                "主界面不可用，请从托盘退出应用后重新启动",
            )
        })
        .and_then(|window| {
            restore_window(
                || {
                    window.show().map_err(|_| {
                        AppError::new("WINDOW_SHOW_FAILED", "无法显示主界面，请重试托盘菜单")
                    })
                },
                || {
                    window.unminimize().map_err(|_| {
                        AppError::new("WINDOW_RESTORE_FAILED", "无法还原主界面，请重试托盘菜单")
                    })
                },
                || {
                    window.set_focus().map_err(|_| {
                        AppError::new(
                            "WINDOW_FOCUS_FAILED",
                            "无法激活主界面，请从任务栏切换到应用",
                        )
                    })
                },
            )
        });
    if let Err(error) = result {
        report_error(app, error);
    }
}

fn hide_to_tray(
    ensure_tray: impl FnOnce() -> Result<(), AppError>,
    hide: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    ensure_tray()?;
    hide()
}

pub(crate) fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let app = window.app_handle();
        if let Err(error) = hide_to_tray(
            || ensure_tray(app),
            || {
                window.hide().map_err(|_| {
                    AppError::new(
                        "WINDOW_HIDE_FAILED",
                        "无法隐藏主界面，会话将继续运行，请重试关闭按钮",
                    )
                })
            },
        ) {
            report_error(app, error);
        }
    }
}

pub(crate) fn request_exit(app: AppHandle) {
    if !app.state::<ExitState>().begin() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ExitState>().finish(|| shutdown_runtime(&app));
        app.exit(0);
    });
}

fn shutdown_runtime(app: &AppHandle) {
    if let Some(runtime) = app.try_state::<BridgeRuntime>() {
        runtime.shutdown();
    }
}

pub(crate) fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } => {
            if app.state::<ExitState>().should_prevent_exit() {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => shutdown_runtime(app),
        _ => {}
    }
}

fn report_error(app: &AppHandle, error: AppError) {
    eprintln!(
        "{}",
        serde_json::json!({"component": "lifecycle", "code": error.code})
    );
    app.dialog()
        .message(error.to_string())
        .title("Pi Desktop")
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn prevents_exit_until_explicit_shutdown_finishes() {
        let state = ExitState::default();
        assert!(state.should_prevent_exit());
        assert!(state.begin());
        assert!(state.should_prevent_exit());
        assert!(!state.begin());
        let shutdowns = Cell::new(0);
        state.finish(|| {
            assert!(state.should_prevent_exit());
            shutdowns.set(shutdowns.get() + 1);
        });
        assert!(!state.should_prevent_exit());
        assert!(!state.begin());
        assert_eq!(shutdowns.get(), 1);
    }

    #[test]
    fn concurrent_exit_requests_start_only_one_shutdown() {
        let state = ExitState::default();
        std::thread::scope(|scope| {
            let requests: Vec<_> = (0..8).map(|_| scope.spawn(|| state.begin())).collect();
            let accepted = requests
                .into_iter()
                .map(|request| usize::from(request.join().unwrap()))
                .sum::<usize>();
            assert_eq!(accepted, 1);
        });
    }

    #[test]
    fn closes_to_tray_without_requesting_exit() {
        let state = ExitState::default();
        let calls = RefCell::new(Vec::new());
        hide_to_tray(
            || {
                calls.borrow_mut().push("tray");
                Ok(())
            },
            || {
                calls.borrow_mut().push("hide");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), ["tray", "hide"]);
        assert!(state.should_prevent_exit());
        assert!(!state.started.load(Ordering::Acquire));
    }

    #[test]
    fn tray_failure_keeps_window_visible_and_allows_retry() {
        let hidden = Cell::new(false);
        let error = hide_to_tray(
            || Err(AppError::new("TRAY_INITIALIZATION_FAILED", "fixture")),
            || {
                hidden.set(true);
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "TRAY_INITIALIZATION_FAILED");
        assert!(!hidden.get());
        hide_to_tray(
            || Ok(()),
            || {
                hidden.set(true);
                Ok(())
            },
        )
        .unwrap();
        assert!(hidden.get());
    }

    #[test]
    fn hide_failure_is_reported() {
        let error = hide_to_tray(
            || Ok(()),
            || Err(AppError::new("WINDOW_HIDE_FAILED", "fixture")),
        )
        .unwrap_err();
        assert_eq!(error.code, "WINDOW_HIDE_FAILED");
    }

    #[test]
    fn restores_and_focuses_window_in_order() {
        let calls = RefCell::new(Vec::new());
        restore_window(
            || {
                calls.borrow_mut().push("show");
                Ok(())
            },
            || {
                calls.borrow_mut().push("restore");
                Ok(())
            },
            || {
                calls.borrow_mut().push("focus");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*calls.borrow(), ["show", "restore", "focus"]);
    }

    #[test]
    fn restore_attempts_remaining_operations_after_failure() {
        for failed_operation in ["show", "restore", "focus"] {
            let calls = RefCell::new(Vec::new());
            let operation = |name| {
                calls.borrow_mut().push(name);
                if name == failed_operation {
                    Err(AppError::new("WINDOW_OPERATION_FAILED", name))
                } else {
                    Ok(())
                }
            };
            let error = restore_window(
                || operation("show"),
                || operation("restore"),
                || operation("focus"),
            )
            .unwrap_err();
            assert_eq!(error.message, failed_operation);
            assert_eq!(*calls.borrow(), ["show", "restore", "focus"]);
        }
    }
}
