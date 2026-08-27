use std::{
    ffi::OsString,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::ffi::c_void;

use serde::Serialize;
use tauri::State;

use crate::{error::AppError, storage::WorkspaceStore};

const MAX_GIT_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_GIT_PATHS: usize = 64;
const MAX_GIT_PATH_BYTES: usize = 1024;
const MAX_COMMIT_MESSAGE_BYTES: usize = 4096;
const MAX_BRANCH_NAME_BYTES: usize = 255;
const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30);
const MUTATING_GIT_TIMEOUT: Duration = Duration::from_secs(120);
const UNSAFE_GIT_ENVIRONMENTS: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_COUNT",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_NAMESPACE",
    "GIT_REPLACE_REF_BASE",
    "GIT_EXEC_PATH",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_ASKPASS",
];
const UNTRACKED_EMPTY_DIFF: &str = "未跟踪文件为空，暂无可展示的文本差异";
const UNTRACKED_BINARY_DIFF: &str = "未跟踪文件不是 UTF-8 文本，无法展示差异";
const UNTRACKED_DIRECTORY_DIFF: &str = "未跟踪路径是目录，无法展示单文件差异";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub is_repository: bool,
    pub repo_root: Option<String>,
    pub branch: Option<GitBranchSummary>,
    pub staged: Vec<GitStatusEntry>,
    pub unstaged: Vec<GitStatusEntry>,
    pub untracked: Vec<GitStatusEntry>,
    pub conflicted: Vec<GitStatusEntry>,
    pub is_clean: bool,
}

impl GitStatusSnapshot {
    fn not_repository() -> Self {
        Self {
            is_repository: false,
            repo_root: None,
            branch: None,
            staged: Vec::new(),
            unstaged: Vec::new(),
            untracked: Vec::new(),
            conflicted: Vec::new(),
            is_clean: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffOutput {
    pub path: Option<String>,
    pub staged: bool,
    pub diff: String,
}

#[tauri::command]
pub async fn git_get_status(
    store: State<'_, WorkspaceStore>,
    cwd: String,
) -> Result<GitStatusSnapshot, AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || get_status(&workspace)).await
}

#[tauri::command]
pub async fn git_get_diff(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    path: Option<String>,
    staged: Option<bool>,
    ignore_whitespace_changes: Option<bool>,
) -> Result<GitDiffOutput, AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || {
        get_diff(
            &workspace,
            path.as_deref(),
            staged.unwrap_or(false),
            ignore_whitespace_changes.unwrap_or(false),
        )
    })
    .await
}

#[tauri::command]
pub async fn git_stage(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || stage_paths(&workspace, &paths)).await
}

#[tauri::command]
pub async fn git_unstage(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || unstage_paths(&workspace, &paths)).await
}

#[tauri::command]
pub async fn git_discard(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    paths: Vec<String>,
    delete_untracked: bool,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || discard_paths(&workspace, &paths, delete_untracked)).await
}

#[tauri::command]
pub async fn git_init(store: State<'_, WorkspaceStore>, cwd: String) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || init_repository(&workspace)).await
}

#[tauri::command]
pub async fn git_commit(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    message: String,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || commit(&workspace, &message)).await
}

#[tauri::command]
pub async fn git_push(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    force_with_lease: Option<bool>,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || push(&workspace, force_with_lease.unwrap_or(false))).await
}

#[tauri::command]
pub async fn git_create_branch(
    store: State<'_, WorkspaceStore>,
    cwd: String,
    name: String,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(store.authorize(&cwd)?);
    run_blocking(move || create_branch(&workspace, &name)).await
}

async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| AppError::new("GIT_OPERATION_FAILED", "Git 操作任务异常终止"))?
}

fn get_status(workspace: &Path) -> Result<GitStatusSnapshot, AppError> {
    let Some(repo_root) = repository_root(workspace)? else {
        return Ok(GitStatusSnapshot::not_repository());
    };
    let output = run_git(
        &repo_root,
        [
            "status",
            "--porcelain=v1",
            "-z",
            "-b",
            "--untracked-files=all",
        ],
    )?;
    ensure_git_success(&output, "GIT_STATUS_FAILED", "无法读取 Git 工作区状态")?;
    let (branch, staged, unstaged, untracked, conflicted) = parse_status(&output.stdout);
    let is_clean =
        staged.is_empty() && unstaged.is_empty() && untracked.is_empty() && conflicted.is_empty();
    Ok(GitStatusSnapshot {
        is_repository: true,
        repo_root: Some(repo_root.to_string_lossy().into_owned()),
        branch: Some(branch),
        staged,
        unstaged,
        untracked,
        conflicted,
        is_clean,
    })
}

fn get_diff(
    workspace: &Path,
    path: Option<&str>,
    staged: bool,
    ignore_whitespace_changes: bool,
) -> Result<GitDiffOutput, AppError> {
    let repo_root = require_repository(workspace)?;
    let path = path.map(validate_pathspec).transpose()?;
    let mut args = vec![OsString::from("diff"), OsString::from("--no-ext-diff")];
    if staged {
        args.push(OsString::from("--cached"));
    }
    if ignore_whitespace_changes {
        args.push(OsString::from("--ignore-all-space"));
    }
    if let Some(path) = &path {
        args.push(OsString::from("--"));
        args.push(OsString::from(path));
    }
    let output = run_git_os(&repo_root, args)?;
    ensure_git_success(&output, "GIT_DIFF_FAILED", "无法读取 Git 差异")?;
    let diff = String::from_utf8_lossy(&output.stdout).into_owned();
    let diff = if diff.is_empty() {
        match path.as_deref() {
            Some(path) if is_untracked_path(&repo_root, path)? => {
                untracked_file_diff(&repo_root, path)?
            }
            _ => diff,
        }
    } else {
        diff
    };
    Ok(GitDiffOutput { path, staged, diff })
}

fn stage_paths(workspace: &Path, paths: &[String]) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    run_paths(
        &repo_root,
        ["add", "--"],
        paths,
        "GIT_STAGE_FAILED",
        "无法暂存所选文件",
    )
}

fn unstage_paths(workspace: &Path, paths: &[String]) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    let paths = validate_paths(paths)?;
    let args = if has_head(&repo_root)? {
        extend_args(["reset", "HEAD", "--"], paths)
    } else {
        extend_args(["rm", "--cached", "-r", "--"], paths)
    };
    let output = run_git_os(&repo_root, args)?;
    ensure_git_success(&output, "GIT_UNSTAGE_FAILED", "无法取消暂存所选文件")
}

fn discard_paths(
    workspace: &Path,
    paths: &[String],
    delete_untracked: bool,
) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    let prefix = if delete_untracked {
        ["clean", "-f", "--"]
    } else {
        ["restore", "--worktree", "--"]
    };
    run_paths(
        &repo_root,
        prefix,
        paths,
        "GIT_DISCARD_FAILED",
        "无法丢弃所选文件的更改",
    )
}

fn init_repository(workspace: &Path) -> Result<(), AppError> {
    if repository_root(workspace)?.is_some() {
        return Err(AppError::new(
            "GIT_ALREADY_INITIALIZED",
            "当前工作区已经是 Git 仓库",
        ));
    }
    let output = run_git(workspace, ["init"])?;
    ensure_git_success(&output, "GIT_INIT_FAILED", "无法初始化 Git 仓库")
}

fn commit(workspace: &Path, message: &str) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    let message = validate_commit_message(message)?;
    let output = run_git_os(
        &repo_root,
        vec![
            OsString::from("commit"),
            OsString::from("-m"),
            OsString::from(message),
        ],
    )?;
    ensure_git_success(&output, "GIT_COMMIT_FAILED", "无法创建 Git 提交")
}

fn push(workspace: &Path, force_with_lease: bool) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    let mut args = vec![OsString::from("push")];
    if force_with_lease {
        args.push(OsString::from("--force-with-lease"));
    }
    let output = run_git_os(&repo_root, args)?;
    ensure_git_success(&output, "GIT_PUSH_FAILED", "无法推送 Git 提交")
}

fn create_branch(workspace: &Path, name: &str) -> Result<(), AppError> {
    let repo_root = require_repository(workspace)?;
    let name = validate_branch_name(name)?;
    let output = run_git_os(
        &repo_root,
        vec![
            OsString::from("checkout"),
            OsString::from("-b"),
            OsString::from(name),
        ],
    )?;
    ensure_git_success(&output, "GIT_BRANCH_CREATE_FAILED", "无法创建 Git 分支")
}

fn run_paths<const N: usize>(
    repo_root: &Path,
    prefix: [&str; N],
    paths: &[String],
    code: &'static str,
    message: &'static str,
) -> Result<(), AppError> {
    let output = run_git_os(repo_root, extend_args(prefix, validate_paths(paths)?))?;
    ensure_git_success(&output, code, message)
}

fn repository_root(workspace: &Path) -> Result<Option<PathBuf>, AppError> {
    let workspace = workspace
        .canonicalize()
        .map_err(|_| AppError::new("WORKSPACE_PATH_INVALID", "工作区路径不存在或无法访问"))?;
    let output = run_git(&workspace, ["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if root.is_empty() {
        return Ok(None);
    }
    let repo_root = PathBuf::from(root)
        .canonicalize()
        .map_err(|_| AppError::new("GIT_REPOSITORY_INVALID", "Git 仓库路径无效"))?;
    if !repo_root.starts_with(&workspace) {
        return Err(AppError::new(
            "GIT_REPOSITORY_UNAUTHORIZED",
            "Git 仓库根目录不在已授权工作区内",
        ));
    }
    Ok(Some(repo_root))
}

fn require_repository(workspace: &Path) -> Result<PathBuf, AppError> {
    repository_root(workspace)?.ok_or_else(|| {
        AppError::new(
            "GIT_REPOSITORY_INVALID",
            "当前工作区不是 Git 仓库，请先初始化",
        )
    })
}

fn has_head(repo_root: &Path) -> Result<bool, AppError> {
    let output = run_git(repo_root, ["rev-parse", "--verify", "HEAD"])?;
    Ok(output.status.success())
}

fn is_untracked_path(repo_root: &Path, path: &str) -> Result<bool, AppError> {
    let output = run_git_os(
        repo_root,
        vec![
            OsString::from("ls-files"),
            OsString::from("--others"),
            OsString::from("--exclude-standard"),
            OsString::from("-z"),
            OsString::from("--"),
            OsString::from(path),
        ],
    )?;
    ensure_git_success(&output, "GIT_DIFF_FAILED", "无法读取 Git 差异")?;
    let is_directory = repo_root.join(path).is_dir();
    Ok(output
        .stdout
        .split(|byte| *byte == b'\0')
        .filter(|value| !value.is_empty())
        .any(|value| {
            value == path.as_bytes()
                || (is_directory
                    && value.starts_with(path.as_bytes())
                    && value.get(path.len()) == Some(&b'/'))
        }))
}

fn untracked_file_diff(repo_root: &Path, path: &str) -> Result<String, AppError> {
    let file = resolve_repository_file(repo_root, path)?;
    if file.is_dir() {
        return Ok(UNTRACKED_DIRECTORY_DIFF.to_owned());
    }
    let metadata = std::fs::metadata(&file)
        .map_err(|_| AppError::new("GIT_DIFF_FAILED", "无法读取未跟踪文件"))?;
    if metadata.len() > MAX_GIT_OUTPUT_BYTES as u64 {
        return Err(AppError::new(
            "GIT_OUTPUT_TOO_LARGE",
            "未跟踪文件超过 512 KiB 预览限制",
        ));
    }
    let bytes =
        std::fs::read(&file).map_err(|_| AppError::new("GIT_DIFF_FAILED", "无法读取未跟踪文件"))?;
    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(_) => return Ok(UNTRACKED_BINARY_DIFF.to_owned()),
    };
    if content.is_empty() {
        return Ok(UNTRACKED_EMPTY_DIFF.to_owned());
    }
    Ok(render_untracked_text_diff(path, &content))
}

fn resolve_repository_file(repo_root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let candidate = repo_root.join(path);
    reject_symlink_components(repo_root, &candidate)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| AppError::new("GIT_DIFF_FAILED", "未跟踪文件不存在或无法访问"))?;
    if !canonical.starts_with(repo_root) {
        return Err(AppError::new("GIT_PATH_INVALID", "Git 文件路径无效"));
    }
    Ok(canonical)
}

fn reject_symlink_components(repo_root: &Path, candidate: &Path) -> Result<(), AppError> {
    let relative = candidate
        .strip_prefix(repo_root)
        .map_err(|_| AppError::new("GIT_PATH_INVALID", "Git 文件路径无效"))?;
    let mut current = repo_root.to_path_buf();
    for component in relative.components() {
        if let Component::Normal(name) = component {
            current.push(name);
            let metadata = std::fs::symlink_metadata(&current)
                .map_err(|_| AppError::new("GIT_DIFF_FAILED", "未跟踪文件不存在或无法访问"))?;
            if metadata.file_type().is_symlink() {
                return Err(AppError::new(
                    "GIT_PATH_INVALID",
                    "Git 文件路径不能包含符号链接",
                ));
            }
        }
    }
    Ok(())
}

fn render_untracked_text_diff(path: &str, content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let mut diff = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{} @@\n",
        lines.len()
    );
    for line in lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if !normalized.ends_with('\n') {
        diff.push_str("\\ No newline at end of file\n");
    }
    diff
}

fn run_git<const N: usize>(repo_root: &Path, args: [&str; N]) -> Result<Output, AppError> {
    run_git_os(repo_root, args.into_iter().map(OsString::from).collect())
}

fn run_git_os(repo_root: &Path, args: Vec<OsString>) -> Result<Output, AppError> {
    let timeout = git_timeout(&args);
    let mut command = git_command(repo_root, args);
    hide_process_window(&mut command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "GIT_NOT_FOUND"
        } else {
            "GIT_COMMAND_FAILED"
        };
        AppError::new(code, "无法启动 Git 命令")
    })?;
    let mut process_tree = match GitProcessTree::attach(&child) {
        Ok(process_tree) => process_tree,
        Err(error) => {
            let _ = terminate_child(&mut child);
            return Err(error);
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            return Err(cleanup_after_spawn_error(
                &mut child,
                &mut process_tree,
                "无法读取 Git 标准输出",
            ));
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            return Err(cleanup_after_spawn_error(
                &mut child,
                &mut process_tree,
                "无法读取 Git 错误输出",
            ));
        }
    };
    let (limit_sender, limit_receiver) = mpsc::channel();
    let stdout_sender = limit_sender.clone();
    let stdout_reader = thread::spawn(move || read_limited(stdout, stdout_sender));
    let stderr_reader = thread::spawn(move || read_limited(stderr, limit_sender));

    let started_at = Instant::now();
    let mut limit_exceeded = false;
    let mut timed_out = false;
    let status = loop {
        if started_at.elapsed() >= timeout {
            timed_out = true;
            break terminate_and_reap(&mut child, &mut process_tree)?;
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(_) => {
                let error = AppError::new("GIT_COMMAND_FAILED", "等待 Git 命令失败");
                return Err(cleanup_after_reader_error(
                    &mut child,
                    &mut process_tree,
                    stdout_reader,
                    stderr_reader,
                    error,
                ));
            }
        }
        match limit_receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(()) => {
                limit_exceeded = true;
                break terminate_and_reap(&mut child, &mut process_tree)?;
            }
            Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => {}
        }
    };
    process_tree.close();
    let stdout = match join_captured_stream(stdout_reader) {
        Ok(stdout) => stdout,
        Err(error) => {
            let _ = join_captured_stream(stderr_reader);
            return Err(error);
        }
    };
    let stderr = join_captured_stream(stderr_reader)?;
    if timed_out {
        return Err(AppError::new(
            "GIT_COMMAND_TIMEOUT",
            "Git 命令执行超时，请检查仓库状态或网络连接后重试",
        ));
    }
    if limit_exceeded || stdout.exceeded || stderr.exceeded {
        return Err(AppError::new(
            "GIT_OUTPUT_TOO_LARGE",
            "Git 返回内容超过 512 KiB 安全限制",
        ));
    }
    Ok(Output {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
    })
}

fn git_timeout(args: &[OsString]) -> Duration {
    match args.first().and_then(|arg| arg.to_str()) {
        Some("commit" | "push") => MUTATING_GIT_TIMEOUT,
        _ => LOCAL_GIT_TIMEOUT,
    }
}

fn terminate_and_reap(
    child: &mut std::process::Child,
    process_tree: &mut GitProcessTree,
) -> Result<std::process::ExitStatus, AppError> {
    process_tree.close();
    terminate_child(child)
}

fn terminate_child(child: &mut std::process::Child) -> Result<std::process::ExitStatus, AppError> {
    let _ = child.kill();
    child
        .wait()
        .map_err(|_| AppError::new("GIT_COMMAND_FAILED", "终止 Git 命令失败"))
}

fn cleanup_after_spawn_error(
    child: &mut std::process::Child,
    process_tree: &mut GitProcessTree,
    message: &'static str,
) -> AppError {
    let _ = terminate_and_reap(child, process_tree);
    AppError::new("GIT_COMMAND_FAILED", message)
}

fn cleanup_after_reader_error(
    child: &mut std::process::Child,
    process_tree: &mut GitProcessTree,
    stdout_reader: thread::JoinHandle<io::Result<CapturedStream>>,
    stderr_reader: thread::JoinHandle<io::Result<CapturedStream>>,
    error: AppError,
) -> AppError {
    let _ = terminate_and_reap(child, process_tree);
    let _ = join_captured_stream(stdout_reader);
    let _ = join_captured_stream(stderr_reader);
    error
}

#[cfg(windows)]
struct GitProcessTree {
    job: *mut c_void,
}

#[cfg(windows)]
impl GitProcessTree {
    fn attach(child: &std::process::Child) -> Result<Self, AppError> {
        use std::os::windows::io::AsRawHandle;

        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(AppError::new(
                "GIT_COMMAND_FAILED",
                "无法创建 Git 进程树隔离作业",
            ));
        }
        let tree = Self { job };
        let mut limits = JobObjectExtendedLimitInformation {
            basic_limit_information: JobObjectBasicLimitInformation {
                limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                ..JobObjectBasicLimitInformation::default()
            },
            ..JobObjectExtendedLimitInformation::default()
        };
        let configured = unsafe {
            SetInformationJobObject(
                tree.job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&mut limits as *mut JobObjectExtendedLimitInformation).cast(),
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            return Err(AppError::new(
                "GIT_COMMAND_FAILED",
                "无法配置 Git 进程树隔离作业",
            ));
        }
        let assigned = unsafe { AssignProcessToJobObject(tree.job, child.as_raw_handle().cast()) };
        if assigned == 0 {
            return Err(AppError::new("GIT_COMMAND_FAILED", "无法隔离 Git 进程树"));
        }
        Ok(tree)
    }

    fn close(&mut self) {
        if !self.job.is_null() {
            unsafe {
                CloseHandle(self.job);
            }
            self.job = std::ptr::null_mut();
        }
    }
}

#[cfg(windows)]
impl Drop for GitProcessTree {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(not(windows))]
struct GitProcessTree;

#[cfg(not(windows))]
impl GitProcessTree {
    fn attach(_: &std::process::Child) -> Result<Self, AppError> {
        Ok(Self)
    }

    fn close(&mut self) {}
}

#[cfg(windows)]
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
#[cfg(windows)]
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
    fn SetInformationJobObject(
        job: *mut c_void,
        information_class: u32,
        information: *mut c_void,
        information_length: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

fn git_command(repo_root: &Path, args: Vec<OsString>) -> Command {
    let mut command = Command::new("git");
    for name in UNSAFE_GIT_ENVIRONMENTS {
        command.env_remove(name);
    }
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(name);
        }
    }
    command
        .arg("--literal-pathspecs")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .stdin(Stdio::null())
        .env_remove("SSH_ASKPASS")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never");
    command
}

struct CapturedStream {
    bytes: Vec<u8>,
    exceeded: bool,
}

fn read_limited(
    mut reader: impl Read,
    limit_sender: mpsc::Sender<()>,
) -> io::Result<CapturedStream> {
    let mut bytes = Vec::with_capacity(MAX_GIT_OUTPUT_BYTES.min(8192));
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(CapturedStream {
                bytes,
                exceeded: false,
            });
        }
        let remaining = MAX_GIT_OUTPUT_BYTES.saturating_sub(bytes.len());
        if read > remaining {
            bytes.extend_from_slice(&buffer[..remaining]);
            let _ = limit_sender.send(());
            return Ok(CapturedStream {
                bytes,
                exceeded: true,
            });
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
}

fn join_captured_stream(
    reader: thread::JoinHandle<io::Result<CapturedStream>>,
) -> Result<CapturedStream, AppError> {
    reader
        .join()
        .map_err(|_| AppError::new("GIT_COMMAND_FAILED", "读取 Git 输出的任务异常终止"))?
        .map_err(|_| AppError::new("GIT_COMMAND_FAILED", "读取 Git 输出失败"))
}

fn ensure_git_success(
    output: &Output,
    code: &'static str,
    message: &'static str,
) -> Result<(), AppError> {
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(code, message))
    }
}

fn validate_paths(paths: &[String]) -> Result<Vec<OsString>, AppError> {
    if paths.is_empty() || paths.len() > MAX_GIT_PATHS {
        return Err(AppError::new(
            "GIT_PATHS_INVALID",
            "Git 文件数量必须为 1-64",
        ));
    }
    paths
        .iter()
        .map(|path| validate_pathspec(path).map(OsString::from))
        .collect()
}

fn validate_pathspec(path: &str) -> Result<String, AppError> {
    let path = path.trim();
    if path.is_empty()
        || path.len() > MAX_GIT_PATH_BYTES
        || path.chars().any(char::is_control)
        || Path::new(path).is_absolute()
        || Path::new(path).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(AppError::new("GIT_PATH_INVALID", "Git 文件路径无效"));
    }
    Ok(path.to_owned())
}

fn validate_commit_message(message: &str) -> Result<String, AppError> {
    let message = message.trim();
    if message.is_empty() || message.len() > MAX_COMMIT_MESSAGE_BYTES || message.contains('\0') {
        return Err(AppError::new(
            "GIT_COMMIT_MESSAGE_INVALID",
            "提交说明不能为空且不能超过 4096 字节",
        ));
    }
    Ok(message.to_owned())
}

fn validate_branch_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    let invalid = name.is_empty()
        || name.len() > MAX_BRANCH_NAME_BYTES
        || name == "@"
        || name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('.')
        || name.ends_with('/')
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name.split('/').any(|component| {
            component.is_empty() || component.starts_with('.') || component.ends_with(".lock")
        })
        || name.chars().any(|character| {
            character.is_control()
                || matches!(character, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        });
    if invalid {
        return Err(AppError::new("GIT_BRANCH_NAME_INVALID", "Git 分支名称无效"));
    }
    Ok(name.to_owned())
}

fn extend_args<const N: usize>(prefix: [&str; N], paths: Vec<OsString>) -> Vec<OsString> {
    let mut args = prefix.into_iter().map(OsString::from).collect::<Vec<_>>();
    args.extend(paths);
    args
}

fn parse_status(
    bytes: &[u8],
) -> (
    GitBranchSummary,
    Vec<GitStatusEntry>,
    Vec<GitStatusEntry>,
    Vec<GitStatusEntry>,
    Vec<GitStatusEntry>,
) {
    let mut records = bytes
        .split(|byte| *byte == b'\0')
        .filter(|record| !record.is_empty());
    let header = records.next().unwrap_or_default();
    let branch = parse_branch_header(&String::from_utf8_lossy(header));
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 3 || record[2] != b' ' {
            continue;
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let path = String::from_utf8_lossy(&record[3..]).into_owned();
        let original_path = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            records
                .next()
                .map(|value| String::from_utf8_lossy(value).into_owned())
        } else {
            None
        };
        let entry = GitStatusEntry {
            path,
            original_path,
            index_status: index.to_string(),
            worktree_status: worktree.to_string(),
        };
        if index == '?' && worktree == '?' {
            untracked.push(entry);
        } else if index == 'U' || worktree == 'U' || (index == 'A' && worktree == 'A') {
            conflicted.push(entry);
        } else {
            if index != ' ' {
                staged.push(entry.clone());
            }
            if worktree != ' ' {
                unstaged.push(entry);
            }
        }
    }
    (branch, staged, unstaged, untracked, conflicted)
}

fn parse_branch_header(header: &str) -> GitBranchSummary {
    let branch = header.strip_prefix("## ").unwrap_or_default();
    let (branch_and_upstream, status) = branch.split_once(" [").unwrap_or((branch, ""));
    let (head, upstream) = branch_and_upstream
        .split_once("...")
        .map(|(head, upstream)| (Some(head.to_owned()), Some(upstream.to_owned())))
        .unwrap_or_else(|| {
            let head = branch_and_upstream
                .strip_prefix("No commits yet on ")
                .or_else(|| branch_and_upstream.strip_prefix("Initial commit on "))
                .unwrap_or(branch_and_upstream);
            (Some(head.to_owned()), None)
        });
    let detached = head.as_deref() == Some("HEAD (no branch)") || head.as_deref() == Some("HEAD");
    let mut ahead = 0;
    let mut behind = 0;
    for part in status.trim_end_matches(']').split(',') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        }
        if let Some(value) = part.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }
    GitBranchSummary {
        head,
        upstream,
        ahead,
        behind,
        detached,
    }
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
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestRepo(PathBuf);

    impl TestRepo {
        fn create(name: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "pi-desktop-git-{name}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            run_test_git(&root, ["init"]);
            run_test_git(&root, ["config", "user.email", "test@example.com"]);
            run_test_git(&root, ["config", "user.name", "Pi Desktop Test"]);
            Self(root)
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn run_test_git<const N: usize>(repo: &Path, args: [&str; N]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "git fixture command failed");
    }

    #[test]
    fn parses_status_with_branch_progress_and_rename() {
        let output = b"## main...origin/main [ahead 2, behind 1]\0R  new.txt\0old.txt\0 M changed.txt\0?? new.txt\0UU conflict.txt\0";
        let (branch, staged, unstaged, untracked, conflicted) = parse_status(output);
        assert_eq!(branch.head.as_deref(), Some("main"));
        assert_eq!(branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!((branch.ahead, branch.behind), (2, 1));
        assert_eq!(staged[0].original_path.as_deref(), Some("old.txt"));
        assert_eq!(unstaged[0].path, "changed.txt");
        assert_eq!(untracked[0].path, "new.txt");
        assert_eq!(conflicted[0].path, "conflict.txt");
    }

    #[test]
    fn validates_paths_branch_names_and_commit_messages() {
        assert_eq!(
            validate_pathspec("../secret").unwrap_err().code,
            "GIT_PATH_INVALID"
        );
        assert_eq!(
            validate_pathspec("C:\\secret").unwrap_err().code,
            "GIT_PATH_INVALID"
        );
        assert_eq!(
            validate_branch_name("bad name").unwrap_err().code,
            "GIT_BRANCH_NAME_INVALID"
        );
        for invalid in ["@", "/main", "feature/.hidden", "feature/main.lock"] {
            assert_eq!(
                validate_branch_name(invalid).unwrap_err().code,
                "GIT_BRANCH_NAME_INVALID"
            );
        }
        assert_eq!(
            validate_commit_message(" ").unwrap_err().code,
            "GIT_COMMIT_MESSAGE_INVALID"
        );
        assert_eq!(validate_paths(&[]).unwrap_err().code, "GIT_PATHS_INVALID");
    }

    #[test]
    fn uses_fixed_git_arguments_without_shell_interpolation() {
        let command = git_command(
            Path::new("C:\\repo"),
            extend_args(["add", "--"], vec![OsString::from("file name.txt")]),
        );
        assert_eq!(command.get_program(), "git");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                "--literal-pathspecs",
                "-C",
                "C:\\repo",
                "add",
                "--",
                "file name.txt"
            ]
        );
        assert_eq!(
            command
                .get_envs()
                .find(|(name, _)| *name == "GIT_TERMINAL_PROMPT")
                .and_then(|(_, value)| value),
            Some(std::ffi::OsStr::new("0"))
        );
        assert_eq!(
            command
                .get_envs()
                .find(|(name, _)| *name == "GCM_INTERACTIVE")
                .and_then(|(_, value)| value),
            Some(std::ffi::OsStr::new("Never"))
        );
        for name in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_CONFIG_COUNT",
        ] {
            assert_eq!(
                command
                    .get_envs()
                    .find(|(candidate, _)| *candidate == name)
                    .map(|(_, value)| value),
                Some(None),
                "{name} must be removed from the child environment"
            );
        }
    }

    #[test]
    fn selects_a_bounded_timeout_from_the_git_subcommand() {
        assert_eq!(git_timeout(&[OsString::from("status")]), LOCAL_GIT_TIMEOUT);
        assert_eq!(git_timeout(&[OsString::from("diff")]), LOCAL_GIT_TIMEOUT);
        assert_eq!(
            git_timeout(&[OsString::from("commit")]),
            MUTATING_GIT_TIMEOUT
        );
        assert_eq!(git_timeout(&[OsString::from("push")]), MUTATING_GIT_TIMEOUT);
    }

    #[test]
    fn supports_status_diff_stage_commit_and_branch_in_a_fixture_repository() {
        let repo = TestRepo::create("workflow");
        fs::write(repo.0.join("readme.txt"), "first\n").unwrap();
        stage_paths(&repo.0, &["readme.txt".to_owned()]).unwrap();
        commit(&repo.0, "initial commit").unwrap();
        fs::write(repo.0.join("readme.txt"), "second\n").unwrap();

        let status = get_status(&repo.0).unwrap();
        assert!(status.is_repository);
        assert_eq!(status.unstaged[0].path, "readme.txt");
        assert!(
            get_diff(&repo.0, Some("readme.txt"), false, false)
                .unwrap()
                .diff
                .contains("-first")
        );

        stage_paths(&repo.0, &["readme.txt".to_owned()]).unwrap();
        unstage_paths(&repo.0, &["readme.txt".to_owned()]).unwrap();
        create_branch(&repo.0, "feature/right-panel").unwrap();
        assert_eq!(
            get_status(&repo.0).unwrap().branch.unwrap().head.as_deref(),
            Some("feature/right-panel")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_process_tree_uses_kill_on_close_limit_flag() {
        assert_eq!(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 0x0000_2000);
        assert_eq!(JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, 9);
    }

    #[test]
    fn renders_untracked_utf8_text_and_explains_non_text_cases() {
        let repo = TestRepo::create("untracked-diff");
        fs::write(repo.0.join("new.txt"), "first\nsecond\n").unwrap();
        fs::write(repo.0.join("binary.bin"), [0xff_u8, 0x00]).unwrap();
        fs::create_dir_all(repo.0.join("folder")).unwrap();
        fs::write(repo.0.join("folder").join("child.txt"), "child").unwrap();

        assert!(
            get_diff(&repo.0, Some("new.txt"), false, false)
                .unwrap()
                .diff
                .contains("+first")
        );
        assert_eq!(
            get_diff(&repo.0, Some("binary.bin"), false, false)
                .unwrap()
                .diff,
            UNTRACKED_BINARY_DIFF
        );
        assert_eq!(
            get_diff(&repo.0, Some("folder"), false, false)
                .unwrap()
                .diff,
            UNTRACKED_DIRECTORY_DIFF
        );
    }

    #[test]
    fn stops_git_after_the_output_limit_and_deletes_only_selected_untracked_paths() {
        let repo = TestRepo::create("bounded-output");
        let original = (0..45_000)
            .map(|index| format!("old line {index:05}\n"))
            .collect::<String>();
        fs::write(repo.0.join("large.txt"), original).unwrap();
        stage_paths(&repo.0, &["large.txt".to_owned()]).unwrap();
        commit(&repo.0, "large fixture").unwrap();
        let changed = (0..45_000)
            .map(|index| format!("new line {index:05}\n"))
            .collect::<String>();
        fs::write(repo.0.join("large.txt"), changed).unwrap();
        assert_eq!(
            get_diff(&repo.0, Some("large.txt"), false, false)
                .unwrap_err()
                .code,
            "GIT_OUTPUT_TOO_LARGE"
        );

        fs::write(repo.0.join("remove-me.txt"), "temporary").unwrap();
        fs::write(repo.0.join("keep-me.txt"), "keep").unwrap();
        discard_paths(&repo.0, &["remove-me.txt".to_owned()], true).unwrap();
        assert!(!repo.0.join("remove-me.txt").exists());
        assert!(repo.0.join("keep-me.txt").exists());
    }

    #[test]
    fn initializes_a_non_repository_once() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "pi-desktop-git-init-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        assert!(!get_status(&root).unwrap().is_repository);
        init_repository(&root).unwrap();
        assert!(get_status(&root).unwrap().is_repository);
        assert_eq!(
            init_repository(&root).unwrap_err().code,
            "GIT_ALREADY_INITIALIZED"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_repository_roots_outside_the_authorized_workspace() {
        let repo = TestRepo::create("nested-workspace");
        let nested_workspace = repo.0.join("nested");
        fs::create_dir_all(&nested_workspace).unwrap();

        assert_eq!(
            get_status(&nested_workspace).unwrap_err().code,
            "GIT_REPOSITORY_UNAUTHORIZED"
        );
    }
}
