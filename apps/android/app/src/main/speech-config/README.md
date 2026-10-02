# Bundled wake keyword configuration

`wake-keywords.txt` contains only the exact names `NAKAMA` and `HEY NAKAMA`,
encoded with the publisher's English GigaSpeech 3.3M keyword model vocabulary.
The labels `NAKAMA` and `HEY_NAKAMA` identify those two phrases. There are no
phonetic aliases or replacement rules for similar words in a user's request.

The dedicated Sherpa KeywordSpotter uses the FP32 model, 16 kHz mono PCM,
80 feature bins, one CPU inference thread, eight active paths, keyword score
1.5, acoustic thresholds 0.25 for `NAKAMA` and 0.20 for the longer
`HEY NAKAMA`, and two trailing blank frames. Keyword detection
is separate from the on-demand conversation transcription model.

Keyword file SHA-256:
`45398b856e336eada8acdc69fc2791e6cc8690e729f4ef721be7ad5fc350a26b`

The exact model source, archive hash, tokenizer derivation and primary links are
recorded in `../speech-notices/KWS-PROVENANCE.md`. Ordinary Android builds use
the checked-in keyword text; they need no SentencePiece package or runtime
model download. The APK includes its verified model files.

The source-built runtime preserves the token clock when keyword history resets
after silence. JNI exposes absolute keyword timestamps by also including the
native segment offset, preserving their meaning throughout a long idle stream. This small integration change is recorded in the runtime
build recipe and provenance. No acoustic model weights or thresholds are
modified by that patch.

`scripts/generate-bundled-speech-fixtures.ps1` renders development-only British
and US fixtures using installed offline desktop voices. Outputs remain in
ignored `.cache/bundled-speech/audio`, including a separate `kws-extra` set of
near-word negatives. No microphone, playback, account, or network inference is
used. `scripts/generate-wake-handover-fixtures.ps1` adds short requests and
faster/slower speaking rates in a separate ignored `wake-handover` directory.
A synthetic fixture pass does not establish accuracy for every voice,
accent, distance, noise level, or Android microphone.
