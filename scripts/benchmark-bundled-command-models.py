"""Exploratory Windows comparison of already-downloaded Sherpa Whisper models.

Uses only locally generated synthetic WAVs and a local Sherpa C API runtime.
Its approximate text metrics are diagnostics, not production parser acceptance.
The strict Android tests exercise the actual VAD, decoder and command parsers.
See apps/android/VERIFICATION.md for the authoritative acceptance commands.
"""
import ctypes as c, os, re, wave, array, json, sys, time, statistics
from pathlib import Path
root=Path(__file__).resolve().parent.parent;base=root/".cache/bundled-speech";corpus=base/"command-quality"
header=re.sub(r"/\*.*?\*/","",(base/"native/sherpa-onnx-1.13.8/sherpa-onnx/c-api/c-api.h").read_text(encoding="utf-8"),flags=re.S)
types={"int32_t":c.c_int32,"float":c.c_float,"const char *":c.c_char_p}
for name,body,end in re.findall(r"typedef struct (SherpaOnnx\w+)\s*\{(.*?)\}\s*(\w+)\s*;",header,re.S):
 if not (name.startswith("SherpaOnnxOffline") or name in ("SherpaOnnxFeatureConfig","SherpaOnnxHomophoneReplacerConfig")):continue
 fields=[]
 for field in body.split(";"):
  field=" ".join(field.split())
  if not field:continue
  m=re.fullmatch(r"(.+?)(\w+)",field);ty=m[1].strip()
  if ty not in types:break
  fields.append((m[2],types[ty]))
 else:types[name]=type(name,(c.Structure,),{"_fields_":fields})
libdir=base/"sherpa-onnx-v1.13.8-win-x64-shared-MT-Release/lib";dlldir=os.add_dll_directory(str(libdir));lib=c.CDLL(str(libdir/"sherpa-onnx-c-api.dll"));P=c.c_void_p
for key,args,result in [
 ("CreateOfflineRecognizer",[c.POINTER(types["SherpaOnnxOfflineRecognizerConfig"])],P),("DestroyOfflineRecognizer",[P],None),
 ("CreateOfflineStream",[P],P),("DestroyOfflineStream",[P],None),("AcceptWaveformOffline",[P,c.c_int32,c.POINTER(c.c_float),c.c_int32],None),
 ("DecodeOfflineStream",[P,P],None),("GetOfflineStreamResultAsJson",[P],P),("DestroyOfflineStreamResultJson",[P],None)]:
 fn=getattr(lib,"SherpaOnnx"+key);fn.argtypes=args;fn.restype=result;globals()[key]=fn
numbers={"1":"one","3":"three","5":"five","10":"ten","15":"fifteen","30":"thirty","90":"ninety"}
def norm(s):
 s=re.sub(r"[^a-z0-9]+"," ",s.lower().replace(chr(8217),chr(39)).replace(chr(39),"")).strip()
 return [numbers.get(w,w) for w in s.split()]
def wer(a,b):
 prev=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  cur=[i]
  for j,y in enumerate(b,1):cur.append(min(cur[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
  prev=cur
 return prev[-1]/max(1,len(a))
def meaning(f,text):
 words=norm(text);flat=" ".join(words);kind=f["kind"]
 if kind=="timer":
  if not words or words[0] not in ["set","start","create"] or "timer" not in words:return False
  vals={"one":1,"three":3,"five":5,"ten":10,"fifteen":15,"thirty":30,"ninety":90};duration=0
  for n,u in zip(words,words[1:]):
   if n in vals and re.fullmatch(r"(?:second|minute|hour)s?",u):duration+=vals[n]*({"s":1,"m":60,"h":3600}[u[0]])
  return duration==int(f["value"]) and ("tea" in words if f["file"].endswith("timertea.wav") else True)
 if kind=="control":return f["value"] in words and "timer" in words and "tea" in words
 if kind=="app":return words[:1]==["open"] and f["value"] in flat.replace(" ","")
 if kind=="remote":return words[:1]==["open"] and "netflix" in flat and "kitchen tablet" in flat
 if kind=="time":return flat=="what time is it"
 if kind=="date":return "date" in words and "today" in words
 if kind=="negative":return ("not" in words if f["value"]=="not" else not re.match(r"^(hey )?nakama\b",flat))
 return wer(norm(f["phrase"]),words)<=0.15
manifest=json.loads((corpus/"manifest.json").read_text(encoding="utf-8"))
for variantSpec in sys.argv[1:] or ["base.en"]:
 variant,_,tailSpec=variantSpec.partition(":");tail=int(tailSpec or "1000")
 folder=base/("sherpa-onnx-whisper-"+variant);cfg=types["SherpaOnnxOfflineRecognizerConfig"]()
 cfg.feat_config.sample_rate=16000;cfg.feat_config.feature_dim=80
 cfg.model_config.whisper.encoder=str(folder/(variant+"-encoder.int8.onnx")).encode();cfg.model_config.whisper.decoder=str(folder/(variant+"-decoder.int8.onnx")).encode()
 cfg.model_config.whisper.language=b"en";cfg.model_config.whisper.task=b"transcribe";cfg.model_config.whisper.tail_paddings=tail
 cfg.model_config.tokens=str(folder/(variant+"-tokens.txt")).encode();cfg.model_config.num_threads=2;cfg.model_config.provider=b"cpu";cfg.decoding_method=b"greedy_search";cfg.max_active_paths=4
 start=time.perf_counter();recognizer=CreateOfflineRecognizer(c.byref(cfg));assert recognizer;load=time.perf_counter()-start;rows=[]
 try:
  for f in manifest:
   with wave.open(str(corpus/f["file"]),"rb") as w:
    assert w.getnchannels()==1 and w.getsampwidth()==2 and w.getframerate()==16000
    data=array.array("h",w.readframes(w.getnframes()));duration=len(data)/16000
   pcm=(c.c_float*len(data))(*(v/32768 for v in data));s=CreateOfflineStream(recognizer);assert s
   try:
    t=time.perf_counter();AcceptWaveformOffline(s,16000,pcm,len(data));DecodeOfflineStream(recognizer,s);elapsed=time.perf_counter()-t;p=GetOfflineStreamResultAsJson(s)
    try:r=json.loads(c.string_at(p).decode("utf-8"))
    finally:DestroyOfflineStreamResultJson(p)
   finally:DestroyOfflineStream(s)
   row={**f,"text":r["text"].strip(),"seconds":elapsed,"duration":duration,"wer":wer(norm(f["phrase"]),norm(r["text"])),"meaning":meaning(f,r["text"])};rows.append(row)
   print(variant,f["file"],"PASS" if row["meaning"] else "FAIL",row["text"],flush=True)
 finally:DestroyOfflineRecognizer(recognizer)
 summary={"variant":variant,"tailPaddingFrames":tail,"loadSeconds":load,"records":len(rows),"meaningCorrect":sum(r["meaning"] for r in rows),"meanWer":statistics.mean(r["wer"] for r in rows),"medianDecodeSeconds":statistics.median(r["seconds"] for r in rows),"maxDecodeSeconds":max(r["seconds"] for r in rows),"byKind":{k:{"correct":sum(r["meaning"] for r in rows if r["kind"]==k),"total":sum(r["kind"]==k for r in rows)}for k in sorted({r["kind"] for r in rows})}}
 (corpus/("whisper-"+variant+"-padding"+str(tail)+"-results.json")).write_text(json.dumps({"summary":summary,"results":rows},indent=2),encoding="utf-8");print("SUMMARY",json.dumps(summary),flush=True)
