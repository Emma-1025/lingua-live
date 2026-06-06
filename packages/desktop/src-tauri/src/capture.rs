use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream};
use serde::Serialize;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const MAX_FRAME_MS: u32 = 1_000;
const MAX_FRAME_SAMPLES: usize = (TARGET_SAMPLE_RATE as usize * MAX_FRAME_MS as usize) / 1000;

#[derive(Debug, Clone, Serialize)]
pub struct AudioSourceDto {
    pub id: String,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioFrameDto {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub seq: u64,
    #[serde(rename = "capturedAt")]
    pub captured_at: u128,
    pub pcm: Vec<f32>,
    #[serde(rename = "durationMs")]
    pub duration_ms: u32,
}

enum CaptureCommand {
    Stop,
}

struct CaptureWorkerState {
    stop_tx: Option<Sender<CaptureCommand>>,
    worker: Option<JoinHandle<()>>,
}

pub struct CaptureManager {
    inner: Mutex<CaptureWorkerState>,
}

impl CaptureManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(CaptureWorkerState {
                stop_tx: None,
                worker: None,
            }),
        }
    }

    pub fn list_sources(&self) -> Result<Vec<AudioSourceDto>, String> {
        let host = cpal::default_host();
        let mut sources = Vec::new();

        if let Some(device) = host.default_input_device() {
            let label = device.name().unwrap_or_else(|_| "Default microphone".to_string());
            sources.push(AudioSourceDto {
                id: "microphone:default".to_string(),
                label,
                kind: "microphone".to_string(),
            });
        }

        for (index, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
            let name = device.name().unwrap_or_else(|_| format!("Input {index}"));
            let lowered = name.to_lowercase();
            if lowered.contains("monitor") || lowered.contains("loopback") {
                sources.push(AudioSourceDto {
                    id: format!("system:{index}"),
                    label: name,
                    kind: "system".to_string(),
                });
            }
        }

        if !sources.iter().any(|source| source.kind == "system") {
            sources.push(AudioSourceDto {
                id: "system:default".to_string(),
                label: "System playback (monitor device if available)".to_string(),
                kind: "system".to_string(),
            });
        }

        Ok(sources)
    }

    pub fn start(
        &self,
        app: AppHandle,
        session_id: String,
        source_kind: String,
        device_id: Option<String>,
    ) -> Result<(), String> {
        self.stop()?;

        let host = cpal::default_host();
        let device = resolve_device(&host, &source_kind, device_id.as_deref())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("No supported input config: {e}"))?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        let sample_format = config.sample_format();
        let stream_config: cpal::StreamConfig = config.into();

        let (cmd_tx, cmd_rx) = mpsc::channel::<CaptureCommand>();
        let app_for_thread = app.clone();
        let session_for_thread = session_id.clone();

        let worker = thread::spawn(move || {
            let frame_emitter = FrameEmitter::new(app_for_thread, session_for_thread);
            let stream_result = match sample_format {
                SampleFormat::F32 => build_stream::<f32>(
                    &device,
                    stream_config,
                    channels,
                    sample_rate,
                    frame_emitter.clone(),
                    app.clone(),
                ),
                SampleFormat::I16 => build_stream::<i16>(
                    &device,
                    stream_config,
                    channels,
                    sample_rate,
                    frame_emitter.clone(),
                    app.clone(),
                ),
                SampleFormat::U16 => build_stream::<u16>(
                    &device,
                    stream_config,
                    channels,
                    sample_rate,
                    frame_emitter,
                    app,
                ),
                _ => Err("Unsupported sample format".to_string()),
            };

            let stream = match stream_result {
                Ok(stream) => stream,
                Err(_) => return,
            };

            if stream.play().is_err() {
                return;
            }

            let _ = cmd_rx.recv();
            drop(stream);
        });

        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        guard.stop_tx = Some(cmd_tx);
        guard.worker = Some(worker);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(stop_tx) = guard.stop_tx.take() {
            let _ = stop_tx.send(CaptureCommand::Stop);
        }
        if let Some(worker) = guard.worker.take() {
            let _ = worker.join();
        }
        Ok(())
    }
}

#[derive(Clone)]
struct FrameEmitter {
    app: AppHandle,
    session_id: String,
    seq: std::sync::Arc<Mutex<u64>>,
    pending: std::sync::Arc<Mutex<Vec<f32>>>,
}

impl FrameEmitter {
    fn new(app: AppHandle, session_id: String) -> Self {
        Self {
            app,
            session_id,
            seq: std::sync::Arc::new(Mutex::new(0)),
            pending: std::sync::Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn push_samples(&self, samples: Vec<f32>) {
        let Ok(mut pending) = self.pending.lock() else {
            return;
        };
        pending.extend(samples);

        let Ok(mut seq) = self.seq.lock() else {
            return;
        };

        while pending.len() >= MAX_FRAME_SAMPLES {
            let chunk: Vec<f32> = pending.drain(0..MAX_FRAME_SAMPLES).collect();
            let frame = AudioFrameDto {
                session_id: self.session_id.clone(),
                seq: *seq,
                captured_at: current_millis(),
                pcm: chunk,
                duration_ms: MAX_FRAME_MS,
            };
            *seq += 1;
            let _ = self.app.emit("audio-frame", frame);
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: u16,
    sample_rate: u32,
    emitter: FrameEmitter,
    app_for_error: AppHandle,
) -> Result<Stream, String>
where
    T: Sample + Copy + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            &config,
            move |data: &[T], _| {
                let mono = stereo_to_mono(data, channels);
                let resampled = downsample_to_16k(mono, sample_rate);
                emitter.push_samples(resampled);
            },
            move |_err| {
                let _ = app_for_error.emit("audio-source-lost", "device_disconnect");
            },
            None,
        )
        .map_err(|e| e.to_string())
}

fn resolve_device(
    host: &cpal::Host,
    source_kind: &str,
    device_id: Option<&str>,
) -> Result<cpal::Device, String> {
    if source_kind == "microphone" {
        if let Some(id) = device_id {
            if id != "microphone:default" {
                if let Ok(index) = id.trim_start_matches("microphone:").parse::<usize>() {
                    if let Some(device) = host
                        .input_devices()
                        .map_err(|e| e.to_string())?
                        .nth(index)
                    {
                        return Ok(device);
                    }
                }
            }
        }
        return host
            .default_input_device()
            .ok_or_else(|| "No microphone device available".to_string());
    }

    if let Some(id) = device_id {
        if let Ok(index) = id.trim_start_matches("system:").parse::<usize>() {
            let monitors: Vec<_> = host
                .input_devices()
                .map_err(|e| e.to_string())?
                .enumerate()
                .filter_map(|(idx, device)| {
                    let name = device.name().ok()?;
                    let lowered = name.to_lowercase();
                    if lowered.contains("monitor") || lowered.contains("loopback") {
                        Some((idx, device))
                    } else {
                        None
                    }
                })
                .collect();

            if let Some((_, device)) = monitors.into_iter().find(|(idx, _)| *idx == index) {
                return Ok(device);
            }
        }
    }

    host.input_devices()
        .map_err(|e| e.to_string())?
        .find(|device| {
            device
                .name()
                .map(|name| {
                    let lowered = name.to_lowercase();
                    lowered.contains("monitor") || lowered.contains("loopback")
                })
                .unwrap_or(false)
        })
        .or_else(|| host.default_input_device())
        .ok_or_else(|| "No system loopback or monitor device available".to_string())
}

fn stereo_to_mono<T>(samples: &[T], channels: u16) -> Vec<f32>
where
    T: Sample + Copy + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channel_count = channels as usize;
    if channel_count <= 1 {
        return samples.iter().map(|sample| f32::from_sample(*sample)).collect();
    }

    samples
        .chunks(channel_count)
        .map(|chunk| {
            let sum: f32 = chunk.iter().map(|sample| f32::from_sample(*sample)).sum();
            sum / channel_count as f32
        })
        .collect()
}

fn downsample_to_16k(samples: Vec<f32>, source_rate: u32) -> Vec<f32> {
    if source_rate == TARGET_SAMPLE_RATE {
        return samples;
    }

    let ratio = source_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let mut output = Vec::new();
    let mut position = 0.0;
    while (position as usize) < samples.len() {
        output.push(samples[position as usize]);
        position += ratio;
    }
    output
}

fn current_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
