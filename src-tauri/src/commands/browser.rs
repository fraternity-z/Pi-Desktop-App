use std::{
    fs,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl, Window,
    webview::{DownloadEvent, NewWindowResponse, WebviewBuilder},
};

use crate::error::AppError;

const BROWSER_SIDEBAR_LABEL: &str = "pi-browser-sidebar";
const DEFAULT_BROWSER_URL: &str = "https://www.google.com";
const MAIN_WINDOW_LABEL: &str = "main";
const MIN_BROWSER_SIDEBAR_SIZE: f64 = 24.0;

static BROWSER_SIDEBAR_OPEN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSidebarBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSidebarOpenInput {
    pub url: Option<String>,
    #[serde(flatten)]
    pub bounds: BrowserSidebarBounds,
}

#[tauri::command]
pub async fn browser_sidebar_open(
    app: AppHandle,
    input: BrowserSidebarOpenInput,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || open_browser_sidebar(app, input))
        .await
        .map_err(|_| {
            AppError::new(
                "BROWSER_SIDEBAR_TASK_FAILED",
                "打开浏览器侧栏时任务异常终止",
            )
        })?
}

fn open_browser_sidebar(app: AppHandle, input: BrowserSidebarOpenInput) -> Result<(), AppError> {
    let url = normalize_browser_url(input.url.as_deref())?;
    let bounds = sanitize_browser_sidebar_bounds(input.bounds)?;
    let _guard = browser_sidebar_open_lock()
        .lock()
        .map_err(|_| AppError::new("BROWSER_SIDEBAR_LOCK_FAILED", "浏览器侧栏状态锁不可用"))?;
    let main_window = app.get_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        AppError::new(
            "BROWSER_MAIN_WINDOW_MISSING",
            "主窗口不可用，无法打开浏览器侧栏",
        )
    })?;
    let bounds = constrain_browser_sidebar_bounds(&main_window, bounds)?;
    let data_directory = browser_data_directory(&app)?;
    fs::create_dir_all(&data_directory)
        .map_err(|_| AppError::new("BROWSER_DATA_DIRECTORY_FAILED", "无法创建浏览器数据目录"))?;

    if let Some(webview) = app.get_webview(BROWSER_SIDEBAR_LABEL) {
        apply_browser_sidebar_bounds(&webview, bounds)?;
        webview.navigate(url).map_err(|_| browser_webview_error())?;
        return Ok(());
    }

    let app_for_new_windows = app.clone();
    let builder = WebviewBuilder::new(BROWSER_SIDEBAR_LABEL, WebviewUrl::External(url))
        .data_directory(data_directory)
        .on_navigation(is_allowed_browser_url)
        .on_new_window(move |url, _features| {
            if is_allowed_browser_url(&url) {
                if let Some(webview) = app_for_new_windows.get_webview(BROWSER_SIDEBAR_LABEL) {
                    let _ = webview.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .on_download(|_, event| !matches!(event, DownloadEvent::Requested { .. }));
    let webview = main_window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|_| browser_webview_error())?;
    if bounds.visible {
        webview.show().map_err(|_| browser_webview_error())?;
    } else {
        webview.hide().map_err(|_| browser_webview_error())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_sidebar_update_bounds(
    app: AppHandle,
    input: BrowserSidebarBounds,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || update_browser_sidebar_bounds(app, input))
        .await
        .map_err(|_| {
            AppError::new(
                "BROWSER_SIDEBAR_TASK_FAILED",
                "调整浏览器侧栏时任务异常终止",
            )
        })?
}

fn update_browser_sidebar_bounds(
    app: AppHandle,
    input: BrowserSidebarBounds,
) -> Result<(), AppError> {
    let _guard = browser_sidebar_open_lock()
        .lock()
        .map_err(|_| AppError::new("BROWSER_SIDEBAR_LOCK_FAILED", "浏览器侧栏状态锁不可用"))?;
    let Some(webview) = app.get_webview(BROWSER_SIDEBAR_LABEL) else {
        return Ok(());
    };
    let main_window = app.get_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        AppError::new(
            "BROWSER_MAIN_WINDOW_MISSING",
            "主窗口不可用，无法调整浏览器侧栏",
        )
    })?;
    let bounds = sanitize_browser_sidebar_bounds(input)?;
    apply_browser_sidebar_bounds(
        &webview,
        constrain_browser_sidebar_bounds(&main_window, bounds)?,
    )
}

#[tauri::command]
pub async fn browser_sidebar_hide(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || hide_browser_sidebar(app))
        .await
        .map_err(|_| {
            AppError::new(
                "BROWSER_SIDEBAR_TASK_FAILED",
                "隐藏浏览器侧栏时任务异常终止",
            )
        })?
}

fn hide_browser_sidebar(app: AppHandle) -> Result<(), AppError> {
    let _guard = browser_sidebar_open_lock()
        .lock()
        .map_err(|_| AppError::new("BROWSER_SIDEBAR_LOCK_FAILED", "浏览器侧栏状态锁不可用"))?;
    if let Some(webview) = app.get_webview(BROWSER_SIDEBAR_LABEL) {
        webview.hide().map_err(|_| browser_webview_error())?;
    }
    Ok(())
}

fn browser_sidebar_open_lock() -> &'static Mutex<()> {
    BROWSER_SIDEBAR_OPEN_LOCK.get_or_init(|| Mutex::new(()))
}

fn browser_data_directory(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::new("BROWSER_DATA_DIRECTORY_FAILED", "无法解析浏览器数据目录"))?;
    Ok(app_data.join("browser").join("data"))
}

fn normalize_browser_url(value: Option<&str>) -> Result<Url, AppError> {
    let trimmed = value.unwrap_or_default().trim();
    let raw = if trimmed.is_empty() {
        DEFAULT_BROWSER_URL.to_owned()
    } else if trimmed.eq_ignore_ascii_case("about:blank") {
        "about:blank".to_owned()
    } else if has_url_scheme(trimmed) {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let url =
        Url::parse(&raw).map_err(|_| AppError::new("BROWSER_URL_INVALID", "浏览器地址无效"))?;
    if !is_allowed_browser_url(&url) {
        return Err(AppError::new(
            "BROWSER_URL_UNSUPPORTED",
            "内置浏览器仅支持 http、https 和 about:blank",
        ));
    }
    Ok(url)
}

fn is_allowed_browser_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        || (url.scheme() == "about" && url.as_str() == "about:blank")
}

fn has_url_scheme(value: &str) -> bool {
    let Some(index) = value.find("://") else {
        return false;
    };
    let scheme = &value[..index];
    !scheme.is_empty()
        && scheme.chars().enumerate().all(|(index, character)| {
            if index == 0 {
                character.is_ascii_alphabetic()
            } else {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
            }
        })
}

fn sanitize_browser_sidebar_bounds(
    bounds: BrowserSidebarBounds,
) -> Result<BrowserSidebarBounds, AppError> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
    {
        return Err(AppError::new(
            "BROWSER_SIDEBAR_BOUNDS_INVALID",
            "浏览器侧栏位置参数无效",
        ));
    }
    Ok(BrowserSidebarBounds {
        x: bounds.x.max(0.0),
        y: bounds.y.max(0.0),
        width: bounds.width.max(MIN_BROWSER_SIDEBAR_SIZE),
        height: bounds.height.max(MIN_BROWSER_SIDEBAR_SIZE),
        visible: bounds.visible,
    })
}

fn constrain_browser_sidebar_bounds<R: Runtime>(
    window: &Window<R>,
    bounds: BrowserSidebarBounds,
) -> Result<BrowserSidebarBounds, AppError> {
    let scale_factor = window
        .scale_factor()
        .map_err(|_| AppError::new("BROWSER_WINDOW_BOUNDS_FAILED", "无法读取主窗口缩放比例"))?;
    let logical_size = window
        .inner_size()
        .map_err(|_| AppError::new("BROWSER_WINDOW_BOUNDS_FAILED", "无法读取主窗口尺寸"))?
        .to_logical::<f64>(scale_factor);
    Ok(constrain_browser_sidebar_bounds_to_size(
        bounds,
        logical_size.width,
        logical_size.height,
    ))
}

fn constrain_browser_sidebar_bounds_to_size(
    bounds: BrowserSidebarBounds,
    window_width: f64,
    window_height: f64,
) -> BrowserSidebarBounds {
    let available_width = window_width.max(MIN_BROWSER_SIDEBAR_SIZE);
    let available_height = window_height.max(MIN_BROWSER_SIDEBAR_SIZE);
    let x = bounds
        .x
        .min((available_width - MIN_BROWSER_SIDEBAR_SIZE).max(0.0));
    let y = bounds
        .y
        .min((available_height - MIN_BROWSER_SIDEBAR_SIZE).max(0.0));
    BrowserSidebarBounds {
        x,
        y,
        width: bounds
            .width
            .min((available_width - x).max(MIN_BROWSER_SIDEBAR_SIZE)),
        height: bounds
            .height
            .min((available_height - y).max(MIN_BROWSER_SIDEBAR_SIZE)),
        visible: bounds.visible,
    }
}

fn apply_browser_sidebar_bounds<R: Runtime>(
    webview: &Webview<R>,
    bounds: BrowserSidebarBounds,
) -> Result<(), AppError> {
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|_| browser_webview_error())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|_| browser_webview_error())?;
    if bounds.visible {
        webview.show().map_err(|_| browser_webview_error())?;
    } else {
        webview.hide().map_err(|_| browser_webview_error())?;
    }
    Ok(())
}

fn browser_webview_error() -> AppError {
    AppError::new("BROWSER_SIDEBAR_FAILED", "无法更新浏览器侧栏")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_with_default_scheme_and_google_default() {
        assert_eq!(
            normalize_browser_url(Some("example.com/path"))
                .unwrap()
                .as_str(),
            "https://example.com/path"
        );
        assert_eq!(
            normalize_browser_url(None).unwrap().as_str(),
            "https://www.google.com/"
        );
        assert_eq!(
            normalize_browser_url(Some("about:blank")).unwrap().as_str(),
            "about:blank"
        );
    }

    #[test]
    fn rejects_invalid_and_unsupported_urls_without_echoing_input() {
        assert_eq!(
            normalize_browser_url(Some("file:///C:/secret.txt"))
                .unwrap_err()
                .code,
            "BROWSER_URL_UNSUPPORTED"
        );
        assert_eq!(
            normalize_browser_url(Some("https://[invalid"))
                .unwrap_err()
                .code,
            "BROWSER_URL_INVALID"
        );
    }

    #[test]
    fn clamps_valid_bounds_and_rejects_non_finite_values() {
        let bounds = sanitize_browser_sidebar_bounds(BrowserSidebarBounds {
            x: -1.0,
            y: -4.0,
            width: 12.0,
            height: 0.0,
            visible: true,
        })
        .unwrap();
        assert_eq!(
            (bounds.x, bounds.y, bounds.width, bounds.height),
            (0.0, 0.0, 24.0, 24.0)
        );
        assert_eq!(
            sanitize_browser_sidebar_bounds(BrowserSidebarBounds {
                x: f64::NAN,
                y: 0.0,
                width: 24.0,
                height: 24.0,
                visible: true,
            })
            .unwrap_err()
            .code,
            "BROWSER_SIDEBAR_BOUNDS_INVALID"
        );
    }

    #[test]
    fn constrains_bounds_to_the_main_window() {
        let bounds = constrain_browser_sidebar_bounds_to_size(
            BrowserSidebarBounds {
                x: 980.0,
                y: 980.0,
                width: 10_000.0,
                height: 10_000.0,
                visible: true,
            },
            1_000.0,
            800.0,
        );

        assert_eq!(
            (bounds.x, bounds.y, bounds.width, bounds.height),
            (976.0, 776.0, 24.0, 24.0)
        );
    }
}
