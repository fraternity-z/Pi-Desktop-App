use std::{
    collections::{HashSet, VecDeque},
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    bridge::supervisor::normalize_process_path,
    error::AppError,
    image::{
        MAX_PROMPT_IMAGE_BYTES, PROMPT_IMAGE_CACHE_DIR, detect_image_format, image_format_for_mime,
    },
    storage::{WorkspaceState, WorkspaceStore},
};

#[tauri::command]
pub fn workspace_get_state(store: State<'_, WorkspaceStore>) -> WorkspaceState {
    store.state()
}

#[tauri::command]
pub fn workspace_remember(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<WorkspaceState, AppError> {
    store.remember(&cwd)
}

#[tauri::command]
pub fn workspace_remove_recent(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<WorkspaceState, AppError> {
    store.remove_recent(&cwd)
}

#[tauri::command]
pub fn workspace_ensure_conversation(store: State<'_, WorkspaceStore>) -> Result<String, AppError> {
    store.ensure_conversation()
}

const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_BRANCHES: usize = 512;
const MAX_WORKTREE_NAME_BYTES: usize = 80;
const MAX_PATH_SEARCH_RESULTS: usize = 48;
const MAX_PATH_SEARCH_ENTRIES: usize = 10_000;
const MAX_PATH_SEARCH_DEPTH: usize = 8;
const MAX_WORKSPACE_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub data_base64: String,
    pub size: u64,
}

#[tauri::command]
pub async fn workspace_save_clipboard_image(
    app: AppHandle,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|_| AppError::new("PROMPT_IMAGE_WRITE_FAILED", "无法解析图片缓存目录"))?
        .join(PROMPT_IMAGE_CACHE_DIR);
    tauri::async_runtime::spawn_blocking(move || save_clipboard_image(&root, &mime_type, &bytes))
        .await
        .map_err(|_| AppError::new("PROMPT_IMAGE_WRITE_FAILED", "保存剪贴板图片时任务异常终止"))?
}

fn save_clipboard_image(root: &Path, mime_type: &str, bytes: &[u8]) -> Result<String, AppError> {
    if bytes.is_empty() {
        return Err(AppError::new("PROMPT_IMAGE_EMPTY", "剪贴板图片内容为空"));
    }
    if bytes.len() as u64 > MAX_PROMPT_IMAGE_BYTES {
        return Err(AppError::new(
            "PROMPT_IMAGE_TOO_LARGE",
            "单张图片不能超过 10 MiB",
        ));
    }
    let declared = image_format_for_mime(mime_type).ok_or_else(|| {
        AppError::new(
            "PROMPT_IMAGE_TYPE_UNSUPPORTED",
            "仅支持 GIF、JPEG、PNG 和 WebP 图片",
        )
    })?;
    if detect_image_format(bytes) != Some(declared) {
        return Err(AppError::new(
            "PROMPT_IMAGE_TYPE_UNSUPPORTED",
            "图片内容与声明的格式不一致",
        ));
    }

    fs::create_dir_all(root)
        .map_err(|_| AppError::new("PROMPT_IMAGE_WRITE_FAILED", "无法创建图片缓存目录"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::new("PROMPT_IMAGE_WRITE_FAILED", "系统时间不可用"))?
        .as_nanos();
    for attempt in 0..32_u8 {
        let path = root.join(format!(
            "paste-{nonce}-{}-{attempt}.{}",
            std::process::id(),
            declared.extension
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if file.write_all(bytes).and_then(|_| file.flush()).is_err() {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err(AppError::new(
                        "PROMPT_IMAGE_WRITE_FAILED",
                        "无法写入剪贴板图片",
                    ));
                }
                drop(file);
                let canonical = path.canonicalize().map_err(|_| {
                    AppError::new("PROMPT_IMAGE_WRITE_FAILED", "无法解析已保存的剪贴板图片")
                })?;
                return Ok(normalize_process_path(canonical)
                    .to_string_lossy()
                    .into_owned());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(AppError::new(
                    "PROMPT_IMAGE_WRITE_FAILED",
                    "无法创建剪贴板图片文件",
                ));
            }
        }
    }
    Err(AppError::new(
        "PROMPT_IMAGE_WRITE_FAILED",
        "无法分配剪贴板图片文件名",
    ))
}

#[tauri::command]
pub async fn workspace_read_file(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    path: String,
) -> Result<WorkspaceFileContent, AppError> {
    let root = PathBuf::from(store.authorize(&cwd)?);
    tauri::async_runtime::spawn_blocking(move || read_workspace_file(&root, &path))
        .await
        .map_err(|_| AppError::new("WORKSPACE_FILE_READ_FAILED", "读取工作区文件时任务异常终止"))?
}

#[tauri::command]
pub fn workspace_open_file(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    path: String,
) -> Result<(), AppError> {
    let root = PathBuf::from(store.authorize(&cwd)?);
    let file = resolve_workspace_file(&root, &path)?;
    let mut command = open_file_command(&file);
    hide_process_window(&mut command);
    command.spawn().map(|_| ()).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "FILE_MANAGER_NOT_FOUND"
        } else {
            "WORKSPACE_FILE_OPEN_FAILED"
        };
        AppError::new(code, "无法使用系统默认应用打开该文件")
    })
}

#[tauri::command]
pub fn workspace_reveal_file(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    path: String,
) -> Result<(), AppError> {
    let root = PathBuf::from(store.authorize(&cwd)?);
    let file = resolve_workspace_file(&root, &path)?;
    let mut command = reveal_command(&file);
    hide_process_window(&mut command);
    command.spawn().map(|_| ()).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "FILE_MANAGER_NOT_FOUND"
        } else {
            "WORKSPACE_FILE_REVEAL_FAILED"
        };
        AppError::new(code, "无法在系统文件管理器中显示该文件")
    })
}

fn read_workspace_file(
    root: &Path,
    requested_path: &str,
) -> Result<WorkspaceFileContent, AppError> {
    let file = resolve_workspace_file(root, requested_path)?;
    let metadata = fs::metadata(&file).map_err(map_workspace_file_read_error)?;
    if metadata.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err(workspace_file_too_large_error());
    }
    let bytes = fs::read(&file).map_err(map_workspace_file_read_error)?;
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(workspace_file_too_large_error());
    }
    Ok(WorkspaceFileContent {
        data_base64: STANDARD.encode(bytes),
        size: metadata.len(),
    })
}

fn resolve_workspace_file(root: &Path, requested_path: &str) -> Result<PathBuf, AppError> {
    let requested_path = requested_path.trim();
    if requested_path.is_empty() || requested_path.chars().any(char::is_control) {
        return Err(AppError::new(
            "WORKSPACE_FILE_PATH_INVALID",
            "工作区文件路径无效",
        ));
    }
    let requested = Path::new(requested_path);
    if requested
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(AppError::new(
            "WORKSPACE_FILE_PATH_INVALID",
            "工作区文件路径无效",
        ));
    }
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };
    let relative = candidate.strip_prefix(root).map_err(|_| {
        AppError::new(
            "WORKSPACE_FILE_UNAUTHORIZED",
            "只能访问已授权工作区内的文件",
        )
    })?;
    reject_unsafe_workspace_path_components(root, relative)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| AppError::new("WORKSPACE_FILE_NOT_FOUND", "工作区文件不存在或无法访问"))?;
    if !canonical.starts_with(root) {
        return Err(AppError::new(
            "WORKSPACE_FILE_UNAUTHORIZED",
            "只能访问已授权工作区内的文件",
        ));
    }
    if !canonical.is_file() {
        return Err(AppError::new(
            "WORKSPACE_FILE_INVALID",
            "工作区路径必须是文件",
        ));
    }
    Ok(canonical)
}

fn reject_unsafe_workspace_path_components(root: &Path, relative: &Path) -> Result<(), AppError> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(name) => {
                current.push(name);
                let metadata = fs::symlink_metadata(&current).map_err(|_| {
                    AppError::new("WORKSPACE_FILE_NOT_FOUND", "工作区文件不存在或无法访问")
                })?;
                if metadata.file_type().is_symlink() {
                    return Err(AppError::new(
                        "WORKSPACE_FILE_SYMLINK_UNSUPPORTED",
                        "工作区文件路径不能包含符号链接",
                    ));
                }
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir
            | std::path::Component::Prefix(_)
            | std::path::Component::RootDir => {
                return Err(AppError::new(
                    "WORKSPACE_FILE_PATH_INVALID",
                    "工作区文件路径无效",
                ));
            }
        }
    }
    Ok(())
}

fn map_workspace_file_read_error(error: std::io::Error) -> AppError {
    let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
        "WORKSPACE_FILE_PERMISSION_DENIED"
    } else {
        "WORKSPACE_FILE_READ_FAILED"
    };
    AppError::new(code, "无法读取工作区文件")
}

fn workspace_file_too_large_error() -> AppError {
    AppError::new(
        "WORKSPACE_FILE_TOO_LARGE",
        "工作区文件超过 512 KiB 预览限制",
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathMatch {
    pub path: String,
    pub relative_path: String,
    pub kind: String,
}

#[tauri::command]
pub async fn workspace_search_paths(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    query: String,
    limit: usize,
) -> Result<Vec<WorkspacePathMatch>, AppError> {
    if limit == 0 || limit > MAX_PATH_SEARCH_RESULTS {
        return Err(AppError::new(
            "WORKSPACE_SEARCH_INVALID",
            "工作区路径搜索条数必须为 1-48",
        ));
    }
    let query = query.trim().to_owned();
    if query.chars().count() > 200 || query.chars().any(char::is_control) {
        return Err(AppError::new(
            "WORKSPACE_SEARCH_INVALID",
            "工作区路径搜索词无效或超过 200 个字符",
        ));
    }
    let authorized = PathBuf::from(store.authorize(&cwd)?);
    tauri::async_runtime::spawn_blocking(move || search_workspace_paths(&authorized, &query, limit))
        .await
        .map_err(|_| {
            AppError::new(
                "WORKSPACE_SEARCH_FAILED",
                "搜索工作区路径时任务异常终止",
            )
        })?
}

fn search_workspace_paths(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspacePathMatch>, AppError> {
    let needle = query.to_lowercase();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut matches = Vec::new();
    let mut scanned = 0usize;

    while let Some((directory, depth)) = queue.pop_front() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) if directory == root => {
                return Err(AppError::new(
                    "WORKSPACE_SEARCH_FAILED",
                    "无法读取当前工作区目录",
                ));
            }
            Err(_) => continue,
        };
        let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        for entry in entries {
            scanned += 1;
            if scanned > MAX_PATH_SEARCH_ENTRIES {
                return Ok(matches);
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            let relative = path.strip_prefix(root).unwrap_or(&path);
            let relative_text = relative.to_string_lossy().into_owned();
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_directory = file_type.is_dir();
            if is_directory && depth < MAX_PATH_SEARCH_DEPTH && !skip_search_directory(&name) {
                queue.push_back((path.clone(), depth + 1));
            }
            if needle.is_empty() || relative_text.to_lowercase().contains(&needle) {
                matches.push(WorkspacePathMatch {
                    path: path.to_string_lossy().into_owned(),
                    relative_path: relative_text,
                    kind: if is_directory { "folder" } else { "file" }.to_owned(),
                });
                if matches.len() >= limit {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

fn skip_search_directory(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache"
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub current: bool,
    pub remote: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeOptions {
    pub branches: Vec<GitBranchInfo>,
    pub suggested_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeInput {
    pub cwd: String,
    pub base: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWorktree {
    pub path: String,
}

#[tauri::command]
pub fn workspace_reveal(store: State<'_, WorkspaceStore>, cwd: String) -> Result<(), AppError> {
    let authorized = store.authorize(&cwd)?;
    let path = PathBuf::from(authorized);
    let mut command = reveal_command(&path);
    hide_process_window(&mut command);
    command.spawn().map(|_| ()).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "FILE_MANAGER_NOT_FOUND"
        } else {
            "WORKSPACE_REVEAL_FAILED"
        };
        AppError::new(code, "无法在系统文件管理器中显示该项目")
    })
}

#[tauri::command]
pub async fn workspace_get_worktree_options(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<WorktreeOptions, AppError> {
    let authorized = PathBuf::from(store.authorize(&cwd)?);
    let worktrees_home = store.worktrees_home();
    tauri::async_runtime::spawn_blocking(move || {
        load_worktree_options(&authorized, &worktrees_home)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "WORKTREE_OPTIONS_FAILED",
            "读取 Git 工作树选项时任务异常终止",
        )
    })?
}

#[tauri::command]
pub async fn workspace_create_worktree(
    store: State<'_, WorkspaceStore>,
    input: CreateWorktreeInput,
) -> Result<CreatedWorktree, AppError> {
    let authorized = PathBuf::from(store.authorize(&input.cwd)?);
    let worktrees_home = store.worktrees_home();
    let result = tauri::async_runtime::spawn_blocking(move || {
        create_worktree(
            &authorized,
            &worktrees_home,
            &input.base,
            input.name.as_deref(),
        )
    })
    .await
    .map_err(|_| AppError::new("WORKTREE_CREATE_FAILED", "创建 Git 工作树时任务异常终止"))??;
    store.remember(&result.path)?;
    Ok(result)
}

fn load_worktree_options(cwd: &Path, worktrees_home: &Path) -> Result<WorktreeOptions, AppError> {
    let branches = list_branches(cwd)?;
    let main_worktree = main_worktree(cwd)?;
    let repository_name = repository_name(&main_worktree);
    let repository_home = worktrees_home.join(&repository_name);
    let local_names = branches
        .iter()
        .filter(|branch| !branch.remote)
        .map(|branch| branch.name.as_str())
        .collect::<HashSet<_>>();
    let suggested_name = next_auto_worktree_name(&repository_name, |candidate| {
        repository_home.join(candidate).exists()
            || local_names.contains(format!("pix/{candidate}").as_str())
    });
    Ok(WorktreeOptions {
        branches,
        suggested_name,
    })
}

fn create_worktree(
    cwd: &Path,
    worktrees_home: &Path,
    base: &str,
    requested_name: Option<&str>,
) -> Result<CreatedWorktree, AppError> {
    let branches = list_branches(cwd)?;
    let base = validate_base(base, &branches)?;

    let main_worktree = main_worktree(cwd)?;
    let repository_name = repository_name(&main_worktree);
    let repository_home = worktrees_home.join(&repository_name);
    fs::create_dir_all(&repository_home).map_err(|error| map_worktree_io_error(&error))?;

    let requested_name = requested_name
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let local_names = branches
        .iter()
        .filter(|branch| !branch.remote)
        .map(|branch| branch.name.as_str())
        .collect::<HashSet<_>>();
    let name = if let Some(requested_name) = requested_name {
        let base_name = normalize_worktree_name(requested_name)?;
        unique_worktree_name(&base_name, |candidate| {
            repository_home.join(candidate).exists()
                || local_names.contains(format!("pix/{candidate}").as_str())
        })
    } else {
        next_auto_worktree_name(&repository_name, |candidate| {
            repository_home.join(candidate).exists()
                || local_names.contains(format!("pix/{candidate}").as_str())
        })
    };
    let target = repository_home.join(&name);
    let branch = format!("pix/{name}");
    let args = worktree_add_args(cwd, &branch, &target, &base);
    let output = run_git(args)?;
    if !output.status.success() {
        return Err(map_git_worktree_error(&output));
    }
    let canonical = target
        .canonicalize()
        .map_err(|error| map_worktree_io_error(&error))?;
    Ok(CreatedWorktree {
        path: canonical.to_string_lossy().into_owned(),
    })
}

fn list_branches(cwd: &Path) -> Result<Vec<GitBranchInfo>, AppError> {
    let format_arg = "--format=%(refname:short)%00%(HEAD)";
    let local = run_git([
        OsString::from("-C"),
        cwd.as_os_str().to_owned(),
        OsString::from("for-each-ref"),
        OsString::from(format_arg),
        OsString::from("refs/heads"),
    ])?;
    ensure_git_success(&local, "GIT_BRANCH_LIST_FAILED", "无法读取本地 Git 分支")?;
    let remote = run_git([
        OsString::from("-C"),
        cwd.as_os_str().to_owned(),
        OsString::from("for-each-ref"),
        OsString::from(format_arg),
        OsString::from("refs/remotes"),
    ])?;
    ensure_git_success(&remote, "GIT_BRANCH_LIST_FAILED", "无法读取远程 Git 分支")?;

    let mut branches = parse_branch_output(&local.stdout, false);
    branches.extend(parse_branch_output(&remote.stdout, true));
    let mut seen = HashSet::new();
    branches.retain(|branch| seen.insert(branch.name.clone()));
    branches.sort_by(|left, right| {
        right
            .current
            .cmp(&left.current)
            .then_with(|| left.remote.cmp(&right.remote))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    branches.truncate(MAX_BRANCHES);
    Ok(branches)
}

fn parse_branch_output(bytes: &[u8], remote: bool) -> Vec<GitBranchInfo> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|line| {
            let (name, head) = line.split_once('\0').unwrap_or((line, ""));
            let name = name.trim();
            if name.is_empty() || name.ends_with("/HEAD") {
                return None;
            }
            Some(GitBranchInfo {
                name: name.to_owned(),
                current: head.trim() == "*",
                remote,
            })
        })
        .collect()
}

fn main_worktree(cwd: &Path) -> Result<PathBuf, AppError> {
    let output = run_git([
        OsString::from("-C"),
        cwd.as_os_str().to_owned(),
        OsString::from("worktree"),
        OsString::from("list"),
        OsString::from("--porcelain"),
    ])?;
    ensure_git_success(
        &output,
        "GIT_REPOSITORY_INVALID",
        "该项目不是可用的 Git 仓库",
    )?;
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix("worktree "))
        .map(PathBuf::from)
        .unwrap_or_else(|| cwd.to_path_buf());
    Ok(path)
}

fn repository_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo");
    normalize_worktree_name(raw).unwrap_or_else(|_| "repo".to_owned())
}

fn normalize_worktree_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.len() > MAX_WORKTREE_NAME_BYTES {
        return Err(AppError::new(
            "WORKTREE_NAME_INVALID",
            "工作树名称不能超过 80 个字符",
        ));
    }
    let mut normalized = String::with_capacity(trimmed.len());
    let mut last_was_separator = false;
    for character in trimmed.chars() {
        let valid = character.is_ascii_alphanumeric() || matches!(character, '_' | '-');
        if valid {
            normalized.push(character);
            last_was_separator = false;
        } else if !last_was_separator {
            normalized.push('-');
            last_was_separator = true;
        }
    }
    let normalized = normalized.trim_matches('-').to_owned();
    if normalized.is_empty() {
        return Err(AppError::new(
            "WORKTREE_NAME_INVALID",
            "工作树名称至少需要包含一个字母、数字、下划线或连字符",
        ));
    }
    Ok(normalized)
}

fn validate_base(base: &str, branches: &[GitBranchInfo]) -> Result<String, AppError> {
    let base = base.trim();
    if base == "HEAD" || branches.iter().any(|branch| branch.name == base) {
        Ok(base.to_owned())
    } else {
        Err(AppError::new(
            "WORKTREE_BASE_INVALID",
            "所选 Git 基准分支不存在，请刷新后重试",
        ))
    }
}

fn next_auto_worktree_name(
    repository_name: &str,
    mut occupied: impl FnMut(&str) -> bool,
) -> String {
    for index in 1..=10_000 {
        let candidate = format!("{repository_name}-{index}");
        if !occupied(&candidate) {
            return candidate;
        }
    }
    format!("{repository_name}-{}", std::process::id())
}

fn unique_worktree_name(base: &str, mut occupied: impl FnMut(&str) -> bool) -> String {
    let base = if base.is_empty() {
        "repo-1".to_owned()
    } else {
        base.to_owned()
    };
    if !occupied(&base) {
        return base;
    }
    for index in 2..=10_000 {
        let candidate = format!("{base}-{index}");
        if !occupied(&candidate) {
            return candidate;
        }
    }
    format!("{base}-{}", std::process::id())
}

fn worktree_add_args(cwd: &Path, branch: &str, target: &Path, base: &str) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("-C"),
        cwd.as_os_str().to_owned(),
        OsString::from("worktree"),
        OsString::from("add"),
        OsString::from("-b"),
        OsString::from(branch),
        target.as_os_str().to_owned(),
    ];
    if base != "HEAD" {
        args.push(OsString::from(base));
    }
    args
}

fn run_git(args: impl IntoIterator<Item = OsString>) -> Result<Output, AppError> {
    let mut command = Command::new("git");
    command.args(args);
    hide_process_window(&mut command);
    let output = command.output().map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "GIT_NOT_FOUND"
        } else {
            "GIT_COMMAND_FAILED"
        };
        let message = if code == "GIT_NOT_FOUND" {
            "未找到 Git，请先安装 Git 并确保其可从 PATH 访问"
        } else {
            "无法启动 Git 命令"
        };
        AppError::new(code, message)
    })?;
    if output.stdout.len() > MAX_GIT_OUTPUT_BYTES || output.stderr.len() > MAX_GIT_OUTPUT_BYTES {
        return Err(AppError::new(
            "GIT_OUTPUT_TOO_LARGE",
            "Git 返回内容超过 1 MiB 安全限制",
        ));
    }
    Ok(output)
}

fn ensure_git_success(
    output: &Output,
    fallback_code: &'static str,
    fallback_message: &'static str,
) -> Result<(), AppError> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("not a git repository") {
        Err(AppError::new(
            "GIT_REPOSITORY_INVALID",
            "该项目不是可用的 Git 仓库",
        ))
    } else if stderr.contains("permission denied") || stderr.contains("access is denied") {
        Err(AppError::new(
            "WORKTREE_PERMISSION_DENIED",
            "没有访问该 Git 仓库的权限",
        ))
    } else {
        Err(AppError::new(fallback_code, fallback_message))
    }
}

fn map_git_worktree_error(output: &Output) -> AppError {
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("not a git repository") {
        AppError::new("GIT_REPOSITORY_INVALID", "该项目不是可用的 Git 仓库")
    } else if stderr.contains("invalid reference")
        || stderr.contains("not a valid object name")
        || stderr.contains("unknown revision")
    {
        AppError::new("WORKTREE_BASE_INVALID", "所选 Git 基准分支不可用")
    } else if stderr.contains("already exists") || stderr.contains("already checked out") {
        AppError::new("WORKTREE_NAME_CONFLICT", "工作树目录或分支已存在，请重试")
    } else if stderr.contains("permission denied") || stderr.contains("access is denied") {
        AppError::new(
            "WORKTREE_PERMISSION_DENIED",
            "没有创建 Git 工作树目录或分支的权限",
        )
    } else {
        AppError::new(
            "WORKTREE_CREATE_FAILED",
            "Git 未能创建工作树，请检查仓库状态后重试",
        )
    }
}

fn map_worktree_io_error(error: &std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        AppError::new(
            "WORKTREE_PERMISSION_DENIED",
            "没有创建或访问 Git 工作树目录的权限",
        )
    } else {
        AppError::new("WORKTREE_CREATE_FAILED", "无法创建或解析 Git 工作树目录")
    }
}

#[cfg(target_os = "windows")]
fn reveal_command(path: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(format!("/select,{}", path.to_string_lossy()));
    command
}

#[cfg(target_os = "windows")]
fn open_file_command(path: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(path);
    command
}

#[cfg(target_os = "macos")]
fn reveal_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg("-R").arg(path);
    command
}

#[cfg(target_os = "macos")]
fn open_file_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(path);
    command
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn reveal_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path.parent().unwrap_or(path));
    command
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn open_file_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}

fn hide_process_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nclipboard";

    #[test]
    fn saves_valid_clipboard_image_with_a_unique_absolute_path() {
        let root = workspace_file_test_root("clipboard-image");

        let saved = save_clipboard_image(&root, "image/png", PNG_BYTES).unwrap();
        let saved_path = PathBuf::from(saved);

        assert!(saved_path.is_absolute());
        assert_eq!(
            saved_path.extension().and_then(|value| value.to_str()),
            Some("png")
        );
        assert_eq!(fs::read(&saved_path).unwrap(), PNG_BYTES);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_empty_oversized_and_spoofed_clipboard_images() {
        let root = workspace_file_test_root("clipboard-invalid");

        assert_eq!(
            save_clipboard_image(&root, "image/png", &[])
                .unwrap_err()
                .code,
            "PROMPT_IMAGE_EMPTY"
        );
        assert_eq!(
            save_clipboard_image(
                &root,
                "image/png",
                &vec![0_u8; MAX_PROMPT_IMAGE_BYTES as usize + 1],
            )
            .unwrap_err()
            .code,
            "PROMPT_IMAGE_TOO_LARGE"
        );
        assert_eq!(
            save_clipboard_image(&root, "image/png", b"not a png")
                .unwrap_err()
                .code,
            "PROMPT_IMAGE_TYPE_UNSUPPORTED"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_and_sorts_local_and_remote_branches() {
        let mut branches = parse_branch_output(b"main\0*\nfeature\0 \n", false);
        branches.extend(parse_branch_output(
            b"origin/HEAD\0 \norigin/main\0 \n",
            true,
        ));
        branches.sort_by(|left, right| {
            right
                .current
                .cmp(&left.current)
                .then_with(|| left.remote.cmp(&right.remote))
                .then_with(|| left.name.cmp(&right.name))
        });

        assert_eq!(
            branches,
            vec![
                GitBranchInfo {
                    name: "main".to_owned(),
                    current: true,
                    remote: false,
                },
                GitBranchInfo {
                    name: "feature".to_owned(),
                    current: false,
                    remote: false,
                },
                GitBranchInfo {
                    name: "origin/main".to_owned(),
                    current: false,
                    remote: true,
                },
            ]
        );
    }

    #[test]
    fn normalizes_names_and_increments_conflicts() {
        assert_eq!(
            normalize_worktree_name(" Feature / Login ").unwrap(),
            "Feature-Login"
        );
        assert_eq!(
            normalize_worktree_name("中文").unwrap_err().code,
            "WORKTREE_NAME_INVALID"
        );
        let occupied = HashSet::from(["alpha-1", "alpha-2", "alpha-1-2"]);
        assert_eq!(
            unique_worktree_name("alpha-1", |candidate| occupied.contains(candidate)),
            "alpha-1-3"
        );
        assert_eq!(
            next_auto_worktree_name("alpha", |candidate| occupied.contains(candidate)),
            "alpha-3"
        );
    }

    #[test]
    fn rejects_unknown_worktree_base() {
        let branches = vec![GitBranchInfo {
            name: "main".to_owned(),
            current: true,
            remote: false,
        }];
        assert_eq!(validate_base("HEAD", &branches).unwrap(), "HEAD");
        assert_eq!(validate_base("main", &branches).unwrap(), "main");
        assert_eq!(
            validate_base("missing", &branches).unwrap_err().code,
            "WORKTREE_BASE_INVALID"
        );
    }

    #[test]
    fn builds_fixed_worktree_arguments_without_a_shell() {
        let args = worktree_add_args(
            Path::new("C:\\repo"),
            "pix/alpha-1",
            Path::new("C:\\Documents\\Pix\\worktrees\\repo\\alpha-1"),
            "origin/main",
        );
        let values = args
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            vec![
                "-C",
                "C:\\repo",
                "worktree",
                "add",
                "-b",
                "pix/alpha-1",
                "C:\\Documents\\Pix\\worktrees\\repo\\alpha-1",
                "origin/main",
            ]
        );
        assert_eq!(
            worktree_add_args(
                Path::new("C:\\repo"),
                "pix/alpha-1",
                Path::new("C:\\target"),
                "HEAD"
            )
            .len(),
            7
        );
    }

    #[test]
    fn searches_workspace_paths_breadth_first_and_skips_heavy_directories() {
        let root = std::env::temp_dir().join(format!(
            "pi-desktop-workspace-search-test-{}",
            std::process::id()
        ));
        let source = root.join("src");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(root.join("node_modules").join("hidden")).unwrap();
        fs::write(root.join("README.md"), "readme").unwrap();
        fs::write(source.join("composer.tsx"), "composer").unwrap();
        fs::write(root.join("node_modules").join("hidden").join("composer.ts"), "x").unwrap();

        let matches = search_workspace_paths(&root, "composer", 24).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].kind, "file");
        assert!(matches[0].relative_path.ends_with("composer.tsx"));

        let initial = search_workspace_paths(&root, "", 2).unwrap();
        assert_eq!(initial.len(), 2);
        let _ = fs::remove_dir_all(root);
    }

    fn workspace_file_test_root(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间应晚于 UNIX 纪元")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "pi-desktop-workspace-file-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("应能创建测试工作区");
        root.canonicalize().expect("应能规范化测试工作区")
    }

    #[test]
    fn reads_relative_workspace_file_as_base64() {
        let root = workspace_file_test_root("read");
        let source = root.join("src");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("hello.txt"), b"hello").unwrap();

        let content = read_workspace_file(&root, "src/hello.txt").unwrap();

        assert_eq!(content.size, 5);
        assert_eq!(content.data_base64, "aGVsbG8=");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_absolute_workspace_file_at_preview_limit() {
        let root = workspace_file_test_root("absolute-limit");
        let file = root.join("limit.bin");
        fs::write(&file, vec![7_u8; MAX_WORKSPACE_FILE_BYTES as usize]).unwrap();

        let content = read_workspace_file(&root, &file.to_string_lossy()).unwrap();

        assert_eq!(content.size, MAX_WORKSPACE_FILE_BYTES);
        assert!(!content.data_base64.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_workspace_file_outside_root_and_parent_traversal() {
        let root = workspace_file_test_root("outside");
        let outside = root.parent().unwrap().join("outside.txt");
        fs::write(&outside, b"outside").unwrap();

        assert_eq!(
            resolve_workspace_file(&root, &outside.to_string_lossy())
                .unwrap_err()
                .code,
            "WORKSPACE_FILE_UNAUTHORIZED"
        );
        assert_eq!(
            resolve_workspace_file(&root, "../outside.txt")
                .unwrap_err()
                .code,
            "WORKSPACE_FILE_PATH_INVALID"
        );

        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn rejects_workspace_file_symbolic_links() {
        let root = workspace_file_test_root("symlink");
        let outside = root.parent().unwrap().join("symlink-target.txt");
        let link = root.join("linked.txt");
        fs::write(&outside, b"outside").unwrap();
        std::os::windows::fs::symlink_file(&outside, &link).unwrap();

        assert_eq!(
            read_workspace_file(&root, "linked.txt").unwrap_err().code,
            "WORKSPACE_FILE_SYMLINK_UNSUPPORTED"
        );

        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_directories_and_files_larger_than_preview_limit() {
        let root = workspace_file_test_root("limits");
        let directory = root.join("folder");
        fs::create_dir_all(&directory).unwrap();
        let large_file = root.join("large.txt");
        fs::write(
            &large_file,
            vec![0_u8; MAX_WORKSPACE_FILE_BYTES as usize + 1],
        )
        .unwrap();

        assert_eq!(
            read_workspace_file(&root, "folder").unwrap_err().code,
            "WORKSPACE_FILE_INVALID"
        );
        assert_eq!(
            read_workspace_file(&root, "large.txt").unwrap_err().code,
            "WORKSPACE_FILE_TOO_LARGE"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_empty_control_character_and_missing_file_paths() {
        let root = workspace_file_test_root("invalid-paths");

        assert_eq!(
            resolve_workspace_file(&root, " ").unwrap_err().code,
            "WORKSPACE_FILE_PATH_INVALID"
        );
        assert_eq!(
            resolve_workspace_file(&root, "bad\nname.txt")
                .unwrap_err()
                .code,
            "WORKSPACE_FILE_PATH_INVALID"
        );
        assert_eq!(
            resolve_workspace_file(&root, "missing.txt")
                .unwrap_err()
                .code,
            "WORKSPACE_FILE_NOT_FOUND"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn builds_fixed_file_open_and_reveal_commands_without_a_shell() {
        let path = Path::new("C:\\repo\\file name.txt");
        let open = open_file_command(path);
        let reveal = reveal_command(path);

        #[cfg(target_os = "windows")]
        {
            assert_eq!(open.get_program(), "explorer.exe");
            assert_eq!(open.get_args().collect::<Vec<_>>(), vec![path.as_os_str()]);
            assert_eq!(reveal.get_program(), "explorer.exe");
            assert_eq!(
                reveal.get_args().collect::<Vec<_>>(),
                vec![std::ffi::OsStr::new("/select,C:\\repo\\file name.txt")]
            );
        }
        #[cfg(target_os = "macos")]
        {
            assert_eq!(open.get_program(), "open");
            assert_eq!(reveal.get_args().collect::<Vec<_>>(), vec!["-R", path]);
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            assert_eq!(open.get_program(), "xdg-open");
            assert_eq!(reveal.get_program(), "xdg-open");
        }
    }
}
