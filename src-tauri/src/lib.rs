mod audio_capture;
pub mod doubao_realtime;
mod storage;

use audio_capture::{
    AudioCaptureManager, AudioCaptureStatus, CapturedAudioFile, DeletedAudioCaptureFile,
};
use keyring::{Entry, Error as KeyringError};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::Value;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConnectionTestResult {
    provider: String,
    ok: bool,
    message: String,
    endpoint: Option<String>,
    status: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptLineResult {
    id: String,
    time: String,
    speaker: String,
    text: String,
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
        Err(KeyringError::NoEntry) => Ok(load_provider_api_key_from_env(&provider).is_some()),
        Err(error) => Err(format!("Could not read API key status: {error}")),
    }
}

#[tauri::command]
fn load_provider_api_key(provider: String) -> Result<Option<String>, String> {
    match provider_key_entry(&provider)?.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(KeyringError::NoEntry) => Ok(load_provider_api_key_from_env(&provider)),
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
async fn test_provider_connection(
    provider: String,
    base_url: Option<String>,
) -> Result<ProviderConnectionTestResult, String> {
    if provider == "doubao" || provider == "doubao-realtime" {
        let api_key = load_provider_api_key_string("doubao")?;
        let endpoint = base_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(doubao_realtime::DEFAULT_DOUBAO_REALTIME_ENDPOINT);
        let config = doubao_realtime::DoubaoRealtimeConfig::new(api_key).with_endpoint(endpoint);

        return Ok(match doubao_realtime::test_connection(config).await {
            Ok(result) => ProviderConnectionTestResult {
                provider,
                ok: true,
                message: "Doubao realtime websocket accepted the key.".to_string(),
                endpoint: Some(result.endpoint),
                status: None,
            },
            Err(error) => ProviderConnectionTestResult {
                provider,
                ok: false,
                message: error,
                endpoint: Some(endpoint.to_string()),
                status: None,
            },
        });
    }

    let plan = provider_connection_plan(&provider, base_url.as_deref())?;
    let api_key = if plan.api_key_required {
        Some(load_provider_api_key_string(plan.key_provider)?)
    } else {
        None
    };
    let result = run_provider_connection_test(&provider, &plan, api_key.as_deref()).await;

    Ok(result)
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
async fn transcribe_audio_with_doubao(
    meeting_id: String,
    file_name: String,
    bytes: Vec<u8>,
    model_name: Option<String>,
) -> Result<Vec<TranscriptLineResult>, String> {
    if bytes.is_empty() {
        return Err("Audio file is required for Doubao transcription.".to_string());
    }
    if bytes.len() as u64 > MAX_AUDIO_IMPORT_BYTES {
        return Err("Audio import is limited to 100 MB".to_string());
    }

    let api_key = load_provider_api_key_string("doubao")?;
    let temp_path = std::env::temp_dir().join(format!(
        "openminutes-doubao-{}-{}",
        Uuid::new_v4(),
        sanitize_file_stem(&file_name)
    ));
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Could not prepare Doubao audio file: {error}"))?;

    let mut config = doubao_realtime::DoubaoRealtimeConfig::new(api_key);
    if let Some(model_name) = model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        config = config.with_model_name(model_name);
    }

    let result = doubao_realtime::transcribe_wav_file(config, &temp_path).await;
    let _ = fs::remove_file(&temp_path);
    let transcript = result?;

    Ok(transcript
        .lines
        .into_iter()
        .enumerate()
        .map(|(index, text)| TranscriptLineResult {
            id: format!("{}-doubao-{}", meeting_id, index + 1),
            time: "00:00".to_string(),
            speaker: "Speaker".to_string(),
            text,
        })
        .collect())
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

#[tauri::command]
fn start_audio_capture(
    app: AppHandle,
    state: State<'_, AudioCaptureManager>,
    meeting_id: String,
    realtime_provider: Option<String>,
    realtime_model: Option<String>,
) -> Result<AudioCaptureStatus, String> {
    let realtime_config = match realtime_provider.as_deref() {
        Some("doubao-realtime") => Some(audio_capture::RealtimeTranscriptionConfig {
            api_key: load_provider_api_key_string("doubao")?,
            endpoint: doubao_realtime::DEFAULT_DOUBAO_REALTIME_ENDPOINT.to_string(),
            resource_id: doubao_realtime::DEFAULT_DOUBAO_REALTIME_RESOURCE_ID.to_string(),
            model_name: realtime_model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(doubao_realtime::DEFAULT_DOUBAO_REALTIME_MODEL)
                .to_string(),
        }),
        _ => None,
    };

    state.start(&app, &meeting_id, realtime_config)
}

#[tauri::command]
fn stop_audio_capture(
    state: State<'_, AudioCaptureManager>,
    keep_file: Option<bool>,
) -> Result<CapturedAudioFile, String> {
    state.stop(keep_file.unwrap_or(false))
}

#[tauri::command]
fn audio_capture_status(
    state: State<'_, AudioCaptureManager>,
) -> Result<AudioCaptureStatus, String> {
    state.status()
}

#[tauri::command]
fn delete_audio_capture_file(
    app: AppHandle,
    state: State<'_, AudioCaptureManager>,
    path: String,
) -> Result<DeletedAudioCaptureFile, String> {
    state.delete_retained_file(&app, &path)
}

struct ProviderConnectionPlan {
    key_provider: &'static str,
    endpoint: String,
    auth_scheme: ProviderAuthScheme,
    api_key_required: bool,
}

#[derive(Debug, Clone, Copy)]
enum ProviderAuthScheme {
    Bearer,
    DeepgramToken,
    RawAuthorization,
    None,
}

pub fn run() {
    tauri::Builder::default()
        .manage(AudioCaptureManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            test_provider_connection,
            read_audio_import_file,
            transcribe_audio_with_doubao,
            export_meeting_markdown,
            start_audio_capture,
            stop_audio_capture,
            audio_capture_status,
            delete_audio_capture_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenMinutes")
}

fn provider_key_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &provider_key_account(provider))
        .map_err(|error| format!("Could not open keychain entry: {error}"))
}

fn load_provider_api_key_string(provider: &str) -> Result<String, String> {
    match provider_key_entry(provider)?.get_password() {
        Ok(api_key) if !api_key.trim().is_empty() => Ok(api_key),
        Ok(_) | Err(KeyringError::NoEntry) => load_provider_api_key_from_env(provider).ok_or_else(|| {
            format!("{} API key is not configured.", provider_label(provider))
        }),
        Err(error) => Err(format!("Could not load API key: {error}")),
    }
}

fn load_provider_api_key_from_env(provider: &str) -> Option<String> {
    for key in provider_env_key_candidates(provider) {
        if let Ok(value) = env::var(key) {
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }

    for path in env_file_candidates() {
        if let Ok(contents) = fs::read_to_string(path) {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let Some((key, value)) = line.split_once('=') else {
                    continue;
                };
                if provider_env_key_candidates(provider)
                    .iter()
                    .any(|candidate| *candidate == key.trim())
                {
                    let value = value.trim().trim_matches('"').trim_matches('\'');
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
    }

    None
}

fn provider_env_key_candidates(provider: &str) -> &'static [&'static str] {
    match provider {
        "openai" | "openai-realtime" => &["OPENAI_API_KEY"],
        "groq" => &["GROQ_API_KEY"],
        "openrouter" => &["OPENROUTER_API_KEY"],
        "doubao" | "doubao-realtime" => &["DOUBAO_API_KEY", "DOUBAO_REALTIME_API_KEY"],
        "deepgram" => &["DEEPGRAM_API_KEY"],
        "assemblyai" => &["ASSEMBLYAI_API_KEY"],
        "openai-compatible" => &["OPENAI_COMPATIBLE_API_KEY"],
        _ => &[],
    }
}

fn env_file_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(mut cwd) = env::current_dir() {
        loop {
            candidates.push(cwd.join(".env.local"));
            if !cwd.pop() {
                break;
            }
        }
    }
    candidates
}

fn provider_connection_plan(
    provider: &str,
    base_url: Option<&str>,
) -> Result<ProviderConnectionPlan, String> {
    match provider {
        "openai" | "openai-realtime" => Ok(ProviderConnectionPlan {
            key_provider: "openai",
            endpoint: "https://api.openai.com/v1/models".to_string(),
            auth_scheme: ProviderAuthScheme::Bearer,
            api_key_required: true,
        }),
        "groq" => Ok(ProviderConnectionPlan {
            key_provider: "groq",
            endpoint: "https://api.groq.com/openai/v1/models".to_string(),
            auth_scheme: ProviderAuthScheme::Bearer,
            api_key_required: true,
        }),
        "openrouter" => Ok(ProviderConnectionPlan {
            key_provider: "openrouter",
            endpoint: "https://openrouter.ai/api/v1/models".to_string(),
            auth_scheme: ProviderAuthScheme::Bearer,
            api_key_required: true,
        }),
        "deepgram" => Ok(ProviderConnectionPlan {
            key_provider: "deepgram",
            endpoint: "https://api.deepgram.com/v1/models".to_string(),
            auth_scheme: ProviderAuthScheme::DeepgramToken,
            api_key_required: true,
        }),
        "assemblyai" => Ok(ProviderConnectionPlan {
            key_provider: "assemblyai",
            endpoint: "https://api.assemblyai.com/v2/transcript?limit=1".to_string(),
            auth_scheme: ProviderAuthScheme::RawAuthorization,
            api_key_required: true,
        }),
        "openai-compatible" => Ok(ProviderConnectionPlan {
            key_provider: "openai-compatible",
            endpoint: format!("{}/models", normalize_base_url(base_url)?),
            auth_scheme: ProviderAuthScheme::Bearer,
            api_key_required: true,
        }),
        "ollama" => Ok(ProviderConnectionPlan {
            key_provider: "ollama",
            endpoint: format!("{}/models", normalize_base_url(base_url)?),
            auth_scheme: ProviderAuthScheme::None,
            api_key_required: false,
        }),
        other => Err(format!("Unsupported provider: {other}")),
    }
}

async fn run_provider_connection_test(
    provider: &str,
    plan: &ProviderConnectionPlan,
    api_key: Option<&str>,
) -> ProviderConnectionTestResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return ProviderConnectionTestResult {
                provider: provider.to_string(),
                ok: false,
                message: format!("Could not create HTTP client: {error}"),
                endpoint: Some(plan.endpoint.clone()),
                status: None,
            };
        }
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(api_key) = api_key {
        match authorization_header(plan.auth_scheme, api_key) {
            Ok(value) => {
                headers.insert(AUTHORIZATION, value);
            }
            Err(message) => {
                return ProviderConnectionTestResult {
                    provider: provider.to_string(),
                    ok: false,
                    message,
                    endpoint: Some(plan.endpoint.clone()),
                    status: None,
                };
            }
        }
    }

    match client.get(&plan.endpoint).headers(headers).send().await {
        Ok(response) => {
            let status = response.status();
            ProviderConnectionTestResult {
                provider: provider.to_string(),
                ok: status.is_success(),
                message: if status.is_success() {
                    format!("{} key accepted.", provider_label(plan.key_provider))
                } else {
                    format!("Provider returned HTTP {status}.")
                },
                endpoint: Some(plan.endpoint.clone()),
                status: Some(status.as_u16()),
            }
        }
        Err(error) => ProviderConnectionTestResult {
            provider: provider.to_string(),
            ok: false,
            message: format!("Provider request failed: {error}"),
            endpoint: Some(plan.endpoint.clone()),
            status: None,
        },
    }
}

fn authorization_header(scheme: ProviderAuthScheme, api_key: &str) -> Result<HeaderValue, String> {
    let header_value = match scheme {
        ProviderAuthScheme::Bearer => format!("Bearer {}", api_key.trim()),
        ProviderAuthScheme::DeepgramToken => format!("Token {}", api_key.trim()),
        ProviderAuthScheme::RawAuthorization => api_key.trim().to_string(),
        ProviderAuthScheme::None => return Ok(HeaderValue::from_static("")),
    };

    HeaderValue::from_str(&header_value).map_err(|_| {
        "API key contains characters that cannot be used in an HTTP header.".to_string()
    })
}

fn normalize_base_url(base_url: Option<&str>) -> Result<String, String> {
    let trimmed = base_url.unwrap_or("").trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required for this provider.".to_string());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Base URL must start with http:// or https://.".to_string());
    }
    Ok(trimmed.to_string())
}

fn provider_label(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "groq" => "Groq",
        "openrouter" => "OpenRouter",
        "doubao" => "Doubao",
        "doubao-realtime" => "Doubao",
        "deepgram" => "Deepgram",
        "assemblyai" => "AssemblyAI",
        "openai-compatible" => "OpenAI-compatible",
        "ollama" => "Ollama",
        _ => "Provider",
    }
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
    use super::{
        audio_mime_type, normalize_base_url, provider_connection_plan, provider_key_account,
        sanitize_file_stem, ProviderAuthScheme,
    };
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
    fn builds_known_provider_connection_plans() {
        let openai = provider_connection_plan("openai-realtime", None).unwrap();
        assert_eq!(openai.key_provider, "openai");
        assert!(openai.endpoint.ends_with("/models"));
        assert!(matches!(openai.auth_scheme, ProviderAuthScheme::Bearer));

        let deepgram = provider_connection_plan("deepgram", None).unwrap();
        assert_eq!(deepgram.key_provider, "deepgram");
        assert!(deepgram.endpoint.contains("deepgram.com"));
        assert!(matches!(
            deepgram.auth_scheme,
            ProviderAuthScheme::DeepgramToken
        ));

        let openrouter = provider_connection_plan("openrouter", None).unwrap();
        assert_eq!(openrouter.key_provider, "openrouter");
        assert_eq!(openrouter.endpoint, "https://openrouter.ai/api/v1/models");
        assert!(matches!(openrouter.auth_scheme, ProviderAuthScheme::Bearer));

        assert!(provider_connection_plan("doubao-realtime", None).is_err());
    }

    #[test]
    fn builds_custom_provider_connection_plan_from_base_url() {
        let plan = provider_connection_plan("openai-compatible", Some("https://example.test/v1/"))
            .unwrap();

        assert_eq!(plan.key_provider, "openai-compatible");
        assert_eq!(plan.endpoint, "https://example.test/v1/models");
    }

    #[test]
    fn rejects_missing_custom_provider_base_url() {
        let error = normalize_base_url(Some(" ")).unwrap_err();
        assert!(error.contains("Base URL"));
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
