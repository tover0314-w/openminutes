mod storage;

use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFile {
    path: String,
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn load_meetings(app: AppHandle) -> Result<Vec<Value>, String> {
    storage::load_meetings(&storage::database_file_path(&app)?)
}

#[tauri::command]
fn save_meeting(app: AppHandle, meeting: Value) -> Result<(), String> {
    storage::save_meeting(&storage::database_file_path(&app)?, meeting)
}

#[tauri::command]
fn delete_meeting(app: AppHandle, id: String) -> Result<(), String> {
    storage::delete_meeting(&storage::database_file_path(&app)?, &id)
}

#[tauri::command]
fn load_app_settings(app: AppHandle) -> Result<Option<Value>, String> {
    storage::load_app_settings(&storage::database_file_path(&app)?)
}

#[tauri::command]
fn save_app_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    storage::save_app_settings(&storage::database_file_path(&app)?, settings)
}

#[tauri::command]
fn export_meeting_markdown(
    app: AppHandle,
    file_name: String,
    markdown: String,
) -> Result<ExportedFile, String> {
    let documents_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not resolve Documents directory: {error}"))?;
    let export_dir = documents_dir.join("OpenMinutes");
    fs::create_dir_all(&export_dir)
        .map_err(|error| format!("Could not create export directory: {error}"))?;

    let file_stem = sanitize_file_stem(&file_name);
    let path = unique_markdown_path(&export_dir, &file_stem);
    fs::write(&path, markdown)
        .map_err(|error| format!("Could not write Markdown file: {error}"))?;

    Ok(ExportedFile {
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_version,
            load_meetings,
            save_meeting,
            delete_meeting,
            load_app_settings,
            save_app_settings,
            export_meeting_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMinutes")
}

fn sanitize_file_stem(input: &str) -> String {
    let sanitized = input
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '-' || character == '_' {
                character
            } else if character.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['-', '_'])
        .to_string();

    if sanitized.is_empty() {
        "meeting-notes".to_string()
    } else {
        sanitized.chars().take(80).collect()
    }
}

fn unique_markdown_path(export_dir: &Path, file_stem: &str) -> PathBuf {
    let mut candidate = export_dir.join(format!("{file_stem}.md"));

    for index in 2..100 {
        if !candidate.exists() {
            return candidate;
        }
        candidate = export_dir.join(format!("{file_stem}-{index}.md"));
    }

    candidate
}

#[cfg(test)]
mod tests {
    use super::sanitize_file_stem;

    #[test]
    fn sanitizes_export_file_names() {
        assert_eq!(
            sanitize_file_stem("Product Sync / Alex"),
            "Product-Sync-_-Alex"
        );
        assert_eq!(sanitize_file_stem("产品会议"), "产品会议");
        assert_eq!(sanitize_file_stem(""), "meeting-notes");
    }
}
