mod storage;

use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const KEYCHAIN_SERVICE: &str = "OpenMinutes";
const MAX_AUDIO_IMPORT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedFile {
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAudioFile {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
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
fn has_provider_api_key(provider: String) -> Result<bool, String> {
    match provider_key_entry(&provider)?.get_password() {
        Ok(api_key) => Ok(!api_key.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(error) => Err(format!("Could not read API key status: {error}")),
    }
}

#[tauri::command]
fn load_provider_api_key(provider: String) -> Result<Option<String>, String> {
    match provider_key_entry(&provider)?.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not load API key: {error}")),
    }
}

#[tauri::command]
fn save_provider_api_key(provider: String, api_key: String) -> Result<(), String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    provider_key_entry(&provider)?
        .set_password(trimmed_key)
        .map_err(|error| format!("Could not save API key: {error}"))
}

#[tauri::command]
fn delete_provider_api_key(provider: String) -> Result<(), String> {
    match provider_key_entry(&provider)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete API key: {error}")),
    }
}

#[tauri::command]
fn read_audio_import_file(path: String) -> Result<ImportedAudioFile, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read audio file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("Selected path is not a file".to_string());
    }
    if metadata.len() > MAX_AUDIO_IMPORT_BYTES {
        return Err("Audio import is limited to 100 MB".to_string());
    }

    let bytes = fs::read(&path).map_err(|error| format!("Could not read audio file: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("meeting-audio")
        .to_string();
    let mime_type = audio_mime_type(&path).to_string();

    Ok(ImportedAudioFile {
        file_name,
        mime_type,
        bytes,
    })
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            load_meetings,
            save_meeting,
            delete_meeting,
            load_app_settings,
            save_app_settings,
            has_provider_api_key,
            load_provider_api_key,
            save_provider_api_key,
            delete_provider_api_key,
            read_audio_import_file,
            export_meeting_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMinutes")
}

fn provider_key_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &provider_key_account(provider))
        .map_err(|error| format!("Could not open keychain entry: {error}"))
}

fn provider_key_account(provider: &str) -> String {
    let normalized = provider
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();

    format!("provider:{normalized}")
}

fn audio_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("mp4") => "audio/mp4",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        Some("ogg") => "audio/ogg",
        Some("flac") => "audio/flac",
        _ => "application/octet-stream",
    }
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
    use super::{audio_mime_type, provider_key_account, sanitize_file_stem};
    use std::path::Path;

    #[test]
    fn sanitizes_export_file_names() {
        assert_eq!(
            sanitize_file_stem("Product Sync / Alex"),
            "Product-Sync-_-Alex"
        );
        assert_eq!(sanitize_file_stem("产品会议"), "产品会议");
        assert_eq!(sanitize_file_stem(""), "meeting-notes");
    }

    #[test]
    fn normalizes_keychain_provider_accounts() {
        assert_eq!(
            provider_key_account("openai-compatible"),
            "provider:openai-compatible"
        );
        assert_eq!(
            provider_key_account("bad/provider"),
            "provider:bad_provider"
        );
    }

    #[test]
    fn resolves_audio_mime_types_from_extensions() {
        assert_eq!(audio_mime_type(Path::new("call.wav")), "audio/wav");
        assert_eq!(audio_mime_type(Path::new("call.MP3")), "audio/mpeg");
        assert_eq!(
            audio_mime_type(Path::new("call.unknown")),
            "application/octet-stream"
        );
    }
}
