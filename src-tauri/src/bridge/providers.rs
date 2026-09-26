use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

#[derive(Deserialize, Serialize)]
#[serde(tag = "op", deny_unknown_fields)]
pub enum ProviderRequest {
    #[serde(rename = "provider.list")]
    List {
        #[serde(default)]
        refresh: bool,
    },
    #[serde(rename = "provider.login.start")]
    LoginStart { provider: String },
    #[serde(rename = "provider.login.status")]
    LoginStatus {
        #[serde(rename = "loginId")]
        login_id: String,
    },
    #[serde(rename = "provider.login.cancel")]
    LoginCancel {
        #[serde(rename = "loginId")]
        login_id: String,
    },
    #[serde(rename = "provider.login.reply")]
    LoginReply {
        #[serde(rename = "loginId")]
        login_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        value: String,
    },
    #[serde(rename = "provider.logout")]
    Logout { provider: String },
    #[serde(rename = "provider.model.save")]
    SaveModel { input: ProviderModelInput },
    #[serde(rename = "model.default.set")]
    SetDefault {
        provider: String,
        #[serde(rename = "modelId")]
        model_id: String,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderModelInput {
    pub provider: String,
    pub base_url: String,
    pub api: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    pub model_id: String,
    pub model_name: String,
    pub reasoning: bool,
    pub context_window: u32,
    pub max_tokens: u32,
    pub expected_revision: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    providers: Vec<ProviderSummary>,
    default_model: Option<ModelSelection>,
    revision: String,
    warning: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct ModelSelection {
    provider: String,
    id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSummary {
    id: String,
    name: String,
    oauth: bool,
    connected: bool,
    auth_type: Option<AuthType>,
    stored_credential: bool,
    custom: bool,
    models: Vec<ProviderModel>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum AuthType {
    Oauth,
    ApiKey,
}
#[derive(Deserialize, Serialize)]
struct ProviderModel {
    provider: String,
    id: String,
    name: String,
    reasoning: bool,
    available: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLogin {
    pub id: String,
    provider: String,
    pub status: LoginStatus,
    message: String,
    pub url: Option<String>,
    user_code: Option<String>,
    prompt: Option<LoginPrompt>,
    error_code: Option<String>,
}
#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LoginStatus {
    Pending,
    Success,
    Cancelled,
    Error,
}
#[derive(Deserialize, Serialize)]
struct LoginPrompt {
    id: String,
    #[serde(rename = "type")]
    kind: PromptType,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<Vec<LoginOption>>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum PromptType {
    Text,
    ManualCode,
    Select,
}
#[derive(Deserialize, Serialize)]
struct LoginOption {
    id: String,
    label: String,
}

fn invalid() -> AppError {
    AppError::new(
        "INVALID_PROVIDER_INPUT",
        "提供商设置参数无效，请检查输入后重试",
    )
}
fn text(value: &str, max: usize) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn provider_id(value: &str) -> Result<(), AppError> {
    text(value, 128)?;
    if !value.as_bytes()[0].is_ascii_lowercase() && !value.as_bytes()[0].is_ascii_digit()
        || !value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
        || matches!(value, "constructor" | "prototype" | "__proto__")
    {
        return Err(invalid());
    }
    Ok(())
}

pub fn validated_web_url(value: &str, allow_query: bool) -> Result<String, AppError> {
    text(value, 8192)?;
    let url = reqwest::Url::parse(value).map_err(|_| invalid())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !allow_query && (url.query().is_some() || url.fragment().is_some())
    {
        return Err(invalid());
    }
    Ok(url.to_string())
}

impl ProviderRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        match self {
            Self::List { .. } => Ok(()),
            Self::LoginStart { provider } | Self::Logout { provider } => provider_id(provider),
            Self::LoginStatus { login_id } | Self::LoginCancel { login_id } => text(login_id, 128),
            Self::LoginReply {
                login_id,
                prompt_id,
                value,
            } => {
                text(login_id, 128)?;
                text(prompt_id, 128)?;
                text(value, 8192)
            }
            Self::SetDefault { provider, model_id } => {
                provider_id(provider)?;
                text(model_id, 256)
            }
            Self::SaveModel { input } => {
                provider_id(&input.provider)?;
                text(&input.model_id, 256)?;
                text(&input.model_name, 256)?;
                text(&input.base_url, 2048)?;
                validated_web_url(&input.base_url, false)?;
                if !matches!(
                    input.api.as_str(),
                    "openai-completions"
                        | "openai-responses"
                        | "anthropic-messages"
                        | "google-generative-ai"
                ) || input.max_tokens == 0
                    || input.context_window > 10_000_000
                    || input.max_tokens > input.context_window
                    || input.expected_revision.len() != 64
                    || !input
                        .expected_revision
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                {
                    return Err(invalid());
                }
                if let Some(env) = &input.api_key_env {
                    text(env, 128)?;
                    if !(env.as_bytes()[0].is_ascii_alphabetic() || env.starts_with('_'))
                        || !env.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
                    {
                        return Err(invalid());
                    }
                }
                Ok(())
            }
        }
    }

    pub fn operation(&self) -> &'static str {
        match self {
            Self::List { .. } => "provider.list",
            Self::LoginStart { .. } => "provider.login.start",
            Self::LoginStatus { .. } => "provider.login.status",
            Self::LoginCancel { .. } => "provider.login.cancel",
            Self::LoginReply { .. } => "provider.login.reply",
            Self::Logout { .. } => "provider.logout",
            Self::SaveModel { .. } => "provider.model.save",
            Self::SetDefault { .. } => "model.default.set",
        }
    }

    pub fn fields(&self) -> Result<Value, AppError> {
        self.validate()?;
        let mut value = serde_json::to_value(self).map_err(|_| invalid())?;
        value.as_object_mut().ok_or_else(invalid)?.remove("op");
        Ok(value)
    }

    /// Round-trip through credential-blind DTOs: never forward arbitrary SDK objects.
    pub fn decode(&self, value: Option<Value>) -> Result<Value, AppError> {
        fn decode<T: serde::de::DeserializeOwned + Serialize>(
            value: Option<Value>,
        ) -> Result<Value, AppError> {
            let data: T = serde_json::from_value(value.ok_or_else(invalid)?)
                .map_err(|_| AppError::new("PROVIDER_RESPONSE_INVALID", "Pi 提供商响应格式无效"))?;
            serde_json::to_value(data).map_err(|_| invalid())
        }
        match self {
            Self::List { .. } => decode::<ProviderSnapshot>(value),
            Self::LoginStart { .. }
            | Self::LoginStatus { .. }
            | Self::LoginCancel { .. }
            | Self::LoginReply { .. } => decode::<ProviderLogin>(value),
            _ => Ok(Value::Null),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rejects_unknown_commands_and_secret_input_fields() {
        assert!(
            serde_json::from_value::<ProviderRequest>(json!({"op":"shell","command":"x"})).is_err()
        );
        assert!(serde_json::from_value::<ProviderRequest>(
            json!({"op":"provider.login.start","provider":"openai","apiKey":"test"})
        )
        .is_err());
        for id in ["../x", "__proto__", "A", "", "x\n"] {
            assert!(provider_id(id).is_err());
        }
    }
    #[test]
    fn validates_urls_without_allowing_shell_or_credentials() {
        for url in [
            "javascript:alert(1)",
            "file:///tmp/x",
            "https://user:password@example.com",
            "http://example.com",
            "https://example.com/?api_key=test",
        ] {
            assert!(validated_web_url(url, false).is_err());
        }
        assert!(validated_web_url("https://example.com/oauth?state=test", true).is_ok());
        assert!(validated_web_url("http://127.0.0.1:11434/v1", false).is_ok());
    }
    #[test]
    fn strips_credentials_from_login_responses() {
        let request = ProviderRequest::LoginStatus {
            login_id: "test".into(),
        };
        let response = request.decode(Some(json!({"id":"test","provider":"openai","status":"success","message":"ok","url":null,"userCode":null,"prompt":null,"errorCode":null,"credential":{"access":"secret"}}))).unwrap();
        assert!(response.get("credential").is_none());
        assert!(!response.to_string().contains("secret"));
    }

    #[test]
    fn validates_all_operations_and_serializes_only_payload_fields() {
        for value in [
            json!({"op":"provider.list","refresh":true}),
            json!({"op":"provider.login.start","provider":"openai-codex"}),
            json!({"op":"provider.login.status","loginId":"login-1"}),
            json!({"op":"provider.login.cancel","loginId":"login-1"}),
            json!({"op":"provider.login.reply","loginId":"login-1","promptId":"prompt-1","value":"one-time-code"}),
            json!({"op":"provider.logout","provider":"openai-codex"}),
            json!({"op":"model.default.set","provider":"example","modelId":"model-1"}),
        ] {
            let request: ProviderRequest = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(request.operation(), value["op"].as_str().unwrap());
            let mut expected = value;
            expected.as_object_mut().unwrap().remove("op");
            assert_eq!(request.fields().unwrap(), expected);
        }
        assert!(ProviderRequest::LoginStatus {
            login_id: String::new()
        }
        .validate()
        .is_err());
        assert!(ProviderRequest::LoginReply {
            login_id: "id".into(),
            prompt_id: "p".into(),
            value: "x".repeat(8193)
        }
        .validate()
        .is_err());
    }

    #[test]
    fn validates_custom_model_limits_and_environment_reference() {
        let valid = json!({
            "provider":"example","baseUrl":"https://example.com/v1","api":"openai-completions",
            "apiKeyEnv":"EXAMPLE_API_KEY","modelId":"model","modelName":"Model",
            "reasoning":false,"contextWindow":8192,"maxTokens":1024,"expectedRevision":"a".repeat(64)
        });
        let parse = |input: Value| {
            serde_json::from_value::<ProviderRequest>(
                json!({"op":"provider.model.save","input":input}),
            )
            .unwrap()
        };
        let request = parse(valid.clone());
        assert_eq!(request.operation(), "provider.model.save");
        assert_eq!(request.fields().unwrap(), json!({"input":valid}));
        assert_eq!(
            request
                .decode(Some(json!({"credential":"not-returned"})))
                .unwrap(),
            Value::Null
        );
        for (key, value) in [
            ("provider", json!("../escape")),
            ("baseUrl", json!("https://user:pass@example.com")),
            ("api", json!("arbitrary-api")),
            ("maxTokens", json!(0)),
            ("maxTokens", json!(9000)),
            ("contextWindow", json!(10_000_001)),
            ("modelName", json!("")),
            ("expectedRevision", json!("stale")),
            ("expectedRevision", json!("g".repeat(64))),
            ("apiKeyEnv", json!("!command")),
            ("apiKeyEnv", json!("sk-fixture")),
            ("apiKeyEnv", json!("9INVALID")),
            ("apiKeyEnv", json!("")),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value;
            assert!(
                parse(invalid).validate().is_err(),
                "field {key} should be rejected"
            );
        }
        let mut no_env = valid;
        no_env.as_object_mut().unwrap().remove("apiKeyEnv");
        assert!(parse(no_env).fields().unwrap()["input"]
            .get("apiKeyEnv")
            .is_none());
    }

    #[test]
    fn strips_secrets_from_catalog_and_rejects_malformed_responses() {
        let request = ProviderRequest::List { refresh: false };
        let response = request.decode(Some(json!({
            "revision":"revision","defaultModel":{"provider":"example","id":"model"},"warning":null,
            "providers":[{"id":"example","name":"Example","oauth":true,"connected":true,
                "authType":"oauth","storedCredential":true,"custom":false,"apiKey":"secret-value",
                "models":[{"provider":"example","id":"model","name":"Model","reasoning":false,"available":true,"headers":{"Authorization":"secret-value"}}]}]
        }))).unwrap();
        assert!(!response.to_string().contains("secret-value"));
        assert!(request.decode(None).is_err());
        assert!(request
            .decode(Some(json!({"providers":"invalid"})))
            .is_err());
        assert!(ProviderRequest::LoginStatus {
            login_id: "id".into()
        }
        .decode(Some(json!({"status":"unexpected"})))
        .is_err());
        assert!(validated_web_url("http://[::1]:11434/v1", false).is_ok());
        assert!(validated_web_url("https://example.com/#fragment", false).is_err());
    }
}
