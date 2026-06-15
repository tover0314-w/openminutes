use openminutes_lib::doubao_realtime::{
    transcribe_wav_file, DoubaoRealtimeConfig, DEFAULT_DOUBAO_REALTIME_ENDPOINT,
    DEFAULT_DOUBAO_REALTIME_MODEL, DEFAULT_DOUBAO_REALTIME_RESOURCE_ID,
};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeOutput {
    ok: bool,
    endpoint: Option<String>,
    resource_id: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    duration_millis: Option<u64>,
    response_count: Option<usize>,
    text: Option<String>,
    error: Option<String>,
}

#[tokio::main]
async fn main() {
    load_env_local();

    let audio_path = match env::args().nth(1) {
        Some(path) => PathBuf::from(path),
        None => {
            print_json(&SmokeOutput {
                ok: false,
                endpoint: None,
                resource_id: None,
                sample_rate: None,
                channels: None,
                duration_millis: None,
                response_count: None,
                text: None,
                error: Some("Usage: doubao_realtime_smoke <16-bit-pcm-wav-path>".to_string()),
            });
            std::process::exit(2);
        }
    };

    let api_key = env::var("DOUBAO_REALTIME_API_KEY").unwrap_or_default();
    let endpoint = env::var("DOUBAO_REALTIME_ENDPOINT")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_ENDPOINT.to_string());
    let resource_id = env::var("DOUBAO_REALTIME_RESOURCE_ID")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_RESOURCE_ID.to_string());
    let model_name = env::var("DOUBAO_REALTIME_MODEL")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_MODEL.to_string());

    let config = DoubaoRealtimeConfig::new(api_key)
        .with_endpoint(endpoint.clone())
        .with_resource_id(resource_id.clone())
        .with_model_name(model_name);

    match transcribe_wav_file(config, audio_path).await {
        Ok(result) => {
            print_json(&SmokeOutput {
                ok: true,
                endpoint: Some(result.endpoint),
                resource_id: Some(result.resource_id),
                sample_rate: Some(result.sample_rate),
                channels: Some(result.channels),
                duration_millis: Some(result.duration_millis),
                response_count: Some(result.response_count),
                text: Some(result.text),
                error: None,
            });
        }
        Err(error) => {
            print_json(&SmokeOutput {
                ok: false,
                endpoint: Some(endpoint),
                resource_id: Some(resource_id),
                sample_rate: None,
                channels: None,
                duration_millis: None,
                response_count: None,
                text: None,
                error: Some(error),
            });
            std::process::exit(1);
        }
    }
}

fn load_env_local() {
    for path in env_file_candidates() {
        if !path.exists() {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(path) {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    if env::var_os(key.trim()).is_none() {
                        env::set_var(key.trim(), value.trim());
                    }
                }
            }
        }
        break;
    }
}

fn env_file_candidates() -> Vec<PathBuf> {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut candidates = vec![cwd.join(".env.local")];

    if let Some(parent) = cwd.parent() {
        candidates.push(parent.join(".env.local"));
    }
    if let Some(grandparent) = cwd.parent().and_then(Path::parent) {
        candidates.push(grandparent.join(".env.local"));
    }

    candidates
}

fn print_json(output: &SmokeOutput) {
    match serde_json::to_string_pretty(output) {
        Ok(json) => println!("{json}"),
        Err(_) => println!(r#"{{"ok":false,"error":"Could not serialize smoke output"}}"#),
    }
}
