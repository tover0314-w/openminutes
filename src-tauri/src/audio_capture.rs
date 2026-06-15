use crate::doubao_realtime;
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat, Stream,
};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::BufWriter,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc as tokio_mpsc;

const CAPTURE_DIR_NAME: &str = "Recordings";
const CAPTURE_READ_LIMIT_BYTES: u64 = 100 * 1024 * 1024;
const REALTIME_TRANSCRIPT_EVENT: &str = "openminutes:realtime-transcript";
const REALTIME_TRANSCRIPT_ERROR_EVENT: &str = "openminutes:realtime-transcript-error";

type SharedWavWriter = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;
type SharedRealtimeSender = Arc<Mutex<Option<tokio_mpsc::UnboundedSender<Vec<i16>>>>>;

#[derive(Debug, Clone)]
pub struct RealtimeTranscriptionConfig {
    pub api_key: String,
    pub endpoint: String,
    pub resource_id: String,
    pub model_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCaptureStatus {
    recording: bool,
    output_path: Option<String>,
    device_name: Option<String>,
    started_at_unix_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedAudioFile {
    path: String,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
    duration_millis: u128,
    retained: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedAudioCaptureFile {
    path: String,
    deleted: bool,
}

pub struct AudioCaptureManager {
    sender: mpsc::Sender<CaptureCommand>,
}

struct ActiveCapture {
    output_path: PathBuf,
    device_name: String,
    started_at_unix_seconds: u64,
    started_at: Instant,
    writer: SharedWavWriter,
    realtime_sender: SharedRealtimeSender,
    stream: Stream,
}

enum CaptureCommand {
    Start {
        app: AppHandle,
        capture_dir: PathBuf,
        meeting_id: String,
        realtime_config: Option<RealtimeTranscriptionConfig>,
        response: mpsc::Sender<Result<AudioCaptureStatus, String>>,
    },
    Stop {
        keep_file: bool,
        response: mpsc::Sender<Result<CapturedAudioFile, String>>,
    },
    Status {
        response: mpsc::Sender<Result<AudioCaptureStatus, String>>,
    },
}

impl Default for AudioCaptureManager {
    fn default() -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || run_capture_actor(receiver));

        Self { sender }
    }
}

impl AudioCaptureManager {
    pub fn start(
        &self,
        app: &AppHandle,
        meeting_id: &str,
        realtime_config: Option<RealtimeTranscriptionConfig>,
    ) -> Result<AudioCaptureStatus, String> {
        let capture_dir = capture_dir(app)?;
        let app = app.clone();
        send_capture_command(&self.sender, |response| CaptureCommand::Start {
            app,
            capture_dir,
            meeting_id: meeting_id.to_string(),
            realtime_config,
            response,
        })
    }

    pub fn stop(&self, keep_file: bool) -> Result<CapturedAudioFile, String> {
        send_capture_command(&self.sender, |response| CaptureCommand::Stop {
            keep_file,
            response,
        })
    }

    pub fn status(&self) -> Result<AudioCaptureStatus, String> {
        send_capture_command(&self.sender, |response| CaptureCommand::Status { response })
    }

    pub fn delete_retained_file(
        &self,
        app: &AppHandle,
        path: &str,
    ) -> Result<DeletedAudioCaptureFile, String> {
        let capture_dir = capture_dir(app)?;
        delete_retained_file_at(&capture_dir, Path::new(path))
    }
}

fn run_capture_actor(receiver: mpsc::Receiver<CaptureCommand>) {
    let mut active = None;

    for command in receiver {
        match command {
            CaptureCommand::Start {
                app,
                capture_dir,
                meeting_id,
                realtime_config,
                response,
            } => {
                let _ = response.send(start_capture(
                    &mut active,
                    app,
                    capture_dir,
                    &meeting_id,
                    realtime_config,
                ));
            }
            CaptureCommand::Stop {
                keep_file,
                response,
            } => {
                let _ = response.send(stop_capture(&mut active, keep_file));
            }
            CaptureCommand::Status { response } => {
                let _ = response.send(Ok(capture_status(active.as_ref())));
            }
        }
    }
}

fn send_capture_command<T>(
    sender: &mpsc::Sender<CaptureCommand>,
    build_command: impl FnOnce(mpsc::Sender<Result<T, String>>) -> CaptureCommand,
) -> Result<T, String> {
    let (response_sender, response_receiver) = mpsc::channel();
    sender
        .send(build_command(response_sender))
        .map_err(|_| "Microphone capture worker is not available.".to_string())?;
    response_receiver
        .recv()
        .map_err(|_| "Microphone capture worker did not respond.".to_string())?
}

fn start_capture(
    active: &mut Option<ActiveCapture>,
    app: AppHandle,
    capture_dir: PathBuf,
    meeting_id: &str,
    realtime_config: Option<RealtimeTranscriptionConfig>,
) -> Result<AudioCaptureStatus, String> {
    if active.is_some() {
        return Err("A microphone recording is already active.".to_string());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default microphone input device was found.".to_string())?;
    let device_name = device
        .name()
        .unwrap_or_else(|_| "Default microphone".to_string());
    let supported_config = device
        .default_input_config()
        .map_err(|error| format!("Could not read microphone input config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let config = supported_config.config();
    let output_path = capture_file_path(&capture_dir, meeting_id);
    let writer = create_wav_writer(&output_path, config.channels, config.sample_rate.0)?;
    let writer_for_stream = Arc::clone(&writer);
    let realtime_sender = start_realtime_transcription(
        app,
        meeting_id.to_string(),
        realtime_config,
        config.sample_rate.0,
        config.channels,
    );
    let realtime_for_stream = Arc::clone(&realtime_sender);
    let error_callback = |error| eprintln!("OpenMinutes microphone capture stream error: {error}");

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| write_f32_samples(data, &writer_for_stream, &realtime_for_stream),
            error_callback,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| write_i16_samples(data, &writer_for_stream, &realtime_for_stream),
            error_callback,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _| write_u16_samples(data, &writer_for_stream, &realtime_for_stream),
            error_callback,
            None,
        ),
        other => {
            return Err(format!(
                "Unsupported microphone sample format for recording: {other:?}"
            ))
        }
    }
    .map_err(|error| format!("Could not open microphone input stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Could not start microphone recording: {error}"))?;

    let started_at_unix_seconds = unix_seconds_now();
    *active = Some(ActiveCapture {
        output_path,
        device_name,
        started_at_unix_seconds,
        started_at: Instant::now(),
        writer,
        realtime_sender,
        stream,
    });

    Ok(capture_status(active.as_ref()))
}

fn stop_capture(
    active: &mut Option<ActiveCapture>,
    keep_file: bool,
) -> Result<CapturedAudioFile, String> {
    let active = active
        .take()
        .ok_or_else(|| "No active microphone recording was found.".to_string())?;
    let duration_millis = active.started_at.elapsed().as_millis();
    let output_path = active.output_path.clone();

    close_realtime_sender(&active.realtime_sender);
    drop(active.stream);
    finalize_wav_writer(&active.writer)?;

    read_captured_audio_file(&output_path, duration_millis, keep_file)
}

fn read_captured_audio_file(
    output_path: &Path,
    duration_millis: u128,
    keep_file: bool,
) -> Result<CapturedAudioFile, String> {
    let metadata = fs::metadata(output_path)
        .map_err(|error| format!("Could not read microphone recording metadata: {error}"))?;
    if metadata.len() > CAPTURE_READ_LIMIT_BYTES {
        return Err(format!(
            "Recorded audio is larger than {} MB and cannot be loaded for transcription yet.",
            CAPTURE_READ_LIMIT_BYTES / 1024 / 1024
        ));
    }

    let bytes = fs::read(output_path)
        .map_err(|error| format!("Could not read microphone recording: {error}"))?;
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("meeting-recording.wav")
        .to_string();
    if !keep_file {
        fs::remove_file(output_path)
            .map_err(|error| format!("Could not remove temporary microphone recording: {error}"))?;
    }

    Ok(CapturedAudioFile {
        path: output_path.to_string_lossy().into_owned(),
        file_name,
        mime_type: "audio/wav".to_string(),
        bytes,
        duration_millis,
        retained: keep_file,
    })
}

fn delete_retained_file_at(
    capture_dir: &Path,
    path: &Path,
) -> Result<DeletedAudioCaptureFile, String> {
    let canonical_capture_dir = fs::canonicalize(capture_dir)
        .map_err(|error| format!("Could not resolve recording directory: {error}"))?;
    let canonical_file = fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve recording file: {error}"))?;

    if !canonical_file.starts_with(&canonical_capture_dir) {
        return Err("Recording file is outside the OpenMinutes recording directory.".to_string());
    }
    if canonical_file
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("wav")
    {
        return Err("Only retained WAV recordings can be deleted from this action.".to_string());
    }

    fs::remove_file(&canonical_file)
        .map_err(|error| format!("Could not delete retained microphone recording: {error}"))?;

    Ok(DeletedAudioCaptureFile {
        path: canonical_file.to_string_lossy().into_owned(),
        deleted: true,
    })
}

fn capture_status(active: Option<&ActiveCapture>) -> AudioCaptureStatus {
    match active {
        Some(active) => AudioCaptureStatus {
            recording: true,
            output_path: Some(active.output_path.to_string_lossy().into_owned()),
            device_name: Some(active.device_name.clone()),
            started_at_unix_seconds: Some(active.started_at_unix_seconds),
        },
        None => AudioCaptureStatus {
            recording: false,
            output_path: None,
            device_name: None,
            started_at_unix_seconds: None,
        },
    }
}

fn create_wav_writer(
    path: &Path,
    channels: u16,
    sample_rate: u32,
) -> Result<SharedWavWriter, String> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: WavSampleFormat::Int,
    };
    let writer = WavWriter::create(path, spec)
        .map_err(|error| format!("Could not create microphone recording file: {error}"))?;
    Ok(Arc::new(Mutex::new(Some(writer))))
}

fn finalize_wav_writer(writer: &SharedWavWriter) -> Result<(), String> {
    let mut guard = writer
        .lock()
        .map_err(|_| "Could not finalize microphone recording file.".to_string())?;
    if let Some(writer) = guard.take() {
        writer
            .finalize()
            .map_err(|error| format!("Could not finalize microphone recording file: {error}"))?;
    }
    Ok(())
}

fn start_realtime_transcription(
    app: AppHandle,
    meeting_id: String,
    config: Option<RealtimeTranscriptionConfig>,
    sample_rate: u32,
    channels: u16,
) -> SharedRealtimeSender {
    let Some(config) = config else {
        return Arc::new(Mutex::new(None));
    };

    let (sender, receiver) = tokio_mpsc::unbounded_channel::<Vec<i16>>();
    tauri::async_runtime::spawn(async move {
        let started_at = Instant::now();
        let mut line_index = 0usize;
        let doubao_config = doubao_realtime::DoubaoRealtimeConfig::new(config.api_key)
            .with_endpoint(config.endpoint)
            .with_resource_id(config.resource_id)
            .with_model_name(config.model_name);
        let emit_app = app.clone();
        let emit_meeting_id = meeting_id.clone();

        let result = doubao_realtime::stream_pcm_chunks(
            doubao_config,
            sample_rate,
            channels,
            receiver,
            move |text| {
                line_index += 1;
                let payload = RealtimeTranscriptPayload {
                    meeting_id: emit_meeting_id.clone(),
                    line: RealtimeTranscriptLine {
                        id: format!("{}-live-{}", emit_meeting_id, line_index),
                        time: format_clock_time(started_at.elapsed().as_millis() as u64),
                        speaker: "Speaker".to_string(),
                        text,
                    },
                };
                let _ = emit_app.emit(REALTIME_TRANSCRIPT_EVENT, payload);
            },
        )
        .await;

        if let Err(message) = result {
            let _ = app.emit(
                REALTIME_TRANSCRIPT_ERROR_EVENT,
                RealtimeTranscriptErrorPayload {
                    meeting_id,
                    message,
                },
            );
        }
    });

    Arc::new(Mutex::new(Some(sender)))
}

fn close_realtime_sender(sender: &SharedRealtimeSender) {
    if let Ok(mut guard) = sender.lock() {
        let _ = guard.take();
    }
}

fn write_f32_samples(input: &[f32], writer: &SharedWavWriter, realtime: &SharedRealtimeSender) {
    write_samples(
        writer,
        realtime,
        input.iter().map(|sample| {
            let scaled = sample.clamp(-1.0, 1.0) * i16::MAX as f32;
            scaled as i16
        }),
    )
}

fn write_i16_samples(input: &[i16], writer: &SharedWavWriter, realtime: &SharedRealtimeSender) {
    write_samples(writer, realtime, input.iter().copied())
}

fn write_u16_samples(input: &[u16], writer: &SharedWavWriter, realtime: &SharedRealtimeSender) {
    write_samples(
        writer,
        realtime,
        input.iter().map(|sample| (*sample as i32 - 32768) as i16),
    )
}

fn write_samples<I>(writer: &SharedWavWriter, realtime: &SharedRealtimeSender, samples: I)
where
    I: IntoIterator<Item = i16>,
{
    let samples = samples.into_iter().collect::<Vec<_>>();
    if let Ok(guard) = realtime.try_lock() {
        if let Some(sender) = guard.as_ref() {
            let _ = sender.send(samples.clone());
        }
    }

    if let Ok(mut guard) = writer.try_lock() {
        if let Some(writer) = guard.as_mut() {
            for sample in samples {
                let _ = writer.write_sample(sample);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTranscriptPayload {
    meeting_id: String,
    line: RealtimeTranscriptLine,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTranscriptLine {
    id: String,
    time: String,
    speaker: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTranscriptErrorPayload {
    meeting_id: String,
    message: String,
}

fn format_clock_time(duration_millis: u64) -> String {
    let total_seconds = duration_millis / 1_000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes:02}:{seconds:02}")
}

fn capture_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let capture_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?
        .join(CAPTURE_DIR_NAME);
    fs::create_dir_all(&capture_dir)
        .map_err(|error| format!("Could not create recording directory: {error}"))?;
    Ok(capture_dir)
}

fn capture_file_path(capture_dir: &Path, meeting_id: &str) -> PathBuf {
    capture_dir.join(capture_file_name(meeting_id, unix_seconds_now()))
}

fn capture_file_name(meeting_id: &str, timestamp: u64) -> String {
    format!(
        "recording-{}-{timestamp}.wav",
        sanitize_capture_id(meeting_id)
    )
}

fn sanitize_capture_id(input: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_separator = false;

    for character in input.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            sanitized.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            sanitized.push('-');
            previous_was_separator = true;
        }
    }

    let sanitized = sanitized.trim_matches('-').to_string();

    if sanitized.is_empty() {
        "meeting".to_string()
    } else {
        sanitized.chars().take(64).collect()
    }
}

fn unix_seconds_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        capture_file_name, delete_retained_file_at, read_captured_audio_file, sanitize_capture_id,
    };
    use std::{fs, path::PathBuf};

    #[test]
    fn sanitizes_capture_file_names() {
        assert_eq!(
            sanitize_capture_id("Product Sync / Alex"),
            "Product-Sync-Alex"
        );
        assert_eq!(sanitize_capture_id(""), "meeting");
        assert_eq!(
            capture_file_name("product-sync-alex", 1_797_154_400),
            "recording-product-sync-alex-1797154400.wav"
        );
    }

    #[test]
    fn removes_temporary_recording_when_raw_audio_is_not_retained() {
        let path = test_recording_path("delete");
        fs::write(&path, b"RIFF").expect("write test recording");

        let captured = read_captured_audio_file(&path, 1200, false).expect("read captured audio");

        assert_eq!(captured.bytes, b"RIFF");
        assert_eq!(captured.duration_millis, 1200);
        assert!(!captured.retained);
        assert!(!path.exists());
    }

    #[test]
    fn keeps_recording_when_raw_audio_is_retained() {
        let path = test_recording_path("retain");
        fs::write(&path, b"RIFF").expect("write test recording");

        let captured = read_captured_audio_file(&path, 2400, true).expect("read captured audio");

        assert!(captured.retained);
        assert!(path.exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn deletes_retained_recording_inside_capture_dir() {
        let capture_dir = test_capture_dir("delete-retained");
        fs::create_dir_all(&capture_dir).expect("create capture dir");
        let path = capture_dir.join("recording.wav");
        fs::write(&path, b"RIFF").expect("write retained recording");

        let deleted = delete_retained_file_at(&capture_dir, &path).expect("delete retained audio");

        assert!(deleted.deleted);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&capture_dir);
    }

    #[test]
    fn rejects_recording_delete_outside_capture_dir() {
        let capture_dir = test_capture_dir("delete-reject-capture");
        let outside_dir = test_capture_dir("delete-reject-outside");
        fs::create_dir_all(&capture_dir).expect("create capture dir");
        fs::create_dir_all(&outside_dir).expect("create outside dir");
        let outside = outside_dir.join("recording.wav");
        fs::write(&outside, b"RIFF").expect("write outside recording");

        let error =
            delete_retained_file_at(&capture_dir, &outside).expect_err("reject outside file");

        assert!(error.contains("outside"));
        assert!(outside.exists());
        let _ = fs::remove_dir_all(&capture_dir);
        let _ = fs::remove_dir_all(&outside_dir);
    }

    fn test_recording_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("openminutes-{name}-{}.wav", std::process::id()))
    }

    fn test_capture_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("openminutes-{name}-{}", std::process::id()))
    }
}
