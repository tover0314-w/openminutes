use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MEETINGS_FILE_NAME: &str = "meetings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MeetingsEnvelope {
    version: u8,
    saved_at: String,
    meetings: Vec<Value>,
}

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
    read_meetings(&meetings_file_path(&app)?).map(|envelope| envelope.meetings)
}

#[tauri::command]
fn save_meeting(app: AppHandle, meeting: Value) -> Result<(), String> {
    let path = meetings_file_path(&app)?;
    let mut envelope = read_meetings(&path)?;
    let id = meeting_id(&meeting)?;

    if let Some(existing) = envelope
        .meetings
        .iter_mut()
        .find(|saved| saved.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = meeting;
    } else {
        envelope.meetings.insert(0, meeting);
    }

    envelope.saved_at = now_unix_seconds();
    write_meetings(&path, &envelope)
}

#[tauri::command]
fn delete_meeting(app: AppHandle, id: String) -> Result<(), String> {
    let path = meetings_file_path(&app)?;
    let mut envelope = read_meetings(&path)?;
    envelope
        .meetings
        .retain(|meeting| meeting.get("id").and_then(Value::as_str) != Some(id.as_str()));
    envelope.saved_at = now_unix_seconds();
    write_meetings(&path, &envelope)
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
    fs::write(&path, markdown).map_err(|error| format!("Could not write Markdown file: {error}"))?;

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
            export_meeting_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMinutes")
}

fn meetings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(app_dir.join(MEETINGS_FILE_NAME))
}

fn read_meetings(path: &Path) -> Result<MeetingsEnvelope, String> {
    if !path.exists() {
        return Ok(empty_envelope());
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("Could not read meetings: {error}"))?;
    let envelope = match serde_json::from_str::<MeetingsEnvelope>(&raw) {
        Ok(envelope) => envelope,
        Err(_) => return Ok(empty_envelope()),
    };

    if envelope.version != 1 {
        return Ok(empty_envelope());
    }

    Ok(envelope)
}

fn write_meetings(path: &Path, envelope: &MeetingsEnvelope) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create meetings directory: {error}"))?;
    }

    let raw = serde_json::to_string_pretty(envelope)
        .map_err(|error| format!("Could not serialize meetings: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Could not write meetings: {error}"))
}

fn empty_envelope() -> MeetingsEnvelope {
    MeetingsEnvelope {
        version: 1,
        saved_at: String::new(),
        meetings: Vec::new(),
    }
}

fn meeting_id(meeting: &Value) -> Result<&str, String> {
    meeting
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Meeting is missing a non-empty id".to_string())
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

fn now_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{meeting_id, sanitize_file_stem};
    use serde_json::json;

    #[test]
    fn sanitizes_export_file_names() {
        assert_eq!(sanitize_file_stem("Product Sync / Alex"), "Product-Sync-_-Alex");
        assert_eq!(sanitize_file_stem("产品会议"), "产品会议");
        assert_eq!(sanitize_file_stem(""), "meeting-notes");
    }

    #[test]
    fn rejects_meetings_without_ids() {
        assert!(meeting_id(&json!({ "title": "No id" })).is_err());
        assert_eq!(meeting_id(&json!({ "id": "abc" })).unwrap(), "abc");
    }
}
