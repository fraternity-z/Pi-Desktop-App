use serde::{Deserialize, Serialize};

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
}
