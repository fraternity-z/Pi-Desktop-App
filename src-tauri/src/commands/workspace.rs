use std::{
    collections::{HashSet, VecDeque},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    error::AppError,
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

#[cfg(target_os = "macos")]
fn reveal_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg("-R").arg(path);
    command
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn reveal_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path.parent().unwrap_or(path));
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
}
