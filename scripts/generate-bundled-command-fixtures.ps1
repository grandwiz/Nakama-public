$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$directory=Join-Path (Split-Path -Parent $PSScriptRoot) '.cache/bundled-speech/command-quality'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$phrases=@(
 @('timer10','Set a ten minute timer.','timer','600'),
 @('timer5','Set a timer for five minutes.','timer','300'),
 @('timer15','Start a fifteen minute timer.','timer','900'),
 @('timer90','Set a ninety second timer.','timer','90'),
 @('timerhour','Set a timer for one hour and thirty minutes.','timer','5400'),
 @('timertea','Set a three minute timer called tea.','timer','180'),
 @('timerpause','Pause the tea timer.','control','pause'),
 @('timerresume','Resume the tea timer.','control','resume'),
 @('timercancel','Cancel the tea timer.','control','cancel'),
 @('time','What time is it?','time',''),
 @('date','What is the date today?','date',''),
 @('netflix','Open Netflix.','app','netflix'),
 @('youtube','Open YouTube.','app','youtube'),
 @('spotify','Open Spotify.','app','spotify'),
 @('settings','Open Settings.','app','settings'),
 @('remote','Open Netflix on the kitchen tablet.','remote','netflix'),
 @('greeting','Hello, how are you?','greeting',''),
 @('question','What is the weather going to be like tomorrow morning?','conversation',''),
 @('question2','Can you explain why the sky looks blue?','conversation',''),
 @('request','Could you help me plan something nice for dinner tonight?','conversation',''),
 @('negation','Do not open Netflix.','negative','not'),
 @('negation2','Do not set a ten minute timer.','negative','not'),
 @('background','The kettle is boiling and the children are playing outside.','negative',''),
 @('background2','I have been reading about trains and railway stations.','negative','')
)
$voices=@(@('hazel','Microsoft Hazel Desktop'),@('george','Microsoft George'),@('susan','Microsoft Susan'))
$synth=[System.Speech.Synthesis.SpeechSynthesizer]::new()
$format=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$manifest=@()
try{
 foreach($voice in $voices){
  $synth.SelectVoice($voice[1]); $synth.Rate=0
  foreach($phrase in $phrases){
   $file=$voice[0]+'-'+$phrase[0]+'.wav'
   $path=Join-Path $directory $file
   $synth.SetOutputToWaveFile($path,$format); $synth.Speak($phrase[1]); $synth.SetOutputToNull()
   $manifest += [pscustomobject]@{file=$file;voice=$voice[1];phrase=$phrase[1];kind=$phrase[2];value=$phrase[3];sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
  }
 }
}finally{$synth.Dispose()}
[IO.File]::WriteAllText((Join-Path $directory 'manifest.json'),($manifest|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
Write-Output ("Created "+$manifest.Count+" synthetic British command/conversation fixtures.")
