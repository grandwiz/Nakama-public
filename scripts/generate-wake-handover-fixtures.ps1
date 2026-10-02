# Offline file rendering only: no microphone, playback, accounts, or network.
[CmdletBinding()]
param([string]$OutputDirectory = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../.cache/bundled-speech/audio/wake-handover' }
$fixtureOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $fixtureOutput | Out-Null
$fixtureSynth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$fixtureFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
$fixtureVoices = @(
    @{ id='hazel-gb'; name='Microsoft Hazel Desktop' },
    @{ id='zira-us'; name='Microsoft Zira Desktop' }
)
$fixturePhrases = @(
    @{ id='short-time'; text='Nakama, time.'; rate=0; command='time' },
    @{ id='short-greeting'; text='Hey Nakama, hello.'; rate=0; command='hello' },
    @{ id='slower-time'; text='Hey Nakama, what time is it?'; rate=-1; command='what time is it' },
    @{ id='faster-time'; text='Hey Nakama, what time is it?'; rate=1; command='what time is it' }
)
$fixtureManifest = @()
try {
    foreach ($voice in $fixtureVoices) {
        $fixtureSynth.SelectVoice($voice.name)
        foreach ($phrase in $fixturePhrases) {
            $fixtureSynth.Rate = $phrase.rate
            $file = $voice.id + '-' + $phrase.id + '.wav'
            $path = Join-Path $fixtureOutput $file
            $fixtureSynth.SetOutputToWaveFile($path, $fixtureFormat)
            $fixtureSynth.Speak($phrase.text)
            $fixtureSynth.SetOutputToNull()
            $fixtureManifest += [pscustomobject]@{
                file=$file; voice=$voice.name; phrase=$phrase.text; speechRate=$phrase.rate
                expectedWake=$true; expectedCommand=$phrase.command
                sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    }
} finally { $fixtureSynth.Dispose() }
[IO.File]::WriteAllText((Join-Path $fixtureOutput 'manifest.json'),
    ($fixtureManifest | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
Write-Output "Rendered $($fixtureManifest.Count) synthetic handover fixtures into $fixtureOutput"
