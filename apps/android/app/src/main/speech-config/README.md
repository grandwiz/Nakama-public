# Bundled speech vocabulary

`bpe.vocab` is the 500-piece vocabulary exported without changing the pieces or
scores from the publisher's `bpe.model` for the English streaming Zipformer model.
The original model is Apache-2.0 licensed. This is text configuration, not a
recording or a set of model weights.

Source: https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24/bpe.model
Source SHA-256: `c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5`
Vocabulary SHA-256: `f191a4935f668fa8cd8e607bcd378404f948321cd3134a5ea13d324ba921673d`

To reproduce using the publisher's supported method, install SentencePiece in a
separate build environment and run the tagged exporter:
https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/scripts/export_bpe_vocab.py

It emits each piece and its float32 score, separated by one tab, in model order.
The equivalent export used here read the ModelProto `pieces` messages (piece=1,
score=2), wrote UTF-8 with LF line endings, and verified all 500 pieces against
the model's token table. No SentencePiece library is required at app runtime or
for an ordinary Nakama build because the small derived vocabulary is checked in.

`hotwords.txt` provides contextual bias for the exact name, not spelling aliases.
Use `modified_beam_search`, `modelingUnit=bpe`, `maxActivePaths=8`, and
`hotwordsScore=3.0`. Recognition can still make errors; only finalized words
matching the ordinary strict wake rule can submit a request.

The offline fixture generator is `scripts/generate-bundled-speech-fixtures.ps1`.
Its outputs stay in ignored `.cache/bundled-speech/audio`. An expected wake flag
labels the spoken input; it must not be interpreted as a recognition test pass.
