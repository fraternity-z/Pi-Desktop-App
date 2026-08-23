use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::{
    bridge::{protocol::RequestHeaderSettings, supervisor::normalize_process_path},
    error::AppError,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u16,
    pub runtime_mode: String,
    pub node_path: Option<String>,
    pub sdk_path: Option<String>,
    pub pi_command: Option<String>,
    pub agent_dir: String,
    pub supported_sdk_range: String,
    pub telemetry: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            runtime_mode: "system".to_owned(),
            node_path: None,
            sdk_path: None,
            pi_command: None,
            agent_dir: "~/.pi/agent".to_owned(),
            supported_sdk_range: ">=0.83 <0.86".to_owned(),
            telemetry: false,
        }
    }
}

const WORKSPACE_SCHEMA_VERSION: u16 = 1;
const REQUEST_HEADER_SETTINGS_SCHEMA_VERSION: u16 = 1;
const MAX_RECENT_WORKSPACES: usize = 12;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreferences {
    schema_version: u16,
    recent_workspaces: Vec<String>,
    last_workspace: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub recent_workspaces: Vec<String>,
    pub last_workspace: Option<String>,
    pub conversation_home: String,
}

pub struct WorkspaceStore {
    settings_path: PathBuf,
    conversation_home: PathBuf,
    preferences: Mutex<WorkspacePreferences>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestHeaderPreferences {
    schema_version: u16,
    #[serde(flatten)]
    settings: RequestHeaderSettings,
}

pub struct RequestHeaderSettingsStore {
    settings_path: PathBuf,
    settings: Mutex<RequestHeaderSettings>,
}

impl RequestHeaderSettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        let settings_path = config_dir.join("request-header-settings.json");
        let settings = read_request_header_settings(&settings_path);
        Self {
            settings_path,
            settings: Mutex::new(settings),
        }
    }

    pub fn state(&self) -> RequestHeaderSettings {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn update(
        &self,
        settings: RequestHeaderSettings,
    ) -> Result<RequestHeaderSettings, AppError> {
        let mut current = self.settings.lock().map_err(|_| {
            AppError::new(
                "REQUEST_HEADER_SETTINGS_STATE_POISONED",
                "请求头客户端设置锁不可用",
            )
        })?;
        self.persist(&settings)?;
        *current = settings.clone();
        Ok(settings)
    }

    fn persist(&self, settings: &RequestHeaderSettings) -> Result<(), AppError> {
        let parent = self.settings_path.parent().ok_or_else(|| {
            AppError::new(
                "REQUEST_HEADER_SETTINGS_PATH_INVALID",
                "请求头客户端设置路径无效",
            )
        })?;
        fs::create_dir_all(parent).map_err(|_| {
            AppError::new(
                "REQUEST_HEADER_SETTINGS_WRITE_FAILED",
                "无法创建应用配置目录",
            )
        })?;
        let preferences = RequestHeaderPreferences {
            schema_version: REQUEST_HEADER_SETTINGS_SCHEMA_VERSION,
            settings: settings.clone(),
        };
        let payload = serde_json::to_vec_pretty(&preferences).map_err(|_| {
            AppError::new(
                "REQUEST_HEADER_SETTINGS_WRITE_FAILED",
                "无法序列化请求头客户端设置",
            )
        })?;
        fs::write(&self.settings_path, payload).map_err(|_| {
            AppError::new(
                "REQUEST_HEADER_SETTINGS_WRITE_FAILED",
                "无法保存请求头客户端设置",
            )
        })
    }
}

impl WorkspaceStore {
    pub fn new(config_dir: PathBuf, documents_dir: PathBuf) -> Self {
        let settings_path = config_dir.join("workspace-settings.json");
        let conversation_home = documents_dir.join("Pix").join("conversations");
        let preferences = read_workspace_preferences(&settings_path);
        Self {
            settings_path,
            conversation_home,
            preferences: Mutex::new(preferences),
        }
    }

    pub fn state(&self) -> WorkspaceState {
        let preferences = self
            .preferences
            .lock()
            .map(|preferences| preferences.clone())
            .unwrap_or_default();
        WorkspaceState {
            recent_workspaces: preferences.recent_workspaces,
            last_workspace: preferences.last_workspace,
            conversation_home: path_text(&self.conversation_home),
        }
    }

    pub fn remember(&self, cwd: &str) -> Result<WorkspaceState, AppError> {
        let canonical = canonical_workspace(Path::new(cwd.trim()))?;
        let canonical_text = path_text(&canonical);
        let conversation_home = path_text(&normalize_process_path(
            self.conversation_home
                .canonicalize()
                .unwrap_or_else(|_| self.conversation_home.clone()),
        ));
        let mut preferences = self.lock_preferences()?;
        preferences.last_workspace = Some(canonical_text.clone());
        if !same_path(&canonical_text, &conversation_home) {
            preferences
                .recent_workspaces
                .retain(|item| !same_path(item, &canonical_text) && Path::new(item).is_dir());
            preferences.recent_workspaces.insert(0, canonical_text);
            preferences
                .recent_workspaces
                .truncate(MAX_RECENT_WORKSPACES);
        }
        self.persist(&preferences)?;
        Ok(state_from(&preferences, &self.conversation_home))
    }

    pub fn remove_recent(&self, cwd: &str) -> Result<WorkspaceState, AppError> {
        let mut preferences = self.lock_preferences()?;
        preferences
            .recent_workspaces
            .retain(|item| !same_path(item, cwd));
        if preferences
            .last_workspace
            .as_deref()
            .is_some_and(|item| same_path(item, cwd))
        {
            preferences.last_workspace = None;
        }
        self.persist(&preferences)?;
        Ok(state_from(&preferences, &self.conversation_home))
    }

    pub fn ensure_conversation(&self) -> Result<String, AppError> {
        fs::create_dir_all(&self.conversation_home).map_err(|_| {
            AppError::new(
                "CONVERSATION_HOME_CREATE_FAILED",
                "无法创建 Documents/Pix/conversations 会话目录",
            )
        })?;
        let canonical =
            normalize_process_path(self.conversation_home.canonicalize().map_err(|_| {
                AppError::new(
                    "CONVERSATION_HOME_INVALID",
                    "无法解析 Documents/Pix/conversations 会话目录",
                )
            })?);
        let canonical_text = path_text(&canonical);
        let mut preferences = self.lock_preferences()?;
        preferences.last_workspace = Some(canonical_text.clone());
        preferences
            .recent_workspaces
            .retain(|item| !same_path(item, &canonical_text) && Path::new(item).is_dir());
        self.persist(&preferences)?;
        Ok(canonical_text)
    }

    fn lock_preferences(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, WorkspacePreferences>, AppError> {
        self.preferences
            .lock()
            .map_err(|_| AppError::new("WORKSPACE_STATE_POISONED", "工作区偏好状态锁不可用"))
    }

    fn persist(&self, preferences: &WorkspacePreferences) -> Result<(), AppError> {
        let parent = self.settings_path.parent().ok_or_else(|| {
            AppError::new("WORKSPACE_SETTINGS_PATH_INVALID", "工作区偏好路径无效")
        })?;
        fs::create_dir_all(parent).map_err(|_| {
            AppError::new("WORKSPACE_SETTINGS_WRITE_FAILED", "无法创建应用配置目录")
        })?;
        let payload = serde_json::to_vec_pretty(preferences).map_err(|_| {
            AppError::new("WORKSPACE_SETTINGS_WRITE_FAILED", "无法序列化工作区偏好")
        })?;
        fs::write(&self.settings_path, payload)
            .map_err(|_| AppError::new("WORKSPACE_SETTINGS_WRITE_FAILED", "无法保存工作区偏好"))
    }
}

fn read_workspace_preferences(path: &Path) -> WorkspacePreferences {
    let mut preferences = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WorkspacePreferences>(&bytes).ok())
        .filter(|preferences| preferences.schema_version == WORKSPACE_SCHEMA_VERSION)
        .unwrap_or_else(|| WorkspacePreferences {
            schema_version: WORKSPACE_SCHEMA_VERSION,
            ..WorkspacePreferences::default()
        });
    preferences
        .recent_workspaces
        .retain(|item| Path::new(item).is_dir());
    preferences
        .recent_workspaces
        .truncate(MAX_RECENT_WORKSPACES);
    if preferences
        .last_workspace
        .as_deref()
        .is_some_and(|item| !Path::new(item).is_dir())
    {
        preferences.last_workspace = None;
    }
    preferences
}

fn read_request_header_settings(path: &Path) -> RequestHeaderSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RequestHeaderPreferences>(&bytes).ok())
        .filter(|preferences| preferences.schema_version == REQUEST_HEADER_SETTINGS_SCHEMA_VERSION)
        .map(|preferences| preferences.settings)
        .unwrap_or_default()
}

fn state_from(preferences: &WorkspacePreferences, conversation_home: &Path) -> WorkspaceState {
    WorkspaceState {
        recent_workspaces: preferences.recent_workspaces.clone(),
        last_workspace: preferences.last_workspace.clone(),
        conversation_home: path_text(conversation_home),
    }
}

fn canonical_workspace(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "WORKSPACE_PATH_INVALID",
            "工作区路径必须是存在的绝对目录",
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::new("WORKSPACE_PATH_INVALID", "工作区路径不存在或无法访问"))?;
    if !canonical.is_dir() {
        return Err(AppError::new(
            "WORKSPACE_PATH_INVALID",
            "工作区路径必须是目录",
        ));
    }
    Ok(normalize_process_path(canonical))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn same_path(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.trim_end_matches(['\\', '/'])
            .eq_ignore_ascii_case(right.trim_end_matches(['\\', '/']))
    }
    #[cfg(not(windows))]
    {
        left.trim_end_matches('/').eq(right.trim_end_matches('/'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_user_managed_runtime_without_telemetry() {
        let settings = AppSettings::default();

        assert_eq!(settings.schema_version, 1);
        assert_eq!(settings.runtime_mode, "system");
        assert_eq!(settings.agent_dir, "~/.pi/agent");
        assert!(!settings.telemetry);
    }

    #[test]
    fn persists_recent_workspaces_without_listing_conversation_home() {
        let root =
            std::env::temp_dir().join(format!("pi-desktop-workspace-test-{}", std::process::id()));
        let config = root.join("config");
        let documents = root.join("documents");
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let store = WorkspaceStore::new(config.clone(), documents.clone());

        let remembered = store.remember(&path_text(&project)).unwrap();
        assert_eq!(remembered.recent_workspaces.len(), 1);
        let conversation = store.ensure_conversation().unwrap();
        assert!(
            conversation.ends_with("Pix\\conversations")
                || conversation.ends_with("Pix/conversations")
        );
        assert_eq!(store.state().recent_workspaces.len(), 1);

        let reloaded = WorkspaceStore::new(config, documents);
        assert_eq!(reloaded.state().recent_workspaces.len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persists_versioned_request_header_settings_and_defaults_safely() {
        let root = std::env::temp_dir().join(format!(
            "pi-desktop-request-header-test-{}",
            std::process::id()
        ));
        let settings = RequestHeaderSettings {
            enabled: true,
            client: crate::bridge::protocol::RequestHeaderClient::Codex,
        };
        let store = RequestHeaderSettingsStore::new(root.clone());
        assert_eq!(store.state(), RequestHeaderSettings::default());

        assert_eq!(store.update(settings.clone()), Ok(settings.clone()));
        assert_eq!(
            RequestHeaderSettingsStore::new(root.clone()).state(),
            settings
        );

        fs::write(root.join("request-header-settings.json"), b"{invalid").unwrap();
        assert_eq!(
            RequestHeaderSettingsStore::new(root.clone()).state(),
            RequestHeaderSettings::default()
        );
        let _ = fs::remove_dir_all(root);
    }
}
