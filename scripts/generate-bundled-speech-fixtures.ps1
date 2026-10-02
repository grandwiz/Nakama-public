# Render test fixtures using installed Windows desktop voices only.
# No microphone, audio playback, account, or network request is used.
[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../.cache/bundled-speech/audio'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
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
    @{ id='wake'; text='Nakama'; wake=$true },
    @{ id='hey-wake'; text='Hey Nakama'; wake=$true },
    @{ id='wake-time'; text='Hey Nakama, what time is it?'; wake=$true },
    @{ id='wake-timer'; text='Nakama, set a timer for five minutes.'; wake=$true },
    @{ id='talk-time'; text='What time is it?'; wake=$false },
    @{ id='talk-timer'; text='Set a timer for five minutes.'; wake=$false },
    @{ id='neutral'; text='The weather is pleasant today and the kettle is boiling.'; wake=$false },
    @{ id='hey-negative'; text='Hey, what time is it?'; wake=$false },
    @{ id='near-negative'; text='Knock on the door, and come inside.'; wake=$false }
)
$fixtureManifest = @()
try {
    $availableVoices = @($fixtureSynth.GetInstalledVoices() |
        Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name })
    foreach ($voice in $fixtureVoices) {
        if ($voice.name -notin $availableVoices) {
            throw "Required offline desktop voice unavailable: $($voice.name)"
        }
    }
    foreach ($voice in $fixtureVoices) {
        $fixtureSynth.SelectVoice($voice.name)
        foreach ($phrase in $fixturePhrases) {
            $file = $voice.id + '-' + $phrase.id + '.wav'
            $path = Join-Path $fixtureOutput $file
            $fixtureSynth.SetOutputToWaveFile($path, $fixtureFormat)
            $fixtureSynth.Speak($phrase.text)
            $fixtureSynth.SetOutputToNull()
            $fixtureManifest += [pscustomobject]@{
                file=$file; voice=$voice.name; phrase=$phrase.text
                expectedWake=$phrase.wake
                sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    }
} finally {
    $fixtureSynth.Dispose()
}
# expectedWake describes the spoken fixture, not a claim about decoder accuracy.
# Do not rewrite the expected phrase to match a recognizer's mistaken transcript.
[IO.File]::WriteAllText((Join-Path $fixtureOutput 'manifest.json'),
    ($fixtureManifest | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
Write-Output "Rendered $($fixtureManifest.Count) synthetic 16 kHz mono PCM16 fixtures into $fixtureOutput"
