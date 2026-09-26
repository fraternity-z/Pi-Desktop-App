use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneralSettings {
    pub schema_version: u16,
    pub relaxed_network: bool,
    pub keep_awake_while_running: bool,
    pub prevent_screen_sleep: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            // Existing installations allow user-configured LAN/model endpoints.
            relaxed_network: true,
            keep_awake_while_running: false,
            prevent_screen_sleep: false,
        }
    }
}

impl GeneralSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != 1 {
            return Err(AppError::new(
                "GENERAL_VERSION_UNSUPPORTED",
                "常规设置版本不兼容",
            ));
        }
        Ok(())
    }
}

pub struct GeneralSettingsStore {
    path: PathBuf,
    settings: Mutex<Result<GeneralSettings, AppError>>,
}

impl GeneralSettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        let path = config_dir.join("general-settings.json");
        let settings = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<GeneralSettings>(&bytes)
                .map_err(|_| AppError::new("GENERAL_READ_FAILED", "常规设置损坏，请重新保存配置"))
                .and_then(|settings| {
                    settings.validate()?;
                    Ok(settings)
                }),
            // Migration from versions without this file preserves their network behavior.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(GeneralSettings::default())
            }
            Err(_) => Err(AppError::new(
                "GENERAL_READ_FAILED",
                "无法读取常规设置，请检查配置目录",
            )),
        };
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub fn state(&self) -> Result<GeneralSettings, AppError> {
        self.settings.lock().map_err(|_| state_error())?.clone()
    }

    pub fn update<T>(
        &self,
        settings: GeneralSettings,
        apply: impl FnOnce(Box<dyn FnOnce() -> Result<(), AppError> + '_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        settings.validate()?;
        let mut current = self.settings.lock().map_err(|_| state_error())?;
        let result = apply(Box::new(|| self.persist(&settings)))?;
        *current = Ok(settings);
        Ok(result)
    }

    fn persist(&self, settings: &GeneralSettings) -> Result<(), AppError> {
        fs::create_dir_all(self.path.parent().ok_or_else(write_error)?)
            .map_err(|_| write_error())?;
        let bytes = serde_json::to_vec_pretty(settings).map_err(|_| write_error())?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|_| write_error())?;
        if fs::rename(&temporary, &self.path).is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(write_error());
        }
        Ok(())
    }
}

fn state_error() -> AppError {
    AppError::new("GENERAL_STATE_UNAVAILABLE", "常规设置锁不可用")
}
fn write_error() -> AppError {
    AppError::new("GENERAL_WRITE_FAILED", "无法保存常规设置，原配置保留")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pi-general-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn migrates_missing_settings_and_persists_all_flags() {
        let path = root();
        let store = GeneralSettingsStore::new(path.clone());
        assert_eq!(store.state().unwrap(), GeneralSettings::default());
        let next = GeneralSettings {
            relaxed_network: false,
            keep_awake_while_running: true,
            prevent_screen_sleep: true,
            ..Default::default()
        };
        store.update(next.clone(), |persist| persist()).unwrap();
        assert_eq!(
            GeneralSettingsStore::new(path.clone()).state().unwrap(),
            next
        );
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn rejects_unknown_versions_and_failed_transactions_without_changing_state() {
        let store = GeneralSettingsStore::new(root());
        let invalid = GeneralSettings {
            schema_version: 2,
            ..Default::default()
        };
        assert_eq!(
            store
                .update::<()>(invalid, |_| panic!("must validate first"))
                .unwrap_err()
                .code,
            "GENERAL_VERSION_UNSUPPORTED"
        );
        let next = GeneralSettings {
            relaxed_network: false,
            ..Default::default()
        };
        let result: Result<(), _> =
            store.update(next, |_| Err(AppError::new("FIXTURE", "fixture")));
        assert!(result.is_err());
        assert_eq!(store.state().unwrap(), GeneralSettings::default());
    }
    #[test]
    fn corrupt_config_is_not_silently_loaded_and_can_be_repaired() {
        let path = root();
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("general-settings.json"),
            br#"{"schemaVersion":1,"relaxedNetwork":"yes"}"#,
        )
        .unwrap();
        let store = GeneralSettingsStore::new(path.clone());
        assert_eq!(store.state().unwrap_err().code, "GENERAL_READ_FAILED");
        store
            .update(GeneralSettings::default(), |persist| persist())
            .unwrap();
        assert!(store.state().is_ok());
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn write_failure_preserves_previous_settings() {
        let path = root();
        fs::write(&path, b"fixture").unwrap();
        let store = GeneralSettingsStore::new(path.clone());
        let next = GeneralSettings {
            prevent_screen_sleep: true,
            ..Default::default()
        };
        let previous = store.state();
        assert_eq!(
            store.update(next, |persist| persist()).unwrap_err().code,
            "GENERAL_WRITE_FAILED"
        );
        assert_eq!(store.state(), previous);
        fs::remove_file(path).unwrap();
    }
}
