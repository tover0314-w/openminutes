use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DB_FILE_NAME: &str = "openminutes.sqlite3";
const APP_SETTINGS_KEY: &str = "app_settings";
const CURRENT_SCHEMA_VERSION: i64 = 2;

pub fn database_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(app_dir.join(DB_FILE_NAME))
}

pub fn load_meetings(path: &Path) -> Result<Vec<Value>, String> {
    let connection = open_database(path)?;
    let mut statement = connection
        .prepare("SELECT raw_json FROM meetings ORDER BY updated_at DESC")
        .map_err(|error| format!("Could not prepare meetings query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Could not query meetings: {error}"))?;

    let mut meetings = Vec::new();
    for row in rows {
        let raw = row.map_err(|error| format!("Could not read meeting row: {error}"))?;
        if let Ok(meeting) = serde_json::from_str::<Value>(&raw) {
            meetings.push(meeting);
        }
    }

    Ok(meetings)
}

pub fn save_meeting(path: &Path, meeting: Value) -> Result<(), String> {
    let connection = open_database(path)?;
    let id = meeting_id(&meeting)?.to_string();
    let title =
        meeting_string_field(&meeting, "title").unwrap_or_else(|| "Untitled meeting".to_string());
    let template =
        meeting_string_field(&meeting, "template").unwrap_or_else(|| "General".to_string());
    let status = meeting_string_field(&meeting, "phase").unwrap_or_else(|| "draft".to_string());
    let started_at = meeting_string_field(&meeting, "startedAt");
    let updated_at = now_unix_seconds();
    let raw_json = serde_json::to_string(&meeting)
        .map_err(|error| format!("Could not serialize meeting: {error}"))?;

    connection
        .execute(
            "INSERT INTO meetings (id, title, template, status, started_at, updated_at, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               template = excluded.template,
               status = excluded.status,
               started_at = excluded.started_at,
               updated_at = excluded.updated_at,
               raw_json = excluded.raw_json",
            params![id, title, template, status, started_at, updated_at, raw_json],
        )
        .map_err(|error| format!("Could not save meeting: {error}"))?;

    Ok(())
}

pub fn delete_meeting(path: &Path, id: &str) -> Result<(), String> {
    let connection = open_database(path)?;
    connection
        .execute("DELETE FROM meetings WHERE id = ?1", params![id])
        .map_err(|error| format!("Could not delete meeting: {error}"))?;
    Ok(())
}

pub fn load_app_settings(path: &Path) -> Result<Option<Value>, String> {
    let connection = open_database(path)?;
    let raw = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            params![APP_SETTINGS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not load app settings: {error}"))?;

    match raw {
        Some(raw) => serde_json::from_str::<Value>(&raw)
            .map(Some)
            .map_err(|error| format!("Could not parse app settings: {error}")),
        None => Ok(None),
    }
}

pub fn save_app_settings(path: &Path, settings: Value) -> Result<(), String> {
    let connection = open_database(path)?;
    let raw_json = serde_json::to_string(&settings)
        .map_err(|error| format!("Could not serialize app settings: {error}"))?;

    connection
        .execute(
            "INSERT INTO app_settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at",
            params![APP_SETTINGS_KEY, raw_json, now_unix_seconds()],
        )
        .map_err(|error| format!("Could not save app settings: {error}"))?;

    Ok(())
}

fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create database directory: {error}"))?;
    }

    let connection =
        Connection::open(path).map_err(|error| format!("Could not open database: {error}"))?;
    run_migrations(&connection)?;
    Ok(connection)
}

fn run_migrations(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("Could not initialize migrations table: {error}"))?;

    let applied_version = current_schema_version(connection)?;
    if applied_version < 1 {
        connection
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS meetings (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  template TEXT NOT NULL,
                  status TEXT NOT NULL,
                  started_at TEXT,
                  updated_at TEXT NOT NULL,
                  raw_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_meetings_updated_at ON meetings(updated_at);
                CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
                ",
            )
            .map_err(|error| format!("Could not apply meeting schema: {error}"))?;

        connection
            .execute(
                "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![1, now_unix_seconds()],
            )
            .map_err(|error| format!("Could not record schema migration: {error}"))?;
    }

    if applied_version < 2 {
        connection
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY,
                  value_json TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                ",
            )
            .map_err(|error| format!("Could not apply app settings schema: {error}"))?;

        connection
            .execute(
                "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![CURRENT_SCHEMA_VERSION, now_unix_seconds()],
            )
            .map_err(|error| format!("Could not record app settings migration: {error}"))?;
    }

    Ok(())
}

fn current_schema_version(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get::<_, Option<i64>>(0)
        })
        .optional()
        .map_err(|error| format!("Could not read schema version: {error}"))
        .map(|version| version.flatten().unwrap_or(0))
}

fn meeting_id(meeting: &Value) -> Result<&str, String> {
    meeting
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Meeting is missing a non-empty id".to_string())
}

fn meeting_string_field(meeting: &Value, field: &str) -> Option<String> {
    meeting
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn now_unix_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        delete_meeting, load_app_settings, load_meetings, save_app_settings, save_meeting,
    };
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn saves_updates_loads_and_deletes_meetings() {
        let path = test_database_path("meeting-crud");

        save_meeting(
            &path,
            json!({
                "id": "meeting-1",
                "title": "First meeting",
                "template": "General",
                "phase": "recording",
                "startedAt": "2026-06-14T10:00:00Z"
            }),
        )
        .unwrap();
        save_meeting(
            &path,
            json!({
                "id": "meeting-1",
                "title": "Updated meeting",
                "template": "Product sync",
                "phase": "ready"
            }),
        )
        .unwrap();

        let meetings = load_meetings(&path).unwrap();
        assert_eq!(meetings.len(), 1);
        assert_eq!(meetings[0]["title"], "Updated meeting");

        delete_meeting(&path, "meeting-1").unwrap();
        assert!(load_meetings(&path).unwrap().is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_meetings_without_ids() {
        let path = test_database_path("missing-id");
        let error = save_meeting(&path, json!({ "title": "No id" })).unwrap_err();

        assert!(error.contains("missing a non-empty id"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saves_and_loads_app_settings() {
        let path = test_database_path("app-settings");

        assert!(load_app_settings(&path).unwrap().is_none());

        save_app_settings(
            &path,
            json!({
                "aiProvider": "ollama",
                "aiBaseUrl": "http://localhost:11434/v1"
            }),
        )
        .unwrap();

        let settings = load_app_settings(&path).unwrap().unwrap();
        assert_eq!(settings["aiProvider"], "ollama");
        assert_eq!(settings["aiBaseUrl"], "http://localhost:11434/v1");

        let _ = fs::remove_file(path);
    }

    fn test_database_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("openminutes-{name}-{unique}.sqlite3"))
    }
}
