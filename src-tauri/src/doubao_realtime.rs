use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

pub const DEFAULT_DOUBAO_REALTIME_ENDPOINT: &str =
    "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
pub const DEFAULT_DOUBAO_BATCH_ENDPOINT: &str =
    "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
pub const DEFAULT_DOUBAO_REALTIME_RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
pub const DEFAULT_DOUBAO_REALTIME_MODEL: &str = "bigmodel";

const PROTOCOL_VERSION_AND_HEADER_SIZE: u8 = 0x11;
const CLIENT_FULL_REQUEST: u8 = 0x1;
const CLIENT_AUDIO_ONLY_REQUEST: u8 = 0x2;
const SERVER_FULL_RESPONSE: u8 = 0x9;
const SERVER_ACK: u8 = 0xB;
const SERVER_ERROR_RESPONSE: u8 = 0xF;
const NO_SEQUENCE: u8 = 0x0;
const POS_SEQUENCE: u8 = 0x1;
const FINAL_PACKET: u8 = 0x2;
const NO_SERIALIZATION: u8 = 0x0;
const JSON_SERIALIZATION: u8 = 0x1;
const GZIP_COMPRESSION: u8 = 0x1;
const AUDIO_CHUNK_BYTES: usize = 6_400;

#[derive(Debug, Clone)]
pub struct DoubaoRealtimeConfig {
    pub api_key: String,
    pub endpoint: String,
    pub resource_id: String,
    pub model_name: String,
    pub timeout: Duration,
}

impl DoubaoRealtimeConfig {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            endpoint: DEFAULT_DOUBAO_REALTIME_ENDPOINT.to_string(),
            resource_id: DEFAULT_DOUBAO_REALTIME_RESOURCE_ID.to_string(),
            model_name: DEFAULT_DOUBAO_REALTIME_MODEL.to_string(),
            timeout: Duration::from_secs(45),
        }
    }

    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    pub fn with_resource_id(mut self, resource_id: impl Into<String>) -> Self {
        self.resource_id = resource_id.into();
        self
    }

    pub fn with_model_name(mut self, model_name: impl Into<String>) -> Self {
        self.model_name = model_name.into();
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoRealtimeConnectionResult {
    pub endpoint: String,
    pub resource_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoRealtimeTranscript {
    pub text: String,
    pub lines: Vec<String>,
    pub response_count: usize,
    pub endpoint: String,
    pub resource_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_millis: u64,
}

struct WavPcmAudio {
    pcm: Vec<u8>,
    sample_rate: u32,
    channels: u16,
    duration_millis: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TranscriptSegment {
    text: String,
    speaker: Option<String>,
}

#[derive(Debug)]
struct ServerMessage {
    message_type: u8,
    json: Option<Value>,
    text: Option<String>,
    error: Option<String>,
}

pub async fn test_connection(
    config: DoubaoRealtimeConfig,
) -> Result<DoubaoRealtimeConnectionResult, String> {
    let (mut stream, _) = connect_doubao_websocket(&config).await?;

    let _ = stream.close(None).await;

    Ok(DoubaoRealtimeConnectionResult {
        endpoint: config.endpoint,
        resource_id: config.resource_id,
    })
}

pub async fn transcribe_wav_file(
    config: DoubaoRealtimeConfig,
    path: impl AsRef<Path>,
) -> Result<DoubaoRealtimeTranscript, String> {
    let audio = read_wav_pcm(path.as_ref())?;
    if audio.pcm.is_empty() {
        return Err("WAV file did not contain PCM audio.".to_string());
    }

    let (mut stream, _) = connect_doubao_websocket(&config).await?;

    let request_payload = doubao_request_payload(&config, audio.sample_rate, audio.channels)?;
    stream
        .send(Message::Binary(
            build_frame(
                CLIENT_FULL_REQUEST,
                NO_SEQUENCE,
                JSON_SERIALIZATION,
                GZIP_COMPRESSION,
                None,
                &gzip_compress(&request_payload)?,
            )
            .into(),
        ))
        .await
        .map_err(|error| format!("Could not send Doubao session request: {error}"))?;

    for (index, chunk) in audio.pcm.chunks(AUDIO_CHUNK_BYTES).enumerate() {
        let is_final = (index + 1) * AUDIO_CHUNK_BYTES >= audio.pcm.len();
        let flags = if is_final { FINAL_PACKET } else { NO_SEQUENCE };

        stream
            .send(Message::Binary(
                build_frame(
                    CLIENT_AUDIO_ONLY_REQUEST,
                    flags,
                    NO_SERIALIZATION,
                    GZIP_COMPRESSION,
                    None,
                    &gzip_compress(chunk)?,
                )
                .into(),
            ))
            .await
            .map_err(|error| format!("Could not send Doubao audio chunk: {error}"))?;

        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let mut response_count = 0usize;
    let mut lines = Vec::<String>::new();
    let read_result = timeout(config.timeout, async {
        while let Some(message) = stream.next().await {
            let message =
                message.map_err(|error| format!("Doubao websocket read failed: {error}"))?;
            match message {
                Message::Binary(bytes) => {
                    let server_message = parse_server_message(&bytes)?;
                    response_count += 1;

                    if let Some(error) = server_message.error {
                        return Err(error);
                    }
                    if let Some(value) = server_message.json {
                        push_unique_lines(&mut lines, extract_transcript_texts(&value));
                    }
                    if let Some(text) = server_message.text {
                        push_unique_line(&mut lines, text);
                    }
                    if server_message.message_type == SERVER_FULL_RESPONSE && !lines.is_empty() {
                        break;
                    }
                }
                Message::Text(text) => {
                    response_count += 1;
                    match serde_json::from_str::<Value>(&text) {
                        Ok(value) => {
                            push_unique_lines(&mut lines, extract_transcript_texts(&value))
                        }
                        Err(_) => push_unique_line(&mut lines, text.to_string()),
                    }
                    if !lines.is_empty() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        Ok::<(), String>(())
    })
    .await;

    match read_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("Doubao realtime transcript timed out.".to_string()),
    }

    let _ = stream.close(None).await;
    if lines.is_empty() {
        return Err("Doubao realtime returned no transcript text.".to_string());
    }

    Ok(DoubaoRealtimeTranscript {
        text: lines.join("\n"),
        lines,
        response_count,
        endpoint: config.endpoint,
        resource_id: config.resource_id,
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        duration_millis: audio.duration_millis,
    })
}

pub async fn stream_pcm_chunks<F>(
    config: DoubaoRealtimeConfig,
    sample_rate: u32,
    channels: u16,
    mut receiver: UnboundedReceiver<Vec<i16>>,
    mut on_text: F,
) -> Result<(), String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    let (stream, _) = connect_doubao_websocket(&config).await?;
    let (mut writer, mut reader) = stream.split();
    let request_payload = doubao_request_payload(&config, sample_rate, channels)?;

    writer
        .send(Message::Binary(
            build_frame(
                CLIENT_FULL_REQUEST,
                NO_SEQUENCE,
                JSON_SERIALIZATION,
                GZIP_COMPRESSION,
                None,
                &gzip_compress(&request_payload)?,
            )
            .into(),
        ))
        .await
        .map_err(|error| format!("Could not send Doubao realtime session request: {error}"))?;

    let mut pcm_buffer = Vec::<u8>::new();
    let mut emitted_lines = Vec::<String>::new();
    let mut input_closed = false;
    let mut final_sent = false;

    while !final_sent {
        match receiver.recv().await {
            Some(samples) => {
                append_i16_samples(&mut pcm_buffer, &samples);
                while pcm_buffer.len() >= AUDIO_CHUNK_BYTES {
                    let next_chunk = pcm_buffer.drain(..AUDIO_CHUNK_BYTES).collect::<Vec<_>>();
                    send_audio_chunk(&mut writer, &next_chunk, false).await?;
                    drain_available_server_messages(
                        &mut reader,
                        &mut emitted_lines,
                        &mut on_text,
                        false,
                    )
                    .await?;
                }
            }
            None => {
                input_closed = true;
            }
        }

        if input_closed {
            if !pcm_buffer.is_empty() {
                let last_chunk = std::mem::take(&mut pcm_buffer);
                send_audio_chunk(&mut writer, &last_chunk, true).await?;
            } else {
                send_audio_chunk(&mut writer, &[], true).await?;
            }
            final_sent = true;
        }
    }

    let read_result = timeout(config.timeout, async {
        while let Some(message) = reader.next().await {
            let message =
                message.map_err(|error| format!("Doubao realtime read failed: {error}"))?;
            let should_finish =
                handle_server_message(message, &mut emitted_lines, &mut on_text, true)?;
            if should_finish {
                break;
            }
        }
        Ok::<(), String>(())
    })
    .await;

    match read_result {
        Ok(result) => result?,
        Err(_) => return Err("Doubao realtime final transcript timed out.".to_string()),
    }

    let _ = writer.close().await;
    Ok(())
}

async fn connect_doubao_websocket(
    config: &DoubaoRealtimeConfig,
) -> Result<
    (
        WebSocketStream<MaybeTlsStream<TcpStream>>,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    String,
> {
    let request = websocket_request(config)?;
    match timeout(Duration::from_secs(12), connect_async(request)).await {
        Err(_) => Err("Doubao realtime handshake timed out.".to_string()),
        Ok(Ok(connection)) => Ok(connection),
        Ok(Err(error)) => Err(diagnose_handshake_failure(config, &error.to_string()).await),
    }
}

async fn diagnose_handshake_failure(config: &DoubaoRealtimeConfig, error: &str) -> String {
    let mut message = format!("Doubao realtime handshake failed: {error}");
    if let Ok(diagnostic) = run_handshake_diagnostic(config).await {
        message.push_str(". ");
        message.push_str(&diagnostic);
    }
    message
}

async fn run_handshake_diagnostic(config: &DoubaoRealtimeConfig) -> Result<String, String> {
    let endpoint = diagnostic_endpoint(&config.endpoint)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Could not build Doubao diagnostic client: {error}"))?;

    let response = client
        .get(endpoint)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", "SGVsbG9PcGVuTWludXRlcw==")
        .header("X-Api-Key", config.api_key.trim())
        .header("X-Api-Resource-Id", config.resource_id.trim())
        .header("X-Api-Request-Id", Uuid::new_v4().to_string())
        .header("X-Api-Connect-Id", Uuid::new_v4().to_string())
        .send()
        .await
        .map_err(|error| format!("Doubao diagnostic request failed: {error}"))?;
    let status = response.status();
    let log_id = response
        .headers()
        .get("X-Tt-Logid")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    let body = truncate_for_error(body.trim(), 500);

    let mut details = format!("Diagnostic HTTP {status}");
    if let Some(log_id) = log_id {
        details.push_str(&format!("; X-Tt-Logid={log_id}"));
    }
    if !body.is_empty() {
        details.push_str(&format!("; body={body}"));
    }

    Ok(details)
}

fn diagnostic_endpoint(endpoint: &str) -> Result<String, String> {
    if let Some(path) = endpoint.strip_prefix("wss://") {
        return Ok(format!("https://{path}"));
    }
    if let Some(path) = endpoint.strip_prefix("ws://") {
        return Ok(format!("http://{path}"));
    }
    Err("Doubao websocket endpoint must start with ws:// or wss://.".to_string())
}

fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}

fn websocket_request(
    config: &DoubaoRealtimeConfig,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let api_key = config.api_key.trim();
    if api_key.is_empty() {
        return Err("Doubao API key is not configured.".to_string());
    }
    let resource_id = config.resource_id.trim();
    if resource_id.is_empty() {
        return Err("Doubao resource id is required.".to_string());
    }

    let mut request = config
        .endpoint
        .as_str()
        .into_client_request()
        .map_err(|error| format!("Invalid Doubao websocket endpoint: {error}"))?;
    let headers = request.headers_mut();
    headers.insert(
        "X-Api-Key",
        HeaderValue::from_str(api_key)
            .map_err(|_| "Doubao API key cannot be sent as an HTTP header.".to_string())?,
    );
    headers.insert(
        "X-Api-Resource-Id",
        HeaderValue::from_str(resource_id)
            .map_err(|_| "Doubao resource id cannot be sent as an HTTP header.".to_string())?,
    );
    headers.insert(
        "X-Api-Connect-Id",
        HeaderValue::from_str(&Uuid::new_v4().to_string())
            .map_err(|_| "Could not build Doubao connect id.".to_string())?,
    );

    Ok(request)
}

async fn send_audio_chunk(
    writer: &mut SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>,
    chunk: &[u8],
    is_final: bool,
) -> Result<(), String> {
    let flags = if is_final { FINAL_PACKET } else { NO_SEQUENCE };
    writer
        .send(Message::Binary(
            build_frame(
                CLIENT_AUDIO_ONLY_REQUEST,
                flags,
                NO_SERIALIZATION,
                GZIP_COMPRESSION,
                None,
                &gzip_compress(chunk)?,
            )
            .into(),
        ))
        .await
        .map_err(|error| format!("Could not send Doubao realtime audio chunk: {error}"))
}

async fn drain_available_server_messages<F>(
    reader: &mut futures_util::stream::SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    emitted_lines: &mut Vec<String>,
    on_text: &mut F,
    final_phase: bool,
) -> Result<(), String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    while let Ok(Some(message)) = timeout(Duration::from_millis(1), reader.next()).await {
        let message = message.map_err(|error| format!("Doubao realtime read failed: {error}"))?;
        let _ = handle_server_message(message, emitted_lines, on_text, final_phase)?;
    }

    Ok(())
}

fn handle_server_message<F>(
    message: Message,
    emitted_lines: &mut Vec<String>,
    on_text: &mut F,
    final_phase: bool,
) -> Result<bool, String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    match message {
        Message::Binary(bytes) => {
            let server_message = parse_server_message(&bytes)?;
            if let Some(error) = server_message.error {
                return Err(error);
            }

            let mut texts = Vec::new();
            if let Some(value) = server_message.json {
                texts.extend(extract_transcript_segments(&value));
            }
            if let Some(text) = server_message.text {
                texts.push(TranscriptSegment {
                    text,
                    speaker: None,
                });
            }
            emit_streaming_lines(emitted_lines, texts, on_text, final_phase);

            Ok(server_message.message_type == SERVER_FULL_RESPONSE && !emitted_lines.is_empty())
        }
        Message::Text(text) => {
            match serde_json::from_str::<Value>(&text) {
                Ok(value) => emit_streaming_lines(
                    emitted_lines,
                    extract_transcript_segments(&value),
                    on_text,
                    final_phase,
                ),
                Err(_) => emit_streaming_lines(
                    emitted_lines,
                    vec![TranscriptSegment {
                        text: text.to_string(),
                        speaker: None,
                    }],
                    on_text,
                    final_phase,
                ),
            }
            Ok(!emitted_lines.is_empty())
        }
        Message::Close(_) => Ok(true),
        _ => Ok(false),
    }
}

fn emit_streaming_lines<F>(
    lines: &mut Vec<String>,
    segments: Vec<TranscriptSegment>,
    on_text: &mut F,
    final_phase: bool,
) where
    F: FnMut(String, Option<String>, bool) + Send,
{
    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() || lines.last().is_some_and(|line| line == text) {
            continue;
        }

        if lines.is_empty() {
            lines.push(text.to_string());
        } else if lines
            .last()
            .is_some_and(|last_line| is_realtime_revision(last_line, text))
        {
            if let Some(last_line) = lines.last_mut() {
                *last_line = text.to_string();
            }
        } else if lines.iter().any(|line| is_realtime_revision(line, text)) {
            continue;
        } else {
            lines.push(text.to_string());
        }
        on_text(text.to_string(), segment.speaker, final_phase);
    }
}

fn is_realtime_revision(previous: &str, next: &str) -> bool {
    let previous = canonical_transcript_text(previous);
    let next = canonical_transcript_text(next);
    previous.len() >= 3
        && next.len() >= 3
        && (next.starts_with(&previous) || previous.starts_with(&next))
}

fn canonical_transcript_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn append_i16_samples(output: &mut Vec<u8>, samples: &[i16]) {
    output.reserve(samples.len() * 2);
    for sample in samples {
        output.extend_from_slice(&sample.to_le_bytes());
    }
}

fn doubao_request_payload(
    config: &DoubaoRealtimeConfig,
    sample_rate: u32,
    channels: u16,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&json!({
        "user": {
            "uid": "openminutes-local-smoke"
        },
        "audio": {
            "format": "pcm",
            "codec": "raw",
            "rate": sample_rate,
            "bits": 16,
            "channel": channels,
        },
        "request": {
            "model_name": config.model_name,
            "enable_itn": true,
            "enable_punc": true,
            "enable_ddc": true,
            "result_type": "full",
            "show_utterances": true,
            "enable_speaker_info": true,
        }
    }))
    .map_err(|error| format!("Could not encode Doubao request payload: {error}"))
}

fn read_wav_pcm(path: &Path) -> Result<WavPcmAudio, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|error| format!("Could not open WAV file for Doubao smoke: {error}"))?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        return Err("Doubao smoke runner expects 16-bit integer PCM WAV input.".to_string());
    }

    let mut pcm = Vec::new();
    for sample in reader.samples::<i16>() {
        let sample = sample.map_err(|error| format!("Could not read WAV sample: {error}"))?;
        pcm.extend_from_slice(&sample.to_le_bytes());
    }

    let frames = if spec.channels == 0 {
        0
    } else {
        pcm.len() as u64 / 2 / u64::from(spec.channels)
    };
    let duration_millis = if spec.sample_rate == 0 {
        0
    } else {
        frames * 1_000 / u64::from(spec.sample_rate)
    };

    Ok(WavPcmAudio {
        pcm,
        sample_rate: spec.sample_rate,
        channels: spec.channels,
        duration_millis,
    })
}

fn build_frame(
    message_type: u8,
    flags: u8,
    serialization: u8,
    compression: u8,
    sequence: Option<i32>,
    payload: &[u8],
) -> Vec<u8> {
    let mut frame = Vec::with_capacity(12 + payload.len());
    frame.push(PROTOCOL_VERSION_AND_HEADER_SIZE);
    frame.push((message_type << 4) | flags);
    frame.push((serialization << 4) | compression);
    frame.push(0);

    if let Some(sequence) = sequence {
        frame.extend_from_slice(&sequence.to_be_bytes());
    }

    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn parse_server_message(data: &[u8]) -> Result<ServerMessage, String> {
    if data.len() < 4 {
        return Err("Doubao response was shorter than the protocol header.".to_string());
    }

    let header_size = usize::from(data[0] & 0x0f) * 4;
    if data.len() < header_size {
        return Err("Doubao response header size exceeded response length.".to_string());
    }

    let message_type = data[1] >> 4;
    let flags = data[1] & 0x0f;
    let serialization = data[2] >> 4;
    let compression = data[2] & 0x0f;
    let mut offset = header_size;

    if flags & POS_SEQUENCE == POS_SEQUENCE {
        if data.len() < offset + 4 {
            return Err("Doubao response sequence field was truncated.".to_string());
        }
        offset += 4;
    }

    if message_type == SERVER_ACK && data.len() <= offset {
        return Ok(ServerMessage {
            message_type,
            json: None,
            text: None,
            error: None,
        });
    }

    let mut error_code: Option<i32> = None;
    if message_type == SERVER_ERROR_RESPONSE {
        if data.len() < offset + 8 {
            return Err("Doubao error response was truncated.".to_string());
        }
        error_code = Some(i32::from_be_bytes(
            data[offset..offset + 4]
                .try_into()
                .expect("slice length checked"),
        ));
        offset += 4;
    }

    if data.len() < offset + 4 {
        return Ok(ServerMessage {
            message_type,
            json: None,
            text: None,
            error: None,
        });
    }

    let payload_size = u32::from_be_bytes(
        data[offset..offset + 4]
            .try_into()
            .expect("slice length checked"),
    ) as usize;
    offset += 4;
    if data.len() < offset + payload_size {
        return Err("Doubao response payload was truncated.".to_string());
    }

    let payload = &data[offset..offset + payload_size];
    let payload = if compression == GZIP_COMPRESSION {
        gzip_decompress(payload)?
    } else {
        payload.to_vec()
    };

    let text = String::from_utf8(payload)
        .map_err(|_| "Doubao response payload was not valid UTF-8.".to_string())?;
    if message_type == SERVER_ERROR_RESPONSE {
        let code = error_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Ok(ServerMessage {
            message_type,
            json: None,
            text: None,
            error: Some(format!("Doubao realtime returned error {code}: {text}")),
        });
    }

    if serialization == JSON_SERIALIZATION {
        let json = serde_json::from_str::<Value>(&text).map_err(|error| {
            format!("Could not parse Doubao JSON response: {error}; body: {text}")
        })?;
        return Ok(ServerMessage {
            message_type,
            json: Some(json),
            text: None,
            error: None,
        });
    }

    Ok(ServerMessage {
        message_type,
        json: None,
        text: Some(text),
        error: None,
    })
}

fn gzip_compress(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(payload)
        .map_err(|error| format!("Could not gzip Doubao payload: {error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("Could not finish Doubao gzip payload: {error}"))
}

fn gzip_decompress(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(payload);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|error| format!("Could not decompress Doubao payload: {error}"))?;
    Ok(output)
}

fn extract_transcript_texts(value: &Value) -> Vec<String> {
    extract_transcript_segments(value)
        .into_iter()
        .map(|segment| segment.text)
        .collect()
}

fn extract_transcript_segments(value: &Value) -> Vec<TranscriptSegment> {
    let mut utterances = Vec::new();
    collect_utterance_segments(value, &mut utterances);
    if !utterances.is_empty() {
        return utterances;
    }

    if let Some(text) = first_text_at_paths(
        value,
        &[
            &["result", "text"],
            &["payload", "result", "text"],
            &["data", "result", "text"],
            &["response", "result", "text"],
            &["text"],
        ],
    ) {
        return vec![TranscriptSegment {
            text,
            speaker: None,
        }];
    }

    let mut texts = Vec::new();
    collect_text_segments(value, &mut texts);
    texts
}

fn first_text_at_paths(value: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        if let Some(text) = current
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
    }

    None
}

fn collect_utterance_segments(value: &Value, segments: &mut Vec<TranscriptSegment>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "utterances" {
                    collect_direct_item_segments(value, segments);
                } else {
                    collect_utterance_segments(value, segments);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_utterance_segments(item, segments);
            }
        }
        _ => {}
    }
}

fn collect_direct_item_segments(value: &Value, segments: &mut Vec<TranscriptSegment>) {
    if let Value::Array(items) = value {
        for item in items {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                push_unique_segment(
                    segments,
                    TranscriptSegment {
                        text: text.to_string(),
                        speaker: extract_speaker_label(item),
                    },
                );
            }
        }
    }
}

fn collect_text_segments(value: &Value, segments: &mut Vec<TranscriptSegment>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "text" {
                    if let Some(text) = value.as_str() {
                        push_unique_segment(
                            segments,
                            TranscriptSegment {
                                text: text.to_string(),
                                speaker: None,
                            },
                        );
                    }
                }
                collect_text_segments(value, segments);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_segments(item, segments);
            }
        }
        _ => {}
    }
}

fn extract_speaker_label(value: &Value) -> Option<String> {
    let raw = value
        .get("additions")
        .and_then(|additions| {
            additions
                .get("speaker")
                .or_else(|| additions.get("speaker_id"))
                .or_else(|| additions.get("speakerId"))
        })
        .or_else(|| value.get("speaker"))
        .or_else(|| value.get("speaker_id"))
        .or_else(|| value.get("speakerId"))?;

    let label = raw
        .as_str()
        .map(str::trim)
        .filter(|speaker| !speaker.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| raw.as_i64().map(|speaker| speaker.to_string()))?;

    Some(if label.to_lowercase().starts_with("speaker") {
        label
    } else {
        format!("Speaker {label}")
    })
}

fn push_unique_lines(lines: &mut Vec<String>, incoming: Vec<String>) {
    for line in incoming {
        push_unique_line(lines, line);
    }
}

fn push_unique_line(lines: &mut Vec<String>, line: String) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    if lines.iter().any(|existing| existing == trimmed) {
        return;
    }
    lines.push(trimmed.to_string());
}

fn push_unique_segment(segments: &mut Vec<TranscriptSegment>, segment: TranscriptSegment) {
    let trimmed = segment.text.trim();
    if trimmed.is_empty() {
        return;
    }
    if segments.iter().any(|existing| {
        existing.text == trimmed && existing.speaker.as_deref() == segment.speaker.as_deref()
    }) {
        return;
    }
    segments.push(TranscriptSegment {
        text: trimmed.to_string(),
        speaker: segment.speaker,
    });
}

#[cfg(test)]
mod tests {
    use super::{
        build_frame, diagnostic_endpoint, emit_streaming_lines, extract_transcript_segments,
        extract_transcript_texts, gzip_compress, is_realtime_revision, parse_server_message,
        TranscriptSegment, CLIENT_AUDIO_ONLY_REQUEST, FINAL_PACKET, GZIP_COMPRESSION,
        JSON_SERIALIZATION, SERVER_FULL_RESPONSE,
    };
    use serde_json::json;

    #[test]
    fn builds_final_audio_frame_without_sequence_field() {
        let frame = build_frame(
            CLIENT_AUDIO_ONLY_REQUEST,
            FINAL_PACKET,
            0,
            GZIP_COMPRESSION,
            None,
            b"abc",
        );

        assert_eq!(frame[0], 0x11);
        assert_eq!(frame[1], 0x22);
        assert_eq!(frame[2], 0x01);
        assert_eq!(&frame[4..8], &3u32.to_be_bytes());
        assert_eq!(&frame[8..], b"abc");
    }

    #[test]
    fn parses_gzipped_json_server_response() {
        let payload = gzip_compress(br#"{"result":{"text":"hello world"}}"#).unwrap();
        let frame = build_frame(
            SERVER_FULL_RESPONSE,
            0,
            JSON_SERIALIZATION,
            GZIP_COMPRESSION,
            None,
            &payload,
        );

        let message = parse_server_message(&frame).unwrap();
        assert_eq!(message.message_type, SERVER_FULL_RESPONSE);
        assert_eq!(
            message.json.unwrap()["result"]["text"],
            json!("hello world")
        );
    }

    #[test]
    fn prefers_utterance_texts_over_cumulative_full_text() {
        let value = json!({
            "result": {
                "text": "full transcript",
                "utterances": [
                    {
                        "text": "first",
                        "words": [{ "text": "first" }]
                    },
                    {
                        "text": "second",
                        "words": [{ "text": "second" }]
                    }
                ]
            }
        });

        assert_eq!(extract_transcript_texts(&value), vec!["first", "second"]);
    }

    #[test]
    fn falls_back_to_utterance_texts_when_full_text_is_missing() {
        let value = json!({
            "result": {
                "utterances": [
                    { "text": "first" },
                    { "text": "first" },
                    { "text": "second" }
                ]
            }
        });

        assert_eq!(extract_transcript_texts(&value), vec!["first", "second"]);
    }

    #[test]
    fn prefers_utterance_segments_with_speakers_over_full_text() {
        let value = json!({
            "result": {
                "text": "full cumulative transcript",
                "utterances": [
                    { "text": "first speaker line", "additions": { "speaker": "1" } },
                    { "text": "second speaker line", "speaker_id": 2 }
                ]
            }
        });

        let segments = extract_transcript_segments(&value);

        assert_eq!(segments[0].text, "first speaker line");
        assert_eq!(segments[0].speaker.as_deref(), Some("Speaker 1"));
        assert_eq!(segments[1].text, "second speaker line");
        assert_eq!(segments[1].speaker.as_deref(), Some("Speaker 2"));
    }

    #[test]
    fn treats_punctuation_only_changes_as_realtime_revisions() {
        assert!(is_realtime_revision(
            "来，有请第二位人士说话，可是我现在",
            "来，有请第二位人士说话。可是我现在在刷牙"
        ));
    }

    #[test]
    fn skips_older_segments_when_stream_returns_cumulative_utterances() {
        let mut lines = Vec::<String>::new();
        let mut emitted = Vec::<String>::new();

        emit_streaming_lines(
            &mut lines,
            vec![
                TranscriptSegment {
                    text: "第一句".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                },
                TranscriptSegment {
                    text: "第二句".to_string(),
                    speaker: Some("Speaker 2".to_string()),
                },
            ],
            &mut |text, _speaker, _final_phase| emitted.push(text),
            false,
        );
        emit_streaming_lines(
            &mut lines,
            vec![
                TranscriptSegment {
                    text: "第一句".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                },
                TranscriptSegment {
                    text: "第二句".to_string(),
                    speaker: Some("Speaker 2".to_string()),
                },
                TranscriptSegment {
                    text: "第三句".to_string(),
                    speaker: Some("Speaker 1".to_string()),
                },
            ],
            &mut |text, _speaker, _final_phase| emitted.push(text),
            false,
        );

        assert_eq!(emitted, vec!["第一句", "第二句", "第三句"]);
    }

    #[test]
    fn maps_websocket_endpoint_to_https_for_diagnostics() {
        assert_eq!(
            diagnostic_endpoint("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel").unwrap(),
            "https://openspeech.bytedance.com/api/v3/sauc/bigmodel"
        );
    }
}
