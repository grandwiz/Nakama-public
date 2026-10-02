# Conversation recognition model provenance

Nakama packages the English-only Whisper base.en ONNX conversion published by
csukuangfj in the Sherpa-ONNX model collection. The int8 encoder and decoder and
token table are copied without modification from the pinned revision below.
The original OpenAI Whisper code and model weights are MIT licensed; the exact
upstream MIT text is retained as WHISPER-LICENSE.txt. The model publisher has no
README at this pinned revision; this file is Nakama's provenance record, not a
substitute upstream model card.

Publisher revision: 59eea950fc76df2453efb57e6c0fd334548e8ffe
https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base.en/tree/59eea950fc76df2453efb57e6c0fd334548e8ffe

Original code/weight license statement:
https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/README.md#license
Conversion and runtime project:
https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8/scripts/whisper

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| base.en-decoder.int8.onnx | 130669978 | f7162ad6db2dbef16cfaeaa7f945b9d7dd9c1b8d472f6aca82f2273d185e4d41 |
| base.en-encoder.int8.onnx | 29120534 | ef6b936f4c9b1d90a3b68634b60c4ed8576b26172b33c2535ec0e933c9edb823 |
| base.en-tokens.txt | 835554 | 306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930 |

## Speech activity detector

Silero VAD is distributed under the MIT license; see SILERO-VAD-LICENSE.txt.
Nakama uses the Sherpa-published ONNX artifact without modifying its bytes:
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx

Artifact bytes: 643854
SHA-256: 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6

This source URL is an upstream release asset; the checksum, rather than an
unversioned name alone, fixes the artifact used by the build. The Kotlin runtime
already contains the corresponding VAD and offline recognizer APIs. No Python,
PyTorch, tokenizer package or network recognition service is required on Android.
Audio is processed in bounded memory; no recording is stored. Only text from an
explicit Talk session or an authorized post-keyword utterance reaches the normal
command route. These models do not grant device-control permissions.
