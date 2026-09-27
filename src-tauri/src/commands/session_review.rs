use tauri::{AppHandle, Manager};

use crate::{bridge::protocol::SessionReviewRequest, error::AppError, storage::WorkspaceStore};

use super::runtime::run_runtime;

#[tauri::command]
pub async fn agent_review_list(
    app: AppHandle,
    session_id: String,
    cwd: String,
    cursor: Option<String>,
) -> Result<serde_json::Value, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.session_review(
            session_id,
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            SessionReviewRequest::List { cursor },
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_review_detail(
    app: AppHandle,
    session_id: String,
    cwd: String,
    review_id: String,
) -> Result<serde_json::Value, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.session_review(
            session_id,
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            SessionReviewRequest::Detail { review_id },
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_review_rollback(
    app: AppHandle,
    session_id: String,
    cwd: String,
    review_id: String,
) -> Result<serde_json::Value, AppError> {
    run_runtime(app, move |app, runtime| {
        runtime.session_review(
            session_id,
            app.state::<WorkspaceStore>().authorize(&cwd)?,
            SessionReviewRequest::Rollback { review_id },
        )
    })
    .await
}
