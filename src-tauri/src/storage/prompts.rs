use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const MAX_PROMPT_BYTES: usize = 256 * 1024;
static PROMPT_LOCK: Mutex<()> = Mutex::new(());
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptKind {
    System,
    Append,
}

impl PromptKind {
    fn filename(self) -> &'static str {
        match self {
            Self::System => "SYSTEM.md",
            Self::Append => "APPEND_SYSTEM.md",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDocument {
    pub content: Option<String>,
    pub path: String,
}

pub fn read_prompt(root: &Path, kind: PromptKind) -> Result<PromptDocument, AppError> {
    let path = root.join(kind.filename());
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PromptDocument {
                content: None,
                path: path.to_string_lossy().into_owned(),
            });
        }
        Err(_) => return Err(prompt_error("PROMPT_READ_FAILED", "无法读取提示词文件")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(prompt_error(
            "PROMPT_PATH_INVALID",
            "提示词路径必须是普通文件，不能是符号链接",
        ));
    }
    let mut content = String::new();
    fs::File::open(&path)
        .and_then(|file| {
            file.take((MAX_PROMPT_BYTES + 1) as u64)
                .read_to_string(&mut content)
        })
        .map_err(|_| prompt_error("PROMPT_READ_FAILED", "提示词文件无法读取或不是 UTF-8 文本"))?;
    validate_content(&content)?;
    Ok(PromptDocument {
        content: Some(content),
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn save_prompt(
    root: &Path,
    kind: PromptKind,
    content: Option<String>,
    expected_content: Option<String>,
) -> Result<PromptDocument, AppError> {
    if let Some(content) = &content {
        validate_content(content)?;
    }
    if let Some(content) = &expected_content {
        validate_content(content)?;
    }
    let _guard = PROMPT_LOCK
        .lock()
        .map_err(|_| prompt_error("PROMPT_STATE_UNAVAILABLE", "提示词保存锁不可用"))?;
    let current = read_prompt(root, kind)?;
    if current.content != expected_content {
        return Err(prompt_error(
            "PROMPT_CONFLICT",
            "提示词已被其他编辑器修改，请重新加载后再保存",
        ));
    }
    let target = root.join(kind.filename());
    match &content {
        None if current.content.is_some() => fs::remove_file(&target)
            .map_err(|_| prompt_error("PROMPT_WRITE_FAILED", "无法移除用户提示词文件"))?,
        None => {}
        Some(content) => {
            let temporary = root.join(format!(
                ".{}-{}-{}.tmp",
                kind.filename(),
                std::process::id(),
                TEMP_ID.fetch_add(1, Ordering::Relaxed)
            ));
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| prompt_error("PROMPT_WRITE_FAILED", "无法创建提示词临时文件"))?;
            let result = file
                .write_all(content.as_bytes())
                .and_then(|_| file.sync_all());
            drop(file);
            let result = result.and_then(|_| fs::rename(&temporary, &target));
            if result.is_err() {
                let _ = fs::remove_file(&temporary);
                return Err(prompt_error(
                    "PROMPT_WRITE_FAILED",
                    "无法保存提示词文件，原文件保留",
                ));
            }
        }
    }
    Ok(PromptDocument {
        content,
        path: current.path,
    })
}

fn validate_content(content: &str) -> Result<(), AppError> {
    if content.len() > MAX_PROMPT_BYTES || content.contains('\0') {
        return Err(prompt_error(
            "PROMPT_CONTENT_INVALID",
            "提示词最多 256 KiB，且不能包含空字符",
        ));
    }
    Ok(())
}

fn prompt_error(code: &'static str, message: &str) -> AppError {
    AppError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "pi-prompts-{}-{}",
                std::process::id(),
                TEMP_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_saves_replaces_and_removes_both_official_files() {
        let fixture = Fixture::new();
        for kind in [PromptKind::System, PromptKind::Append] {
            assert!(read_prompt(&fixture.0, kind).unwrap().content.is_none());
            let first = "使用中文\n".to_owned();
            save_prompt(&fixture.0, kind, Some(first.clone()), None).unwrap();
            assert_eq!(
                read_prompt(&fixture.0, kind).unwrap().content,
                Some(first.clone())
            );
            save_prompt(&fixture.0, kind, Some(String::new()), Some(first)).unwrap();
            assert_eq!(
                read_prompt(&fixture.0, kind).unwrap().content,
                Some(String::new())
            );
            save_prompt(&fixture.0, kind, None, Some(String::new())).unwrap();
            assert!(!fixture.0.join(kind.filename()).exists());
        }
    }

    #[test]
    fn refuses_conflicts_and_invalid_content_without_overwriting() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("SYSTEM.md"), "external edit").unwrap();
        assert!(save_prompt(&fixture.0, PromptKind::System, Some("new".into()), None).is_err());
        for text in ["x".repeat(MAX_PROMPT_BYTES + 1), "a\0b".into()] {
            assert!(
                save_prompt(
                    &fixture.0,
                    PromptKind::System,
                    Some(text),
                    Some("external edit".into())
                )
                .is_err()
            );
        }
        assert_eq!(
            read_prompt(&fixture.0, PromptKind::System)
                .unwrap()
                .content
                .as_deref(),
            Some("external edit")
        );
        assert!(validate_content(&"x".repeat(MAX_PROMPT_BYTES)).is_ok());
    }

    #[test]
    fn rejects_directories_oversized_and_non_utf8_files() {
        let fixture = Fixture::new();
        let path = fixture.0.join("SYSTEM.md");
        fs::create_dir(&path).unwrap();
        assert!(read_prompt(&fixture.0, PromptKind::System).is_err());
        fs::remove_dir(&path).unwrap();
        for bytes in [vec![255], vec![b'x'; MAX_PROMPT_BYTES + 1]] {
            fs::write(&path, bytes).unwrap();
            assert!(read_prompt(&fixture.0, PromptKind::System).is_err());
        }
        assert!(serde_json::from_str::<PromptKind>("\"../../auth.json\"").is_err());
    }
}
