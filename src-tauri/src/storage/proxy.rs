use std::{fs, path::PathBuf, process::Command, sync::Mutex};

use reqwest::{ClientBuilder, Proxy, Url};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProxyMode {
    #[default]
    System,
    Direct,
    Custom,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProxyEndpoint {
    pub mode: ProxyMode,
    pub url: String,
    pub no_proxy: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProxySettings {
    pub schema_version: u16,
    pub ai: ProxyEndpoint,
    pub app: ProxyEndpoint,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            ai: ProxyEndpoint::default(),
            app: ProxyEndpoint::default(),
        }
    }
}

impl ProxyEndpoint {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.no_proxy.len() > 2048
            || self.no_proxy.chars().any(char::is_control)
            || !self
                .no_proxy
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-_*,:[] ".contains(c))
        {
            return Err(invalid_proxy());
        }
        if self.mode != ProxyMode::Custom {
            return if self.url.is_empty() && self.no_proxy.is_empty() {
                Ok(())
            } else {
                Err(invalid_proxy())
            };
        }
        if self.url.len() > 2048
            || self.url.chars().any(char::is_whitespace)
            || self.url.contains('\\')
        {
            return Err(invalid_proxy());
        }
        let url = Url::parse(&self.url).map_err(|_| invalid_proxy())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || url.port() == Some(0)
        {
            return Err(invalid_proxy());
        }
        Ok(())
    }

    pub fn client_builder(&self) -> Result<ClientBuilder, AppError> {
        self.validate()?;
        let builder = reqwest::Client::builder();
        Ok(match self.mode {
            ProxyMode::System => builder,
            ProxyMode::Direct => builder.no_proxy(),
            ProxyMode::Custom => builder.no_proxy().proxy(
                Proxy::all(&self.url)
                    .map_err(|_| invalid_proxy())?
                    .no_proxy(reqwest::NoProxy::from_string(&self.no_proxy)),
            ),
        })
    }

    /// Only the child process is changed; never mutate the desktop process environment.
    pub fn apply_to_command(&self, command: &mut Command) {
        command.env(
            "PI_DESKTOP_PROXY_MODE",
            match self.mode {
                ProxyMode::System => "system",
                ProxyMode::Direct => "direct",
                ProxyMode::Custom => "custom",
            },
        );
        command.env_remove("PI_DESKTOP_PROXY_URL");
        command.env_remove("PI_DESKTOP_NO_PROXY");
        if self.mode == ProxyMode::System {
            return;
        }
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        ] {
            command.env_remove(key);
        }
        if self.mode == ProxyMode::Custom {
            command
                .env("PI_DESKTOP_PROXY_URL", &self.url)
                .env("PI_DESKTOP_NO_PROXY", &self.no_proxy);
            for key in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
                command.env(key, &self.url);
            }
            for key in ["NO_PROXY", "no_proxy"] {
                command.env(key, &self.no_proxy);
            }
        }
    }
}

impl ProxySettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != 1 {
            return Err(AppError::new(
                "PROXY_VERSION_UNSUPPORTED",
                "代理配置版本不兼容",
            ));
        }
        self.ai.validate()?;
        self.app.validate()?;
        if !self.app.no_proxy.is_empty()
            || self.app.mode == ProxyMode::Custom && !self.app.url.starts_with("http://")
        {
            return Err(AppError::new(
                "APP_PROXY_INVALID",
                "应用代理仅支持无认证的 HTTP 代理地址，暂不支持绕过列表",
            ));
        }
        Ok(())
    }
}

fn invalid_proxy() -> AppError {
    AppError::new(
        "PROXY_INVALID",
        "代理地址须为 http(s)://主机:端口，不能含账号、密码、路径、查询或片段；请检查绕过列表格式",
    )
}

pub struct ProxySettingsStore {
    path: PathBuf,
    settings: Mutex<Result<ProxySettings, AppError>>,
}

impl ProxySettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        let path = config_dir.join("proxy-settings.json");
        let settings = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<ProxySettings>(&bytes)
                .map_err(|_| {
                    AppError::new("PROXY_READ_FAILED", "代理配置无法读取，请重新保存代理设置")
                })
                .and_then(|settings| {
                    settings.validate()?;
                    Ok(settings)
                }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ProxySettings::default())
            }
            Err(_) => Err(AppError::new(
                "PROXY_READ_FAILED",
                "无法读取代理配置，请检查应用配置目录",
            )),
        };
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub fn state(&self) -> Result<ProxySettings, AppError> {
        self.settings.lock().map_err(|_| state_error())?.clone()
    }

    // Keep persistence and the runtime restart reservation in one serialized transaction.
    pub fn update<T>(
        &self,
        settings: ProxySettings,
        apply: impl FnOnce(Box<dyn FnOnce() -> Result<(), AppError> + '_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        settings.validate()?;
        let mut current = self.settings.lock().map_err(|_| state_error())?;
        let result = apply(Box::new(|| self.persist(&settings)))?;
        *current = Ok(settings);
        Ok(result)
    }

    fn persist(&self, settings: &ProxySettings) -> Result<(), AppError> {
        let parent = self.path.parent().ok_or_else(write_error)?;
        fs::create_dir_all(parent).map_err(|_| write_error())?;
        let payload = serde_json::to_vec_pretty(settings).map_err(|_| write_error())?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, payload).map_err(|_| write_error())?;
        if fs::rename(&temporary, &self.path).is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(write_error());
        }
        Ok(())
    }
}

fn state_error() -> AppError {
    AppError::new("PROXY_STATE_UNAVAILABLE", "代理设置锁不可用")
}
fn write_error() -> AppError {
    AppError::new("PROXY_WRITE_FAILED", "无法保存代理配置，原设置保留")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn http_client_routes_through_fixture_proxy_and_direct_mode() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;
        for custom in [true, false] {
            let server = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = server.local_addr().unwrap();
            server.set_nonblocking(true).unwrap();
            let worker = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    if let Ok((stream, _)) = server.accept() {
                        break stream;
                    }
                    assert!(
                        std::time::Instant::now() < deadline,
                        "fixture did not receive request"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut buffer = [0; 2048];
                let count = stream.read(&mut buffer).unwrap();
                let request = String::from_utf8_lossy(&buffer[..count]).into_owned();
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nfixture",
                    )
                    .unwrap();
                request
            });
            let endpoint = ProxyEndpoint {
                mode: if custom {
                    ProxyMode::Custom
                } else {
                    ProxyMode::Direct
                },
                url: if custom {
                    format!("http://{address}")
                } else {
                    String::new()
                },
                no_proxy: String::new(),
            };
            let target = if custom {
                "http://proxy-fixture.invalid/test".to_owned()
            } else {
                format!("http://{address}/test")
            };
            let body = tauri::async_runtime::block_on(async {
                endpoint
                    .client_builder()
                    .unwrap()
                    .timeout(Duration::from_secs(3))
                    .build()
                    .unwrap()
                    .get(target)
                    .send()
                    .await
                    .unwrap()
                    .text()
                    .await
                    .unwrap()
            });
            assert_eq!(body, "fixture");
            let request = worker.join().unwrap();
            assert!(request.starts_with(if custom {
                "GET http://proxy-fixture.invalid/test "
            } else {
                "GET /test "
            }));
        }
    }
    #[test]
    fn rejects_credentials_malformed_urls_versions_and_hidden_values() {
        for url in [
            "",
            "localhost:7890",
            "http://user:pass@localhost:7890",
            "file:///x",
            "http://localhost:0",
            "http://localhost/path",
            "http://localhost?secret=x",
            "http://localhost/#x",
            "http://local\nhost",
        ] {
            let endpoint = ProxyEndpoint {
                mode: ProxyMode::Custom,
                url: url.into(),
                no_proxy: String::new(),
            };
            assert_eq!(endpoint.validate().unwrap_err().code, "PROXY_INVALID");
        }
        let endpoint = ProxyEndpoint {
            mode: ProxyMode::Custom,
            url: "http://[::1]:7890".into(),
            no_proxy: "localhost,*.example.com".into(),
        };
        assert!(endpoint.validate().is_ok());
        assert!(
            ProxySettings {
                schema_version: 2,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            ProxyEndpoint {
                mode: ProxyMode::Direct,
                ..endpoint
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn child_environment_is_explicit_and_direct_removes_inherited_proxies() {
        for mode in [ProxyMode::System, ProxyMode::Custom, ProxyMode::Direct] {
            let mut command = Command::new("node");
            let endpoint = ProxyEndpoint {
                mode,
                url: "http://localhost:7890".into(),
                no_proxy: "localhost".into(),
            };
            endpoint.apply_to_command(&mut command);
            let env: std::collections::HashMap<_, _> = command
                .get_envs()
                .map(|(k, v)| {
                    (
                        k.to_string_lossy().into_owned(),
                        v.map(|v| v.to_string_lossy().into_owned()),
                    )
                })
                .collect();
            if mode == ProxyMode::System {
                assert!(!env.contains_key("HTTP_PROXY"));
            } else {
                assert_eq!(
                    env["HTTP_PROXY"],
                    if mode == ProxyMode::Direct {
                        None
                    } else {
                        Some(endpoint.url)
                    }
                );
            }
            assert!(command.get_args().next().is_none());
        }
    }

    #[test]
    fn persists_reloads_and_preserves_state_on_transaction_failure() {
        let root = std::env::temp_dir().join(format!("pi-proxy-{}", std::process::id()));
        let store = ProxySettingsStore::new(root.clone());
        let settings = ProxySettings {
            ai: ProxyEndpoint {
                mode: ProxyMode::Direct,
                ..Default::default()
            },
            ..Default::default()
        };
        store.update(settings.clone(), |persist| persist()).unwrap();
        assert_eq!(
            ProxySettingsStore::new(root.clone()).state().unwrap(),
            settings
        );
        assert!(
            store
                .update(ProxySettings::default(), |_| Err::<(), _>(state_error()))
                .is_err()
        );
        assert_eq!(store.state().unwrap(), settings);
        fs::write(root.join("proxy-settings.json"), b"invalid").unwrap();
        assert!(ProxySettingsStore::new(root.clone()).state().is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
