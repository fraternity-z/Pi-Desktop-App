use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const APPEARANCE_THEME_SCHEMA_VERSION: u16 = 1;
const MAX_BACKGROUND_BYTES: u64 = 24 * 1024 * 1024;
const MAX_THEME_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceThemeInput {
    pub name: String,
    pub theme: String,
    pub background_preset: String,
    pub ui_scale: u16,
    pub ui_font: String,
    pub ui_font_size: u16,
    pub code_font: String,
    pub code_font_size: u16,
    pub sidebar_translucent: bool,
    pub sidebar_width: u16,
    pub custom_background_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppearanceBackground {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAppearanceTheme {
    pub name: String,
    pub theme: String,
    pub background_preset: String,
    pub ui_scale: u16,
    pub ui_font: String,
    pub ui_font_size: u16,
    pub code_font: String,
    pub code_font_size: u16,
    pub sidebar_translucent: bool,
    pub sidebar_width: u16,
    pub custom_background_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppearanceThemeFile {
    schema_version: u16,
    name: String,
    theme: String,
    background_preset: String,
    ui_scale: u16,
    ui_font: String,
    ui_font_size: u16,
    code_font: String,
    code_font_size: u16,
    sidebar_translucent: bool,
    sidebar_width: u16,
    background_file: Option<String>,
}

#[tauri::command]
pub fn install_appearance_background(
    app: AppHandle,
    source_path: String,
) -> Result<InstalledAppearanceBackground, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "APPEARANCE_BACKGROUND_DIRECTORY_UNAVAILABLE",
            "无法解析应用背景图片目录",
        )
    })?;
    install_background_image(Path::new(source_path.trim()), &app_data_dir)
}

#[tauri::command]
pub fn import_appearance_theme(
    app: AppHandle,
    source_path: String,
) -> Result<ImportedAppearanceTheme, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "APPEARANCE_THEME_DIRECTORY_UNAVAILABLE",
            "无法解析应用主题目录",
        )
    })?;
    import_theme_file(Path::new(source_path.trim()), &app_data_dir)
}

#[tauri::command]
pub fn export_appearance_theme(
    app: AppHandle,
    target_path: String,
    theme: AppearanceThemeInput,
) -> Result<(), AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "APPEARANCE_THEME_DIRECTORY_UNAVAILABLE",
            "无法解析应用主题目录",
        )
    })?;
    export_theme_file(Path::new(target_path.trim()), &app_data_dir, theme)
}

fn install_background_image(
    source_path: &Path,
    app_data_dir: &Path,
) -> Result<InstalledAppearanceBackground, AppError> {
    let (source, extension) = validate_background_image(source_path)?;
    let appearance_dir = app_data_dir.join("appearance").join("backgrounds");
    fs::create_dir_all(&appearance_dir).map_err(|_| {
        AppError::new(
            "APPEARANCE_BACKGROUND_WRITE_FAILED",
            "无法创建应用背景图片目录",
        )
    })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let target = appearance_dir.join(format!(
        "background-{}-{nonce}.{extension}",
        std::process::id()
    ));
    fs::copy(&source, &target)
        .map_err(|_| AppError::new("APPEARANCE_BACKGROUND_WRITE_FAILED", "无法保存所选背景图片"))?;
    let installed = target.canonicalize().map_err(|_| {
        AppError::new(
            "APPEARANCE_BACKGROUND_WRITE_FAILED",
            "无法确认已保存的背景图片",
        )
    })?;
    Ok(InstalledAppearanceBackground {
        path: path_text(&installed),
    })
}

fn export_theme_file(
    target_path: &Path,
    app_data_dir: &Path,
    mut theme: AppearanceThemeInput,
) -> Result<(), AppError> {
    validate_export_path(target_path)?;
    normalize_and_validate_theme(&mut theme)?;
    let parent = target_path
        .parent()
        .ok_or_else(|| AppError::new("APPEARANCE_THEME_EXPORT_PATH_INVALID", "主题导出路径无效"))?;

    let background_file = if theme.background_preset == "custom" {
        let source_path = theme.custom_background_path.as_deref().ok_or_else(|| {
            AppError::new("APPEARANCE_THEME_EXPORT_INVALID", "自定义主题缺少背景图片")
        })?;
        let (source, extension) = validate_background_image(Path::new(source_path))?;
        let allowed_root = app_data_dir.join("appearance");
        let allowed_root = allowed_root.canonicalize().map_err(|_| {
            AppError::new(
                "APPEARANCE_THEME_EXPORT_INVALID",
                "自定义背景图片不在应用数据目录中",
            )
        })?;
        if !source.starts_with(&allowed_root) {
            return Err(AppError::new(
                "APPEARANCE_THEME_EXPORT_INVALID",
                "自定义背景图片不在应用数据目录中",
            ));
        }
        let stem = safe_file_stem(target_path);
        let file_name = format!("{stem}.background.{extension}");
        fs::copy(source, parent.join(&file_name))
            .map_err(|_| AppError::new("APPEARANCE_THEME_EXPORT_FAILED", "无法导出主题背景图片"))?;
        Some(file_name)
    } else {
        None
    };

    let payload = AppearanceThemeFile {
        schema_version: APPEARANCE_THEME_SCHEMA_VERSION,
        name: theme.name,
        theme: theme.theme,
        background_preset: theme.background_preset,
        ui_scale: theme.ui_scale,
        ui_font: theme.ui_font,
        ui_font_size: theme.ui_font_size,
        code_font: theme.code_font,
        code_font_size: theme.code_font_size,
        sidebar_translucent: theme.sidebar_translucent,
        sidebar_width: theme.sidebar_width,
        background_file,
    };
    let bytes = serde_json::to_vec_pretty(&payload)
        .map_err(|_| AppError::new("APPEARANCE_THEME_EXPORT_FAILED", "无法序列化外观主题"))?;
    fs::write(target_path, bytes)
        .map_err(|_| AppError::new("APPEARANCE_THEME_EXPORT_FAILED", "无法写入外观主题文件"))
}

fn import_theme_file(
    source_path: &Path,
    app_data_dir: &Path,
) -> Result<ImportedAppearanceTheme, AppError> {
    if !source_path.is_absolute() || !has_extension(source_path, "json") || !source_path.is_file() {
        return Err(AppError::new(
            "APPEARANCE_THEME_IMPORT_PATH_INVALID",
            "主题文件必须是存在的绝对 JSON 文件路径",
        ));
    }
    let source = source_path.canonicalize().map_err(|_| {
        AppError::new(
            "APPEARANCE_THEME_IMPORT_PATH_INVALID",
            "主题文件不存在或无法访问",
        )
    })?;
    let metadata = fs::metadata(&source)
        .map_err(|_| AppError::new("APPEARANCE_THEME_IMPORT_READ_FAILED", "无法读取主题文件"))?;
    if metadata.len() == 0 || metadata.len() > MAX_THEME_BYTES {
        return Err(AppError::new(
            "APPEARANCE_THEME_IMPORT_INVALID",
            "主题文件为空或超过 128 KiB 限制",
        ));
    }
    let bytes = fs::read(&source)
        .map_err(|_| AppError::new("APPEARANCE_THEME_IMPORT_READ_FAILED", "无法读取主题文件"))?;
    let file: AppearanceThemeFile = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("APPEARANCE_THEME_IMPORT_INVALID", "主题文件格式无效"))?;
    if file.schema_version != APPEARANCE_THEME_SCHEMA_VERSION {
        return Err(AppError::new(
            "APPEARANCE_THEME_IMPORT_VERSION_UNSUPPORTED",
            "主题文件版本不受支持",
        ));
    }

    let mut input = AppearanceThemeInput {
        name: file.name,
        theme: file.theme,
        background_preset: file.background_preset,
        ui_scale: file.ui_scale,
        ui_font: file.ui_font,
        ui_font_size: file.ui_font_size,
        code_font: file.code_font,
        code_font_size: file.code_font_size,
        sidebar_translucent: file.sidebar_translucent,
        sidebar_width: file.sidebar_width,
        custom_background_path: None,
    };
    normalize_and_validate_theme(&mut input)?;

    let custom_background_path = if input.background_preset == "custom" {
        let background_file = file.background_file.as_deref().ok_or_else(|| {
            AppError::new(
                "APPEARANCE_THEME_IMPORT_INVALID",
                "自定义主题缺少背景图片文件",
            )
        })?;
        let relative = Path::new(background_file);
        if relative.components().count() != 1
            || !matches!(relative.components().next(), Some(Component::Normal(_)))
        {
            return Err(AppError::new(
                "APPEARANCE_THEME_IMPORT_INVALID",
                "主题背景图片路径无效",
            ));
        }
        let background = source
            .parent()
            .ok_or_else(|| AppError::new("APPEARANCE_THEME_IMPORT_INVALID", "主题文件目录无效"))?;
        let installed = install_background_image(&background.join(relative), app_data_dir)?;
        Some(installed.path)
    } else {
        None
    };

    Ok(ImportedAppearanceTheme {
        name: input.name,
        theme: input.theme,
        background_preset: input.background_preset,
        ui_scale: input.ui_scale,
        ui_font: input.ui_font,
        ui_font_size: input.ui_font_size,
        code_font: input.code_font,
        code_font_size: input.code_font_size,
        sidebar_translucent: input.sidebar_translucent,
        sidebar_width: input.sidebar_width,
        custom_background_path,
    })
}

fn validate_background_image(path: &Path) -> Result<(PathBuf, &'static str), AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "APPEARANCE_BACKGROUND_PATH_INVALID",
            "背景图片必须是存在的绝对文件路径",
        ));
    }
    let source = path.canonicalize().map_err(|_| {
        AppError::new(
            "APPEARANCE_BACKGROUND_PATH_INVALID",
            "背景图片不存在或无法访问",
        )
    })?;
    if !source.is_file() {
        return Err(AppError::new(
            "APPEARANCE_BACKGROUND_PATH_INVALID",
            "背景图片路径必须指向文件",
        ));
    }
    let metadata = fs::metadata(&source)
        .map_err(|_| AppError::new("APPEARANCE_BACKGROUND_READ_FAILED", "无法读取背景图片信息"))?;
    if metadata.len() == 0 || metadata.len() > MAX_BACKGROUND_BYTES {
        return Err(AppError::new(
            "APPEARANCE_BACKGROUND_TOO_LARGE",
            "背景图片为空或超过 24 MiB 限制",
        ));
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            AppError::new(
                "APPEARANCE_BACKGROUND_TYPE_UNSUPPORTED",
                "背景图片仅支持 PNG、JPEG 和 WebP",
            )
        })?;
    let extension = match extension.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        _ => {
            return Err(AppError::new(
                "APPEARANCE_BACKGROUND_TYPE_UNSUPPORTED",
                "背景图片仅支持 PNG、JPEG 和 WebP",
            ));
        }
    };

    let mut header = [0_u8; 12];
    let read = File::open(&source)
        .and_then(|mut file| file.read(&mut header))
        .map_err(|_| AppError::new("APPEARANCE_BACKGROUND_READ_FAILED", "无法读取背景图片"))?;
    let valid = match extension {
        "png" => read >= 8 && header[..8] == [137, 80, 78, 71, 13, 10, 26, 10],
        "jpg" => read >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "webp" => read >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Err(AppError::new(
            "APPEARANCE_BACKGROUND_TYPE_UNSUPPORTED",
            "背景图片内容与文件类型不匹配",
        ));
    }
    Ok((source, extension))
}

fn validate_export_path(path: &Path) -> Result<(), AppError> {
    if !path.is_absolute() || !has_extension(path, "json") {
        return Err(AppError::new(
            "APPEARANCE_THEME_EXPORT_PATH_INVALID",
            "主题导出路径必须是绝对 JSON 文件路径",
        ));
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(AppError::new(
            "APPEARANCE_THEME_EXPORT_PATH_INVALID",
            "主题导出目录不存在",
        ));
    }
    Ok(())
}

fn normalize_and_validate_theme(theme: &mut AppearanceThemeInput) -> Result<(), AppError> {
    theme.name = theme.name.trim().to_owned();
    if theme.name.is_empty() || theme.name.chars().count() > 40 {
        return Err(AppError::new(
            "APPEARANCE_THEME_INVALID",
            "主题名称必须包含 1 到 40 个字符",
        ));
    }
    if !matches!(theme.theme.as_str(), "system" | "light" | "dark")
        || !matches!(
            theme.background_preset.as_str(),
            "default" | "cyan-stage" | "rose-cinema" | "custom"
        )
        || !matches!(theme.ui_scale, 80 | 90 | 100 | 110 | 125)
        || !matches!(
            theme.ui_font.as_str(),
            "system" | "microsoft-yahei" | "noto-sans"
        )
        || !matches!(theme.ui_font_size, 12 | 13 | 14 | 15 | 16)
        || !matches!(
            theme.code_font.as_str(),
            "system" | "cascadia-code" | "consolas"
        )
        || !matches!(theme.code_font_size, 11 | 12 | 13 | 14 | 15)
        || !(232..=360).contains(&theme.sidebar_width)
    {
        return Err(AppError::new(
            "APPEARANCE_THEME_INVALID",
            "主题包含不受支持的外观设置",
        ));
    }
    Ok(())
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn safe_file_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("theme");
    let value: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let value = value.trim_matches('-');
    if value.is_empty() {
        "theme".to_owned()
    } else {
        value.chars().take(48).collect()
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "pi-desktop-appearance-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        bytes.extend_from_slice(b"test-image");
        bytes
    }

    fn custom_theme(path: String) -> AppearanceThemeInput {
        AppearanceThemeInput {
            name: "我的主题".to_owned(),
            theme: "system".to_owned(),
            background_preset: "custom".to_owned(),
            ui_scale: 100,
            ui_font: "system".to_owned(),
            ui_font_size: 14,
            code_font: "system".to_owned(),
            code_font_size: 12,
            sidebar_translucent: true,
            sidebar_width: 300,
            custom_background_path: Some(path),
        }
    }

    #[test]
    fn installs_valid_background_inside_app_data() {
        let root = TestDirectory::new("install");
        let source = root.0.join("source.png");
        fs::write(&source, png_bytes()).unwrap();

        let installed = install_background_image(&source, &root.0).unwrap();

        let installed_path = PathBuf::from(installed.path);
        assert!(installed_path.is_file());
        assert!(installed_path.starts_with(root.0.join("appearance").canonicalize().unwrap()));
        assert_eq!(fs::read(installed_path).unwrap(), png_bytes());
    }

    #[test]
    fn rejects_relative_oversized_and_spoofed_backgrounds() {
        let root = TestDirectory::new("invalid");
        let spoofed = root.0.join("spoofed.png");
        fs::write(&spoofed, b"not-png").unwrap();
        let oversized = root.0.join("large.jpg");
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_BACKGROUND_BYTES + 1)
            .unwrap();

        assert_eq!(
            install_background_image(Path::new("relative.png"), &root.0)
                .unwrap_err()
                .code,
            "APPEARANCE_BACKGROUND_PATH_INVALID"
        );
        assert_eq!(
            install_background_image(&spoofed, &root.0)
                .unwrap_err()
                .code,
            "APPEARANCE_BACKGROUND_TYPE_UNSUPPORTED"
        );
        assert_eq!(
            install_background_image(&oversized, &root.0)
                .unwrap_err()
                .code,
            "APPEARANCE_BACKGROUND_TOO_LARGE"
        );
    }

    #[test]
    fn exports_and_imports_portable_custom_theme() {
        let root = TestDirectory::new("roundtrip");
        let original = root.0.join("original.png");
        fs::write(&original, png_bytes()).unwrap();
        let installed = install_background_image(&original, &root.0).unwrap();
        let export_dir = root.0.join("exports");
        fs::create_dir_all(&export_dir).unwrap();
        let target = export_dir.join("my-theme.pi-theme.json");

        export_theme_file(&target, &root.0, custom_theme(installed.path)).unwrap();
        let imported = import_theme_file(&target, &root.0).unwrap();

        assert_eq!(imported.name, "我的主题");
        assert_eq!(imported.background_preset, "custom");
        assert!(
            imported
                .custom_background_path
                .is_some_and(|path| Path::new(&path).is_file())
        );
        let manifest: AppearanceThemeFile =
            serde_json::from_slice(&fs::read(target).unwrap()).unwrap();
        assert!(manifest.background_file.is_some());
    }

    #[test]
    fn rejects_invalid_theme_values_and_background_traversal() {
        let root = TestDirectory::new("theme-invalid");
        let theme_path = root.0.join("invalid.json");
        let file = AppearanceThemeFile {
            schema_version: APPEARANCE_THEME_SCHEMA_VERSION,
            name: "Bad".to_owned(),
            theme: "system".to_owned(),
            background_preset: "custom".to_owned(),
            ui_scale: 100,
            ui_font: "system".to_owned(),
            ui_font_size: 14,
            code_font: "system".to_owned(),
            code_font_size: 12,
            sidebar_translucent: false,
            sidebar_width: 300,
            background_file: Some("../outside.png".to_owned()),
        };
        fs::write(&theme_path, serde_json::to_vec(&file).unwrap()).unwrap();

        assert_eq!(
            import_theme_file(&theme_path, &root.0).unwrap_err().code,
            "APPEARANCE_THEME_IMPORT_INVALID"
        );

        let mut invalid = custom_theme("missing.png".to_owned());
        invalid.ui_scale = 101;
        assert_eq!(
            normalize_and_validate_theme(&mut invalid).unwrap_err().code,
            "APPEARANCE_THEME_INVALID"
        );
    }
}
