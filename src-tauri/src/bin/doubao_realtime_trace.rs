use openminutes_lib::doubao_realtime::{
    stream_pcm_chunks, DoubaoRealtimeConfig, DEFAULT_DOUBAO_REALTIME_ENDPOINT,
    DEFAULT_DOUBAO_REALTIME_MODEL, DEFAULT_DOUBAO_REALTIME_RESOURCE_ID,
};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceEvent {
    elapsed_millis: u128,
    speaker: Option<String>,
    final_phase: bool,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceOutput {
    ok: bool,
    audio_path: String,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    duration_millis: Option<u64>,
    chunk_millis: u64,
    event_count: usize,
    duplicate_event_count: usize,
    revision_event_count: usize,
    final_text: Option<String>,
    events: Vec<TraceEvent>,
    error: Option<String>,
}

struct PcmAudio {
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
    duration_millis: u64,
}

#[tokio::main]
async fn main() {
    load_env_local();

    let audio_path = match env::args().nth(1) {
        Some(path) => PathBuf::from(path),
        None => {
            print_json(&TraceOutput {
                ok: false,
                audio_path: String::new(),
                sample_rate: None,
                channels: None,
                duration_millis: None,
                chunk_millis: 200,
                event_count: 0,
                duplicate_event_count: 0,
                revision_event_count: 0,
                final_text: None,
                events: Vec::new(),
                error: Some("Usage: doubao_realtime_trace <16-bit-pcm-wav-path>".to_string()),
            });
            std::process::exit(2);
        }
    };

    let audio = match read_wav_pcm(&audio_path) {
        Ok(audio) => audio,
        Err(error) => {
            print_json(&TraceOutput {
                ok: false,
                audio_path: audio_path.to_string_lossy().into_owned(),
                sample_rate: None,
                channels: None,
                duration_millis: None,
                chunk_millis: 200,
                event_count: 0,
                duplicate_event_count: 0,
                revision_event_count: 0,
                final_text: None,
                events: Vec::new(),
                error: Some(error),
            });
            std::process::exit(1);
        }
    };

    let chunk_millis = env::var("DOUBAO_REALTIME_TRACE_CHUNK_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(200);
    let speedup = env::var("DOUBAO_REALTIME_TRACE_SPEEDUP")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0);
    let api_key = env::var("DOUBAO_REALTIME_API_KEY")
        .or_else(|_| env::var("DOUBAO_API_KEY"))
        .unwrap_or_default();
    let endpoint = env::var("DOUBAO_REALTIME_ENDPOINT")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_ENDPOINT.to_string());
    let resource_id = env::var("DOUBAO_REALTIME_RESOURCE_ID")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_RESOURCE_ID.to_string());
    let model_name = env::var("DOUBAO_REALTIME_MODEL")
        .unwrap_or_else(|_| DEFAULT_DOUBAO_REALTIME_MODEL.to_string());
    let config = DoubaoRealtimeConfig::new(api_key)
        .with_endpoint(endpoint)
        .with_resource_id(resource_id)
        .with_model_name(model_name);

    let (sender, receiver) = mpsc::unbounded_channel::<Vec<i16>>();
    let samples = audio.samples.clone();
    let sample_rate = audio.sample_rate;
    let channels = audio.channels;
    tokio::spawn(async move {
        let chunk_samples =
            ((u64::from(sample_rate) * u64::from(channels) * chunk_millis) / 1_000).max(1) as usize;
        let sleep_millis = ((chunk_millis as f64) / speedup).max(1.0) as u64;

        for chunk in samples.chunks(chunk_samples) {
            if sender.send(chunk.to_vec()).is_err() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(sleep_millis)).await;
        }
    });

    let started_at = Instant::now();
    let events = Arc::new(Mutex::new(Vec::<TraceEvent>::new()));
    let callback_events = Arc::clone(&events);
    let result = stream_pcm_chunks(
        config,
        audio.sample_rate,
        audio.channels,
        receiver,
        move |text, speaker, final_phase| {
            if let Ok(mut events) = callback_events.lock() {
                events.push(TraceEvent {
                    elapsed_millis: started_at.elapsed().as_millis(),
                    speaker,
                    final_phase,
                    text,
                });
            }
        },
    )
    .await;

    let events = events
        .lock()
        .map(|events| events.clone())
        .unwrap_or_default();
    let duplicate_event_count = duplicate_event_count(&events);
    let revision_event_count = revision_event_count(&events);
    let final_text = events.last().map(|event| event.text.clone());
    let output = TraceOutput {
        ok: result.is_ok(),
        audio_path: audio_path.to_string_lossy().into_owned(),
        sample_rate: Some(audio.sample_rate),
        channels: Some(audio.channels),
        duration_millis: Some(audio.duration_millis),
        chunk_millis,
        event_count: events.len(),
        duplicate_event_count,
        revision_event_count,
        final_text,
        events,
        error: result.err(),
    };
    let ok = output.ok;
    print_json(&output);
    if !ok {
        std::process::exit(1);
    }
}

fn read_wav_pcm(path: &Path) -> Result<PcmAudio, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|error| format!("Could not open WAV file: {error}"))?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        return Err("Trace runner expects 16-bit integer PCM WAV input.".to_string());
    }

    let samples = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read WAV samples: {error}"))?;
    let frames = if spec.channels == 0 {
        0
    } else {
        samples.len() as u64 / u64::from(spec.channels)
    };
    let duration_millis = if spec.sample_rate == 0 {
        0
    } else {
        frames * 1_000 / u64::from(spec.sample_rate)
    };

    Ok(PcmAudio {
        samples,
        sample_rate: spec.sample_rate,
        channels: spec.channels,
        duration_millis,
    })
}

fn duplicate_event_count(events: &[TraceEvent]) -> usize {
    events
        .windows(2)
        .filter(|window| {
            canonical_transcript_text(&window[0].text) == canonical_transcript_text(&window[1].text)
        })
        .count()
}

fn revision_event_count(events: &[TraceEvent]) -> usize {
    events
        .windows(2)
        .filter(|window| is_revision(&window[0].text, &window[1].text))
        .count()
}

fn is_revision(previous: &str, next: &str) -> bool {
    let previous = canonical_transcript_text(previous);
    let next = canonical_transcript_text(next);
    previous.len() >= 3
        && next.len() >= 3
        && previous != next
        && (next.starts_with(&previous) || previous.starts_with(&next))
}

fn canonical_transcript_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
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

fn print_json(output: &TraceOutput) {
    match serde_json::to_string_pretty(output) {
        Ok(json) => println!("{json}"),
        Err(_) => println!(r#"{{"ok":false,"error":"Could not serialize trace output"}}"#),
    }
}
