use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use crate::error::AppError;

const PI_PACKAGE_NAME: &str = "@earendil-works/pi-coding-agent";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeSource {
    ExplicitPaths,
    ExplicitPiCommand,
    PathPiCommand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePaths {
    pub node_path: PathBuf,
    pub sdk_root: PathBuf,
    pub pi_command: Option<PathBuf>,
    pub source: RuntimeSource,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuntimeDiscoveryOptions {
    pub node_path: Option<PathBuf>,
    pub sdk_root: Option<PathBuf>,
    pub pi_command: Option<PathBuf>,
}

pub trait DiscoveryEnvironment {
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf>;
    fn is_file(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn read_to_string(&self, path: &Path) -> std::io::Result<String>;
    fn path_entries(&self) -> Vec<PathBuf>;
}

pub struct SystemDiscoveryEnvironment;

impl DiscoveryEnvironment for SystemDiscoveryEnvironment {
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        fs::canonicalize(path)
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
        fs::read_to_string(path)
    }

    fn path_entries(&self) -> Vec<PathBuf> {
        env::var_os("PATH")
            .map(|value| env::split_paths(&value).collect())
            .unwrap_or_default()
    }
}

#[derive(Deserialize)]
struct PackageMetadata {
    name: String,
    version: String,
}

pub fn discover_runtime(options: &RuntimeDiscoveryOptions) -> Result<RuntimePaths, AppError> {
    discover_runtime_with(options, &SystemDiscoveryEnvironment)
}

pub fn discover_runtime_with(
    options: &RuntimeDiscoveryOptions,
    environment: &dyn DiscoveryEnvironment,
) -> Result<RuntimePaths, AppError> {
    match (&options.node_path, &options.sdk_root) {
        (Some(node_path), Some(sdk_root)) => {
            return validate_runtime_paths(
                node_path,
                sdk_root,
                None,
                RuntimeSource::ExplicitPaths,
                environment,
            );
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::new(
                "RUNTIME_CONFIGURATION_INCOMPLETE",
                "显式运行时配置必须同时提供 nodePath 和 sdkPath",
            ));
        }
        (None, None) => {}
    }

    if let Some(pi_command) = &options.pi_command {
        return discover_from_pi_command(pi_command, RuntimeSource::ExplicitPiCommand, environment);
    }

    let mut visited = HashSet::new();
    for directory in environment.path_entries() {
        if !directory.is_absolute() {
            continue;
        }
        for command_name in pi_command_names() {
            let candidate = directory.join(command_name);
            if !environment.is_file(&candidate) || !visited.insert(candidate.clone()) {
                continue;
            }
            if let Ok(runtime) =
                discover_from_pi_command(&candidate, RuntimeSource::PathPiCommand, environment)
            {
                return Ok(runtime);
            }
        }
    }

    Err(AppError::new(
        "RUNTIME_NOT_FOUND",
        "未找到可用的官方 Pi 运行时；请安装 Pi 或显式配置运行时路径",
    ))
}

fn discover_from_pi_command(
    pi_command: &Path,
    source: RuntimeSource,
    environment: &dyn DiscoveryEnvironment,
) -> Result<RuntimePaths, AppError> {
    let pi_command = canonicalize_file(
        pi_command,
        "PI_COMMAND_INVALID",
        "Pi 命令必须是存在的绝对文件路径",
        environment,
    )?;
    let install_root = pi_command
        .parent()
        .ok_or_else(|| AppError::new("PI_COMMAND_INVALID", "无法从 Pi 命令推导安装目录"))?;

    let node_path = find_node_executable(install_root, environment).ok_or_else(|| {
        AppError::new(
            "NODE_NOT_FOUND",
            "未在 Pi 安装目录或 PATH 中找到 Node.js 可执行文件",
        )
    })?;
    let sdk_root = install_root
        .join("node_modules")
        .join("@earendil-works")
        .join("pi-coding-agent");

    validate_runtime_paths(&node_path, &sdk_root, Some(pi_command), source, environment)
}

fn find_node_executable(
    install_root: &Path,
    environment: &dyn DiscoveryEnvironment,
) -> Option<PathBuf> {
    executable_names("node")
        .iter()
        .map(|name| install_root.join(name))
        .chain(
            environment
                .path_entries()
                .into_iter()
                .filter(|directory| directory.is_absolute())
                .flat_map(|directory| {
                    executable_names("node")
                        .into_iter()
                        .map(move |name| directory.join(name))
                }),
        )
        .find(|path| environment.is_file(path))
}

fn validate_runtime_paths(
    node_path: &Path,
    sdk_root: &Path,
    pi_command: Option<PathBuf>,
    source: RuntimeSource,
    environment: &dyn DiscoveryEnvironment,
) -> Result<RuntimePaths, AppError> {
    let node_path = canonicalize_file(
        node_path,
        "NODE_PATH_INVALID",
        "Node.js 路径必须是存在的绝对文件路径",
        environment,
    )?;
    let sdk_root = canonicalize_dir(
        sdk_root,
        "SDK_PATH_INVALID",
        "Pi SDK 路径必须是存在的绝对目录",
        environment,
    )?;

    validate_sdk_layout(&sdk_root, environment)?;

    Ok(RuntimePaths {
        node_path,
        sdk_root,
        pi_command,
        source,
    })
}

fn validate_sdk_layout(
    sdk_root: &Path,
    environment: &dyn DiscoveryEnvironment,
) -> Result<(), AppError> {
    let package_path = sdk_root.join("package.json");
    if !environment.is_file(&package_path) {
        return Err(AppError::new(
            "SDK_LAYOUT_INVALID",
            "Pi SDK 缺少 package.json",
        ));
    }
    let package_json = environment
        .read_to_string(&package_path)
        .map_err(|_| AppError::new("SDK_LAYOUT_INVALID", "无法读取 Pi SDK package.json"))?;
    let metadata: PackageMetadata = serde_json::from_str(&package_json)
        .map_err(|_| AppError::new("SDK_METADATA_INVALID", "Pi SDK package.json 格式无效"))?;
    if metadata.name != PI_PACKAGE_NAME {
        return Err(AppError::new(
            "SDK_IDENTITY_MISMATCH",
            "SDK 包身份不是官方 Pi Coding Agent",
        ));
    }
    if metadata.version.trim().is_empty() {
        return Err(AppError::new(
            "SDK_METADATA_INVALID",
            "Pi SDK package.json 缺少版本号",
        ));
    }

    let entry_path = sdk_root.join("dist").join("index.js");
    let entry_path = canonicalize_file(
        &entry_path,
        "SDK_LAYOUT_INVALID",
        "Pi SDK 缺少 dist/index.js",
        environment,
    )?;
    if !entry_path.starts_with(sdk_root) {
        return Err(AppError::new(
            "SDK_ENTRY_OUTSIDE_ROOT",
            "Pi SDK 入口不在 SDK 根目录内",
        ));
    }

    Ok(())
}

fn canonicalize_file(
    path: &Path,
    code: &'static str,
    message: &'static str,
    environment: &dyn DiscoveryEnvironment,
) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(code, message));
    }
    let canonical = environment
        .canonicalize(path)
        .map_err(|_| AppError::new(code, message))?;
    if !environment.is_file(&canonical) {
        return Err(AppError::new(code, message));
    }
    Ok(canonical)
}

fn canonicalize_dir(
    path: &Path,
    code: &'static str,
    message: &'static str,
    environment: &dyn DiscoveryEnvironment,
) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(code, message));
    }
    let canonical = environment
        .canonicalize(path)
        .map_err(|_| AppError::new(code, message))?;
    if !environment.is_dir(&canonical) {
        return Err(AppError::new(code, message));
    }
    Ok(canonical)
}

#[cfg(windows)]
fn executable_names(base: &str) -> [String; 2] {
    [format!("{base}.exe"), base.to_owned()]
}

#[cfg(not(windows))]
fn executable_names(base: &str) -> [String; 2] {
    [base.to_owned(), format!("{base}.exe")]
}

#[cfg(windows)]
fn pi_command_names() -> [&'static str; 3] {
    ["pi.exe", "pi.cmd", "pi"]
}

#[cfg(not(windows))]
fn pi_command_names() -> [&'static str; 3] {
    ["pi", "pi.exe", "pi.cmd"]
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, io};

    use super::*;

    #[derive(Default)]
    struct MockEnvironment {
        files: HashSet<PathBuf>,
        directories: HashSet<PathBuf>,
        contents: HashMap<PathBuf, String>,
        canonical_paths: HashMap<PathBuf, PathBuf>,
        path_entries: Vec<PathBuf>,
    }

    impl DiscoveryEnvironment for MockEnvironment {
        fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
            self.canonical_paths
                .get(path)
                .cloned()
                .or_else(|| {
                    (self.files.contains(path) || self.directories.contains(path))
                        .then(|| path.to_path_buf())
                })
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing fixture"))
        }

        fn is_file(&self, path: &Path) -> bool {
            self.files.contains(path)
        }

        fn is_dir(&self, path: &Path) -> bool {
            self.directories.contains(path)
        }

        fn read_to_string(&self, path: &Path) -> io::Result<String> {
            self.contents
                .get(path)
                .cloned()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing fixture"))
        }

        fn path_entries(&self) -> Vec<PathBuf> {
            self.path_entries.clone()
        }
    }

    fn absolute(parts: &[&str]) -> PathBuf {
        let mut path = if cfg!(windows) {
            PathBuf::from(r"C:\")
        } else {
            PathBuf::from("/")
        };
        path.extend(parts);
        path
    }

    fn valid_environment(root: &Path) -> MockEnvironment {
        let node_path = root.join(&executable_names("node")[0]);
        let sdk_root = root
            .join("node_modules")
            .join("@earendil-works")
            .join("pi-coding-agent");
        let package_path = sdk_root.join("package.json");
        let entry_path = sdk_root.join("dist").join("index.js");
        MockEnvironment {
            files: HashSet::from([node_path, package_path.clone(), entry_path]),
            directories: HashSet::from([sdk_root]),
            contents: HashMap::from([(
                package_path,
                r#"{"name":"@earendil-works/pi-coding-agent","version":"0.84.2"}"#.to_owned(),
            )]),
            ..Default::default()
        }
    }

    #[test]
    fn accepts_explicit_node_and_sdk_paths() {
        let root = absolute(&["pi"]);
        let environment = valid_environment(&root);
        let sdk_root = root
            .join("node_modules")
            .join("@earendil-works")
            .join("pi-coding-agent");
        let options = RuntimeDiscoveryOptions {
            node_path: Some(root.join(&executable_names("node")[0])),
            sdk_root: Some(sdk_root.clone()),
            pi_command: None,
        };

        let result = discover_runtime_with(&options, &environment).expect("显式路径应通过校验");

        assert_eq!(result.sdk_root, sdk_root);
        assert_eq!(result.source, RuntimeSource::ExplicitPaths);
    }

    #[test]
    fn rejects_incomplete_explicit_configuration() {
        let options = RuntimeDiscoveryOptions {
            node_path: Some(absolute(&["pi", &executable_names("node")[0]])),
            ..Default::default()
        };

        let error = discover_runtime_with(&options, &MockEnvironment::default())
            .expect_err("只配置 Node 时必须失败");

        assert_eq!(error.code, "RUNTIME_CONFIGURATION_INCOMPLETE");
    }

    #[test]
    fn derives_runtime_from_explicit_pi_command() {
        let root = absolute(&["pi"]);
        let pi_command = root.join(pi_command_names()[1]);
        let mut environment = valid_environment(&root);
        environment.files.insert(pi_command.clone());
        let options = RuntimeDiscoveryOptions {
            pi_command: Some(pi_command.clone()),
            ..Default::default()
        };

        let result =
            discover_runtime_with(&options, &environment).expect("应从显式 Pi 命令推导运行时");

        assert_eq!(result.pi_command, Some(pi_command));
        assert_eq!(result.source, RuntimeSource::ExplicitPiCommand);
    }

    #[test]
    fn derives_runtime_when_node_is_elsewhere_on_path() {
        let pi_root = absolute(&["npm"]);
        let node_root = absolute(&["nodejs"]);
        let pi_command = pi_root.join(pi_command_names()[1]);
        let local_node = pi_root.join(&executable_names("node")[0]);
        let path_node = node_root.join(&executable_names("node")[0]);
        let mut environment = valid_environment(&pi_root);
        environment.files.remove(&local_node);
        environment.files.extend([pi_command.clone(), path_node.clone()]);
        environment.path_entries = vec![node_root];
        let options = RuntimeDiscoveryOptions {
            pi_command: Some(pi_command),
            ..Default::default()
        };

        let result = discover_runtime_with(&options, &environment)
            .expect("Pi 与 Node 位于不同 PATH 目录时也应成功发现运行时");

        assert_eq!(result.node_path, path_node);
    }

    #[test]
    fn skips_invalid_path_candidate_and_uses_valid_installation() {
        let broken_root = absolute(&["broken"]);
        let valid_root = absolute(&["pi"]);
        let broken_pi = broken_root.join(pi_command_names()[0]);
        let valid_pi = valid_root.join(pi_command_names()[0]);
        let mut environment = valid_environment(&valid_root);
        environment.files.extend([broken_pi, valid_pi.clone()]);
        environment.path_entries = vec![broken_root, valid_root];

        let result = discover_runtime_with(&RuntimeDiscoveryOptions::default(), &environment)
            .expect("应跳过损坏的 PATH 候选");

        assert_eq!(result.pi_command, Some(valid_pi));
        assert_eq!(result.source, RuntimeSource::PathPiCommand);
    }

    #[test]
    fn rejects_non_official_sdk_identity() {
        let root = absolute(&["pi"]);
        let mut environment = valid_environment(&root);
        let sdk_root = root
            .join("node_modules")
            .join("@earendil-works")
            .join("pi-coding-agent");
        environment.contents.insert(
            sdk_root.join("package.json"),
            r#"{"name":"other","version":"1.0.0"}"#.to_owned(),
        );
        let options = RuntimeDiscoveryOptions {
            node_path: Some(root.join(&executable_names("node")[0])),
            sdk_root: Some(sdk_root),
            pi_command: None,
        };

        let error =
            discover_runtime_with(&options, &environment).expect_err("非官方 SDK 包必须被拒绝");

        assert_eq!(error.code, "SDK_IDENTITY_MISMATCH");
    }

    #[test]
    fn rejects_sdk_entry_that_escapes_root() {
        let root = absolute(&["pi"]);
        let mut environment = valid_environment(&root);
        let sdk_root = root
            .join("node_modules")
            .join("@earendil-works")
            .join("pi-coding-agent");
        let entry_path = sdk_root.join("dist").join("index.js");
        let outside = absolute(&["outside", "index.js"]);
        environment.files.insert(outside.clone());
        environment.canonical_paths.insert(entry_path, outside);
        let options = RuntimeDiscoveryOptions {
            node_path: Some(root.join(&executable_names("node")[0])),
            sdk_root: Some(sdk_root),
            pi_command: None,
        };

        let error =
            discover_runtime_with(&options, &environment).expect_err("SDK 入口逃逸时必须失败");

        assert_eq!(error.code, "SDK_ENTRY_OUTSIDE_ROOT");
    }

    #[test]
    fn reports_not_found_without_candidates() {
        let error = discover_runtime_with(
            &RuntimeDiscoveryOptions::default(),
            &MockEnvironment::default(),
        )
        .expect_err("没有候选时必须失败");

        assert_eq!(error.code, "RUNTIME_NOT_FOUND");
    }
}
