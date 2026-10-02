# Bundled wake detector provenance

The dedicated wake detector uses the Apache-2.0 English model
`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`.
Its exact publisher README is retained as `KWS-MODEL-README.md`.

Official archive:
https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
Archive SHA-256: `f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a`

The three FP32 ONNX files and `tokens.txt` are copied without modification.
FP32 avoids making wake accuracy depend on platform-specific int8 arithmetic;
the network has approximately 3.3 million parameters. This choice does not
establish accuracy on every device or accent.

`wake-keywords.txt` was derived from this archive's `bpe.model` using the
publisher's documented SentencePiece encoding with SentencePiece 0.2.1.
The two source strings are exactly `NAKAMA` and `HEY NAKAMA`. Their output
labels are `NAKAMA` and `HEY_NAKAMA`; they are identifiers, not phonetic aliases.
The keyword file is UTF-8, LF, with one terminal newline.

Source bpe.model SHA-256:
`c8a2a0129c4ab8e463164c142f82d25649661b122c8cd0b7aab5c9e80b90ad24`
Derived keyword file SHA-256: `45398b856e336eada8acdc69fc2791e6cc8690e729f4ef721be7ad5fc350a26b`

Reproduction (build tooling only; no tokenizer package is required in Android):

```python
import sentencepiece as spm
sp = spm.SentencePieceProcessor(model_file="bpe.model")
for phrase, threshold in (("NAKAMA", "0.25"), ("HEY NAKAMA", "0.20")):
    print(" ".join(sp.encode(phrase, out_type=str)) + " #" + threshold + " @" + phrase.replace(" ", "_"))
```

The Sherpa KeywordSpotter configuration uses 16 kHz mono input, 80 feature bins,
CPU provider, one inference thread, eight active paths, keyword score 1.5,
per-keyword acoustic thresholds 0.25 for `NAKAMA` and 0.20 for `HEY NAKAMA`,
and two trailing blank frames. The longer phrase has more acoustic evidence;
its lower threshold admits the slower British synthetic phrase without relaxing
the bare-name threshold, which rejects the tested similar name "Nakamura".
The spotter emits only
configured keyword events; it does not transcribe ambient conversation.
Conversation transcription is a separate model activated for Talk or after wake.

Primary API and model documentation:
https://k2-fsa.github.io/sherpa/onnx/kws/index.html
https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html
https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/kotlin-api/KeywordSpotter.kt

Synthetic evaluation is a development check, not a promise of microphone,
accent, distance, or noise performance. Clean British and US fixtures covered
both wake forms and same-sentence requests. Near-word, silence, DC, and noise
negatives did not trigger in that corpus; quieter/noisier positive fixtures
still exposed misses. No alias matching or invented transcript corrects misses.

The expanded Windows native synthetic check covered 16 clean positive wake
fixtures, 26 spoken negative fixtures, and three acoustic controls: all 45
passed. Of 16 quieter/noisier positive variants, 12 passed and four were missed.
These are fixture measurements, not physical-device or real-user accuracy claims.
The Android integration suite separately checks real chunked inference and the
wake-to-command audio boundary, including after long idle periods.
