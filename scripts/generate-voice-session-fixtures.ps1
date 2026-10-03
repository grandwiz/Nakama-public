# Synthetic offline desktop speech only. Never records or plays microphone/audio.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.cache/bundled-speech/audio/voice-session'))
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$fixtureSynth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$fixtureFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$phrases = @(
    @{id='stop';text='Nakama stop.';stop=$true},
    @{id='stop-hey';text='Hey Nakama, stop.';stop=$true},
    @{id='stock';text='Nakama stock.';stop=$false},
    @{id='start';text='Nakama start.';stop=$false},
    @{id='timer';text='Nakama set a timer for five minutes.';stop=$false},
    @{id='near';text='Now come and stop.';stop=$false},
    @{id='bare';text='Stop.';stop=$false},
    @{id='tts';text='Your alarm is set for seven tomorrow. The weather is pleasant today.';stop=$false},
    @{id='follow';text='Set a timer for five minutes.';stop=$false}
)
$records = @()
try {
    foreach ($voice in @(@{id='hazel-gb';name='Microsoft Hazel Desktop'},@{id='zira-us';name='Microsoft Zira Desktop'})) {
        $fixtureSynth.SelectVoice($voice.name)
        foreach ($phrase in $phrases) {
            $file = "$($voice.id)-$($phrase.id).wav"; $target = Join-Path $fixtureRoot $file
            $fixtureSynth.SetOutputToWaveFile($target,$fixtureFormat); $fixtureSynth.Speak($phrase.text); $fixtureSynth.SetOutputToNull()
            $records += [pscustomobject]@{file=$file;phrase=$phrase.text;expectedStop=$phrase.stop;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()}
        }
    }
} finally { $fixtureSynth.Dispose() }
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'manifest.json'),($records | ConvertTo-Json -Depth 3),[Text.UTF8Encoding]::new($false))
Write-Output "Rendered $($records.Count) local synthetic voice-session fixtures."
