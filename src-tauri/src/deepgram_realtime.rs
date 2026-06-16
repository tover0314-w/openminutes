use futures_util::{stream::SplitStream, SinkExt, StreamExt};
use serde_json::Value;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    MaybeTlsStream, WebSocketStream,
};

pub const DEFAULT_DEEPGRAM_REALTIME_ENDPOINT: &str = "wss://api.deepgram.com/v1/listen";
pub const DEFAULT_DEEPGRAM_REALTIME_MODEL: &str = "nova-3";
pub const DEFAULT_DEEPGRAM_REALTIME_LANGUAGE: &str = "zh";

#[derive(Debug, Clone)]
pub struct DeepgramRealtimeConfig {
    pub api_key: String,
    pub endpoint: String,
    pub model_name: String,
    pub language: String,
    pub timeout: Duration,
}

impl DeepgramRealtimeConfig {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            endpoint: DEFAULT_DEEPGRAM_REALTIME_ENDPOINT.to_string(),
            model_name: DEFAULT_DEEPGRAM_REALTIME_MODEL.to_string(),
            language: DEFAULT_DEEPGRAM_REALTIME_LANGUAGE.to_string(),
            timeout: Duration::from_secs(20),
        }
    }

    pub fn with_model_name(mut self, model_name: impl Into<String>) -> Self {
        self.model_name = model_name.into();
        self
    }

    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = language.into();
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TranscriptSegment {
    text: String,
    speaker: Option<String>,
    final_phase: bool,
}

pub async fn stream_pcm_chunks<F>(
    config: DeepgramRealtimeConfig,
    sample_rate: u32,
    channels: u16,
    mut receiver: UnboundedReceiver<Vec<i16>>,
    mut on_text: F,
) -> Result<(), String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    let (stream, _) = connect_deepgram_websocket(&config, sample_rate, channels).await?;
    let (mut writer, mut reader) = stream.split();

    while let Some(samples) = receiver.recv().await {
        if samples.is_empty() {
            continue;
        }

        let mut pcm = Vec::<u8>::with_capacity(samples.len() * 2);
        append_i16_samples(&mut pcm, &samples);
        writer
            .send(Message::Binary(pcm.into()))
            .await
            .map_err(|error| format!("Could not send Deepgram realtime audio chunk: {error}"))?;
        drain_available_server_messages(&mut reader, &mut on_text).await?;
    }

    writer
        .send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
        .await
        .map_err(|error| format!("Could not close Deepgram realtime stream: {error}"))?;

    let read_result = timeout(config.timeout, async {
        while let Some(message) = reader.next().await {
            let message =
                message.map_err(|error| format!("Deepgram realtime read failed: {error}"))?;
            if handle_server_message(message, &mut on_text)? {
                break;
            }
        }
        Ok::<(), String>(())
    })
    .await;

    match read_result {
        Ok(result) => result?,
        Err(_) => return Err("Deepgram realtime final transcript timed out.".to_string()),
    }

    let _ = writer.close().await;
    Ok(())
}

async fn connect_deepgram_websocket(
    config: &DeepgramRealtimeConfig,
    sample_rate: u32,
    channels: u16,
) -> Result<
    (
        WebSocketStream<MaybeTlsStream<TcpStream>>,
        tokio_tungstenite::tungstenite::handshake::client::Response,
    ),
    String,
> {
    let request = websocket_request(config, sample_rate, channels)?;
    match timeout(Duration::from_secs(12), connect_async(request)).await {
        Err(_) => Err("Deepgram realtime handshake timed out.".to_string()),
        Ok(Ok(connection)) => Ok(connection),
        Ok(Err(error)) => Err(format!("Deepgram realtime handshake failed: {error}")),
    }
}

fn websocket_request(
    config: &DeepgramRealtimeConfig,
    sample_rate: u32,
    channels: u16,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let api_key = config.api_key.trim();
    if api_key.is_empty() {
        return Err("Deepgram API key is not configured.".to_string());
    }

    let mut request = websocket_url(config, sample_rate, channels)?
        .as_str()
        .into_client_request()
        .map_err(|error| format!("Invalid Deepgram websocket endpoint: {error}"))?;
    request.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&format!("Token {api_key}"))
            .map_err(|_| "Deepgram API key cannot be sent as an HTTP header.".to_string())?,
    );

    Ok(request)
}

fn websocket_url(
    config: &DeepgramRealtimeConfig,
    sample_rate: u32,
    channels: u16,
) -> Result<String, String> {
    let endpoint = config.endpoint.trim();
    if !(endpoint.starts_with("wss://") || endpoint.starts_with("ws://")) {
        return Err("Deepgram websocket endpoint must start with ws:// or wss://.".to_string());
    }

    let model_name = config.model_name.trim();
    let model_name = if model_name.is_empty() {
        DEFAULT_DEEPGRAM_REALTIME_MODEL
    } else {
        model_name
    };
    let separator = if endpoint.contains('?') { '&' } else { '?' };
    let params = [
        ("model", model_name.to_string()),
        ("encoding", "linear16".to_string()),
        ("sample_rate", sample_rate.to_string()),
        ("channels", channels.to_string()),
        ("interim_results", "true".to_string()),
        ("endpointing", "300".to_string()),
        ("utterance_end_ms", "1000".to_string()),
        ("vad_events", "true".to_string()),
        ("punctuate", "true".to_string()),
        ("smart_format", "true".to_string()),
        ("diarize", "true".to_string()),
        ("language", language_for_config(config).to_string()),
    ];
    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", query_escape(key), query_escape(value)))
        .collect::<Vec<_>>()
        .join("&");

    Ok(format!("{endpoint}{separator}{query}"))
}

fn language_for_config(config: &DeepgramRealtimeConfig) -> &str {
    let language = config.language.trim();
    if language.is_empty() {
        DEFAULT_DEEPGRAM_REALTIME_LANGUAGE
    } else {
        language
    }
}

async fn drain_available_server_messages<F>(
    reader: &mut SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    on_text: &mut F,
) -> Result<(), String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    while let Ok(Some(message)) = timeout(Duration::from_millis(1), reader.next()).await {
        let message = message.map_err(|error| format!("Deepgram realtime read failed: {error}"))?;
        let _ = handle_server_message(message, on_text)?;
    }

    Ok(())
}

fn handle_server_message<F>(message: Message, on_text: &mut F) -> Result<bool, String>
where
    F: FnMut(String, Option<String>, bool) + Send,
{
    match message {
        Message::Text(text) => {
            let value = serde_json::from_str::<Value>(&text)
                .map_err(|error| format!("Could not parse Deepgram realtime response: {error}"))?;
            if let Some(error) = extract_error_message(&value) {
                return Err(error);
            }
            if let Some(segment) = extract_transcript_segment(&value) {
                on_text(segment.text, segment.speaker, segment.final_phase);
            }
            Ok(false)
        }
        Message::Close(_) => Ok(true),
        _ => Ok(false),
    }
}

fn extract_transcript_segment(value: &Value) -> Option<TranscriptSegment> {
    if value.get("type").and_then(Value::as_str) != Some("Results") {
        return None;
    }

    let transcript = value
        .pointer("/channel/alternatives/0/transcript")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let speaker = value
        .pointer("/channel/alternatives/0/words")
        .and_then(dominant_speaker);
    let final_phase = value
        .get("is_final")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value
            .get("speech_final")
            .and_then(Value::as_bool)
            .unwrap_or(false);

    Some(TranscriptSegment {
        text: transcript.to_string(),
        speaker,
        final_phase,
    })
}

fn dominant_speaker(words: &Value) -> Option<String> {
    let words = words.as_array()?;
    let mut counts = Vec::<(String, usize)>::new();

    for word in words {
        let Some(speaker) = speaker_from_value(word.get("speaker")?) else {
            continue;
        };
        if let Some((_, count)) = counts.iter_mut().find(|(key, _)| key == &speaker) {
            *count += 1;
        } else {
            counts.push((speaker, 1));
        }
    }

    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(speaker, _)| speaker)
}

fn speaker_from_value(value: &Value) -> Option<String> {
    if let Some(index) = value.as_i64() {
        return Some(index.to_string());
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_error_message(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) != Some("Error") {
        return None;
    }

    value
        .get("description")
        .or_else(|| value.get("message"))
        .or_else(|| value.get("reason"))
        .and_then(Value::as_str)
        .map(|message| format!("Deepgram realtime error: {message}"))
        .or_else(|| Some("Deepgram realtime returned an error.".to_string()))
}

fn append_i16_samples(output: &mut Vec<u8>, samples: &[i16]) {
    output.reserve(samples.len() * 2);
    for sample in samples {
        output.extend_from_slice(&sample.to_le_bytes());
    }
}

fn query_escape(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                output.push(byte as char)
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_live_pcm_websocket_url() {
        let config = DeepgramRealtimeConfig::new("test-key").with_model_name("nova-3");

        let url = websocket_url(&config, 16_000, 1).unwrap();

        assert!(url.starts_with(DEFAULT_DEEPGRAM_REALTIME_ENDPOINT));
        assert!(url.contains("model=nova-3"));
        assert!(url.contains("encoding=linear16"));
        assert!(url.contains("sample_rate=16000"));
        assert!(url.contains("interim_results=true"));
        assert!(url.contains("diarize=true"));
        assert!(url.contains("language=zh"));
    }

    #[test]
    fn extracts_interim_transcript_and_dominant_speaker() {
        let value = json!({
            "type": "Results",
            "is_final": false,
            "speech_final": false,
            "channel": {
                "alternatives": [{
                    "transcript": "我正在测试实时转录",
                    "words": [
                        { "word": "我", "speaker": 1 },
                        { "word": "正在", "speaker": 1 },
                        { "word": "测试", "speaker": 2 }
                    ]
                }]
            }
        });

        assert_eq!(
            extract_transcript_segment(&value),
            Some(TranscriptSegment {
                text: "我正在测试实时转录".to_string(),
                speaker: Some("1".to_string()),
                final_phase: false,
            })
        );
    }

    #[test]
    fn treats_is_final_or_speech_final_as_final_phase() {
        let value = json!({
            "type": "Results",
            "is_final": false,
            "speech_final": true,
            "channel": {
                "alternatives": [{
                    "transcript": "这一句已经结束了。",
                    "words": [{ "word": "这一句", "speaker": 0 }]
                }]
            }
        });

        let segment = extract_transcript_segment(&value).unwrap();

        assert!(segment.final_phase);
        assert_eq!(segment.speaker, Some("0".to_string()));
    }

    #[test]
    fn ignores_empty_and_non_result_messages() {
        assert_eq!(
            extract_transcript_segment(&json!({
                "type": "Metadata",
                "duration": 1.2
            })),
            None
        );
        assert_eq!(
            extract_transcript_segment(&json!({
                "type": "Results",
                "channel": { "alternatives": [{ "transcript": "   " }] }
            })),
            None
        );
    }
}
