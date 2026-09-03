# Field Theory offline diarization sidecar

`FieldTheoryDiarizer` is a separate Swift 6 executable for macOS 14 or later. It uses FluidAudio's complete-file Community-1 pipeline: powerset segmentation, WeSpeaker embeddings, PLDA, and VBx clustering.

The package pins FluidAudio 0.15.6. The configuration uses the documented high-accuracy settings: a `0.1` segmentation step ratio and `0.0` minimum segment duration. It keeps overlapping speaker intervals instead of forcing one active speaker.

## Build

```sh
cd mac-app/electron/diarization
swift build -c release
```

The development binary is `.build/release/FieldTheoryDiarizer`. A packaged app must copy that binary to `Contents/Resources/FieldTheoryDiarizer`; packaging is intentionally outside this isolated sidecar change.

## Protocol

The process writes one ready object, then accepts one JSON object per input line. Requests run serially.

```json
{"type":"diarize","audioPath":"/absolute/path/to/meeting.wav"}
```

A successful response contains only model-produced speaker cluster IDs and intervals:

```json
{"ok":true,"protocolVersion":1,"speakerCount":2,"segments":[{"speakerId":"S1","startTimeSeconds":0.42,"endTimeSeconds":4.18,"qualityScore":0.91}]}
```

An error is explicit and does not contain inferred speakers:

```json
{"ok":false,"protocolVersion":1,"error":"audio file does not exist: /path/to/file.wav"}
```

On first use, FluidAudio downloads and compiles the model into its default cache. Set `FIELD_THEORY_DIARIZATION_MODELS_DIR` to use a specific staged or persistent model directory. The audio file API uses FluidAudio's disk-backed source, so a long meeting is not loaded into memory as one sample array.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before distributing the binary or model files.
