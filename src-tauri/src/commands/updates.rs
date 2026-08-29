use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;

use crate::error::AppError;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/fraternity-z/Pi-Desktop-App/releases/latest";
const GITHUB_RELEASES_URL: &str = "https://github.com/fraternity-z/Pi-Desktop-App/releases";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub download_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    browser_download_url: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, AppError> {
    let current_version = app.package_info().version.to_string();
    let current = parse_version(&current_version, "当前应用")?;
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("Pi Desktop/{current_version}"))
        .build()
        .map_err(|_| AppError::new("UPDATE_CHECK_FAILED", "无法初始化更新检查网络客户端"))?;

    let response = client
        .get(GITHUB_LATEST_RELEASE_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| {
            AppError::new(
                "UPDATE_CHECK_FAILED",
                "无法连接 GitHub 更新服务，请检查网络连接",
            )
        })?;

    if !response.status().is_success() {
        return Err(AppError::new(
            "UPDATE_CHECK_FAILED",
            format!("GitHub 更新服务返回 HTTP {}", response.status().as_u16()),
        ));
    }

    let release = response.json::<GitHubRelease>().await.map_err(|_| {
        AppError::new(
            "UPDATE_RESPONSE_INVALID",
            "GitHub 更新响应格式无效，请稍后重试",
        )
    })?;
    evaluate_release(&current, release)
}

fn evaluate_release(
    current: &Version,
    release: GitHubRelease,
) -> Result<UpdateCheckResult, AppError> {
    let raw_latest = release
        .tag_name
        .as_deref()
        .ok_or_else(|| AppError::new("UPDATE_VERSION_MISSING", "GitHub 更新响应缺少版本号"))?;
    let latest = parse_version(raw_latest, "GitHub 最新")?;
    let release_url = release
        .html_url
        .as_deref()
        .filter(|url| is_github_release_url(url))
        .unwrap_or(GITHUB_RELEASES_URL)
        .to_owned();
    let download_url = release
        .assets
        .into_iter()
        .filter_map(|asset| asset.browser_download_url)
        .find(|url| is_github_download_url(url));

    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        update_available: latest > *current,
        release_url,
        download_url,
    })
}

fn parse_version(raw: &str, label: &str) -> Result<Version, AppError> {
    let trimmed = raw.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if normalized.is_empty() {
        return Err(AppError::new(
            "UPDATE_VERSION_INVALID",
            format!("{label}版本号为空"),
        ));
    }
    Version::parse(normalized).map_err(|_| {
        AppError::new(
            "UPDATE_VERSION_INVALID",
            format!("{label}版本格式无效：{raw}"),
        )
    })
}

fn is_github_release_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/fraternity-z/Pi-Desktop-App/releases/")
}

fn is_github_download_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/fraternity-z/Pi-Desktop-App/releases/download/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: Option<&str>, html_url: Option<&str>, assets: &[&str]) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.map(str::to_owned),
            html_url: html_url.map(str::to_owned),
            assets: assets
                .iter()
                .map(|url| GitHubAsset {
                    browser_download_url: Some((*url).to_owned()),
                })
                .collect(),
        }
    }

    #[test]
    fn reports_available_update_and_valid_download_asset() {
        let current = parse_version("0.1.2", "当前应用").expect("current version");
        let result = evaluate_release(
            &current,
            release(
                Some("v0.1.3"),
                Some("https://github.com/fraternity-z/Pi-Desktop-App/releases/tag/v0.1.3"),
                &[
                    "https://example.com/unsafe.exe",
                    "https://github.com/fraternity-z/Pi-Desktop-App/releases/download/v0.1.3/Pi.exe",
                ],
            ),
        )
        .expect("release should parse");

        assert_eq!(result.current_version, "0.1.2");
        assert_eq!(result.latest_version, "0.1.3");
        assert!(result.update_available);
        assert_eq!(
            result.release_url,
            "https://github.com/fraternity-z/Pi-Desktop-App/releases/tag/v0.1.3"
        );
        assert_eq!(
            result.download_url.as_deref(),
            Some("https://github.com/fraternity-z/Pi-Desktop-App/releases/download/v0.1.3/Pi.exe")
        );
    }

    #[test]
    fn reports_current_when_versions_match() {
        let current = parse_version("0.1.2", "当前应用").expect("current version");
        let result = evaluate_release(&current, release(Some("0.1.2"), None, &[]))
            .expect("release should parse");

        assert!(!result.update_available);
        assert_eq!(result.latest_version, "0.1.2");
        assert_eq!(result.release_url, GITHUB_RELEASES_URL);
    }

    #[test]
    fn rejects_missing_or_malformed_release_versions() {
        let current = parse_version("0.1.2", "当前应用").expect("current version");
        let missing = evaluate_release(&current, release(None, None, &[])).unwrap_err();
        assert_eq!(missing.code, "UPDATE_VERSION_MISSING");

        let malformed = evaluate_release(&current, release(Some("latest"), None, &[])).unwrap_err();
        assert_eq!(malformed.code, "UPDATE_VERSION_INVALID");
    }

    #[test]
    fn accepts_case_insensitive_v_prefix_and_rejects_invalid_current_version() {
        assert_eq!(
            parse_version(" V1.2.3 ", "版本").unwrap(),
            Version::new(1, 2, 3)
        );
        assert_eq!(
            parse_version("current", "版本").unwrap_err().code,
            "UPDATE_VERSION_INVALID"
        );
    }
}
