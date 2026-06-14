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
use tauri::{AppHandle, Manager};

const CAPTURE_DIR_NAME: &str = "Recordings";
const CAPTURE_READ_LIMIT_BYTES: u64 = 100 * 1024 * 1024;

type SharedWavWriter = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;

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

pub struct AudioCaptureManager {
    sender: mpsc::Sender<CaptureCommand>,
}

struct ActiveCapture {
    output_path: PathBuf,
    device_name: String,
    started_at_unix_seconds: u64,
    started_at: Instant,
    writer: SharedWavWriter,
    stream: Stream,
}

enum CaptureCommand {
    Start {
        capture_dir: PathBuf,
        meeting_id: String,
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
    pub fn start(&self, app: &AppHandle, meeting_id: &str) -> Result<AudioCaptureStatus, String> {
        let capture_dir = capture_dir(app)?;
        send_capture_command(&self.sender, |response| CaptureCommand::Start {
            capture_dir,
            meeting_id: meeting_id.to_string(),
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
}

fn run_capture_actor(receiver: mpsc::Receiver<CaptureCommand>) {
    let mut active = None;

    for command in receiver {
        match command {
            CaptureCommand::Start {
                capture_dir,
                meeting_id,
                response,
            } => {
                let _ = response.send(start_capture(&mut active, capture_dir, &meeting_id));
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
    capture_dir: PathBuf,
    meeting_id: &str,
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
    let error_callback = |error| eprintln!("OpenMinutes microphone capture stream error: {error}");

    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _| write_f32_samples(data, &writer_for_stream),
            error_callback,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _| write_i16_samples(data, &writer_for_stream),
            error_callback,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _| write_u16_samples(data, &writer_for_stream),
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

fn write_f32_samples(input: &[f32], writer: &SharedWavWriter) {
    write_samples(
        writer,
        input.iter().map(|sample| {
            let scaled = sample.clamp(-1.0, 1.0) * i16::MAX as f32;
            scaled as i16
        }),
    )
}

fn write_i16_samples(input: &[i16], writer: &SharedWavWriter) {
    write_samples(writer, input.iter().copied())
}

fn write_u16_samples(input: &[u16], writer: &SharedWavWriter) {
    write_samples(
        writer,
        input.iter().map(|sample| (*sample as i32 - 32768) as i16),
    )
}

fn write_samples<I>(writer: &SharedWavWriter, samples: I)
where
    I: IntoIterator<Item = i16>,
{
    if let Ok(mut guard) = writer.try_lock() {
        if let Some(writer) = guard.as_mut() {
            for sample in samples {
                let _ = writer.write_sample(sample);
            }
        }
    }
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
    use super::{capture_file_name, read_captured_audio_file, sanitize_capture_id};
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

    fn test_recording_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("openminutes-{name}-{}.wav", std::process::id()))
    }
}
