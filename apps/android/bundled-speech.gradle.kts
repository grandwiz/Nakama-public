import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import groovy.json.JsonOutput

// Pinned build-time downloads only. Recognition has no runtime download or network fallback.
val modelId = "sherpa-onnx-whisper-base.en"
val modelRevision = "59eea950fc76df2453efb57e6c0fd334548e8ffe"
val modelUrl = "https://huggingface.co/csukuangfj/$modelId/resolve/$modelRevision"
val modelFiles = mapOf(
    "base.en-encoder.int8.onnx" to "ef6b936f4c9b1d90a3b68634b60c4ed8576b26172b33c2535ec0e933c9edb823",
    "base.en-decoder.int8.onnx" to "f7162ad6db2dbef16cfaeaa7f945b9d7dd9c1b8d472f6aca82f2273d185e4d41",
    "base.en-tokens.txt" to "306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930",
)
val wakeId = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
val wakeFiles = mapOf(
    "encoder-epoch-12-avg-2-chunk-16-left-64.onnx" to "063fbc1aeae8a9b574607a331a00e60371846ef9eaa3c1d9ea48176665dfc693",
    "decoder-epoch-12-avg-2-chunk-16-left-64.onnx" to "f61ebd3eed3773a44d088d53dfae92dbb6aec4839f4dcaee2d402414741663a3",
    "joiner-epoch-12-avg-2-chunk-16-left-64.onnx" to "0d7a37e749d8055223029318d6ffae82db1dae2d315d0892a68ba5dad17c1d2d",
    "tokens.txt" to "fd2ded4050a55d2b1578870ba8697d02371980217806b7558bd0a5cc60f3ba53",
)
val runtimeVersion = "1.13.8"
val runtimeName = "sherpa-onnx-$runtimeVersion-asr-only.aar"
val cache = rootProject.projectDir.resolve("../../.cache/bundled-speech").canonicalFile
val speechAssets = layout.buildDirectory.dir("generated/bundledSpeechAssets")
fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
fun pinnedDownload(name: String, url: String, checksum: String, limit: Long): File {
    val archive = File(cache, name)
    if (!archive.isFile) {
        check(!gradle.startParameter.isOffline) { "Bundled speech asset $name is not cached. Build once without --offline to fetch the pinned official release." }
        archive.parentFile.mkdirs()
        val partial = File(archive.parentFile, archive.name + ".part")
        try {
            val connection = URI(url).toURL().openConnection().apply { connectTimeout = 30_000; readTimeout = 120_000 }
            connection.getInputStream().buffered().use { input -> partial.outputStream().buffered().use { output ->
                var bytes = 0L; val buffer = ByteArray(64 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; bytes += count
                    check(bytes <= limit) { "Bundled speech download exceeds its size limit." }; output.write(buffer, 0, count) }
            } }
            check(sha256(partial) == checksum) { "Bundled speech download checksum mismatch." }
            Files.move(partial.toPath(), archive.toPath(), StandardCopyOption.REPLACE_EXISTING)
        } finally { partial.delete() }
    }
    check(sha256(archive) == checksum) { "Cached bundled speech asset $name failed checksum verification." }
    return archive
}

tasks.register("prepareBundledSpeechRuntime") {
    group = "build"
    inputs.property("runtimeVersion", runtimeVersion)
    inputs.files(rootProject.file("../../scripts/build-bundled-speech-runtime.py"), rootProject.file("../../scripts/build-bundled-speech-runtime.ps1"))
    inputs.file(rootProject.file("bundled-speech.gradle.kts"))
    val destination = layout.buildDirectory.file("bundled-runtime/$runtimeName")
    outputs.file(destination)
    doLast {
        val builder = rootProject.file("../../scripts/build-bundled-speech-runtime.py")
        val python = providers.environmentVariable("NAKAMA_PYTHON").orElse("python").get()
        project.exec {
            commandLine(listOf(python, builder.absolutePath) + if (gradle.startParameter.isOffline) listOf("--verify-only") else emptyList())
            workingDir(rootProject.projectDir.resolve("../.."))
        }
        val verified = File(cache, runtimeName)
        check(verified.isFile) { "The source-built ASR-only runtime is missing. See scripts/build-bundled-speech-runtime.ps1." }
        destination.get().asFile.apply { parentFile.mkdirs(); verified.copyTo(this, overwrite = true) }
    }
}

tasks.register("prepareBundledSpeechModel") {
    group = "build"
    description = "Verify and package the pinned offline English model (no runtime download)."
    inputs.property("modelId", modelId)
    inputs.property("modelRevision", modelRevision)
    inputs.file(rootProject.file("bundled-speech.gradle.kts"))
    inputs.dir(project.file("src/main/speech-notices"))
    inputs.dir(project.file("src/main/speech-config"))
    outputs.dir(speechAssets)
    doLast {
        val verifiedFiles = modelFiles.mapValues { (name, hash) -> pinnedDownload("$modelId/$name", "$modelUrl/$name", hash, 256L * 1024 * 1024) }
        val wakeArchive = pinnedDownload("$wakeId.tar.bz2",
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$wakeId.tar.bz2",
            "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a", 32L * 1024 * 1024)
        val wakeTree = project.tarTree(project.resources.bzip2(wakeArchive))
        val verifiedWake = wakeFiles.mapValues { (name, hash) ->
            wakeTree.matching { include("$wakeId/$name") }.singleFile.also {
                check(sha256(it) == hash) { "Bundled keyword file checksum mismatch." }
            }
        }
        val vad = pinnedDownload("silero_vad.onnx",
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
            "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6", 1024L * 1024)
        val output = speechAssets.get().asFile.canonicalFile
        val buildRoot = layout.buildDirectory.get().asFile.canonicalFile
        check(output.toPath().startsWith(buildRoot.toPath()) && output != buildRoot) { "Generated assets must stay inside this app's build directory." }
        project.delete(output)
        val modelRoot = File(output, "speech-model/model").apply { mkdirs() }
        val records = mutableListOf<Map<String, Any>>()
        fun record(name: String, target: File) {
            check(target.length() <= 256L * 1024 * 1024) { "Bundled speech file exceeds its size limit." }
            records += mapOf("path" to name, "bytes" to target.length(), "sha256" to sha256(target))
        }
        for ((name, file) in verifiedFiles) {
            val target = File(modelRoot, name)
            file.copyTo(target); record(name, target)
        }
        for ((name, file) in verifiedWake) {
            val target = File(modelRoot, "wake/$name").apply { parentFile.mkdirs() }
            file.copyTo(target); record("wake/$name", target)
        }
        val keywords = File(modelRoot, "wake/keywords.txt")
        project.file("src/main/speech-config/wake-keywords.txt").copyTo(keywords)
        record("wake/keywords.txt", keywords)
        val vadTarget = File(modelRoot, "silero_vad.onnx")
        vad.copyTo(vadTarget); record("silero_vad.onnx", vadTarget)
        File(output, "speech-model/manifest.json").writeText(JsonOutput.prettyPrint(JsonOutput.toJson(mapOf(
            "id" to "nakama-speech-base-en-kws-v2", "sourceRevision" to modelRevision, "source" to modelUrl,
            "license" to "MIT (Whisper, Silero); Apache-2.0 (KWS)", "files" to records.sortedBy { it["path"].toString() }
        ))) + "\n")
        project.copy { from(project.file("src/main/speech-notices")); into(File(output, "speech-model/notices")) }
        logger.lifecycle("Bundled offline English model: " + modelId + " (" + records.size + " verified files)")
    }
}

// Optional synthetic Android-test corpus, generated locally by scripts/generate-bundled-speech-fixtures.ps1.
// Never copied into the application APK; missing fixtures fail the explicit native corpus test.
val speechTestAudio = rootProject.projectDir.resolve("../../.cache/bundled-speech/audio")
val prepareSpeechTestAudio = tasks.register<Sync>("prepareBundledSpeechTestAudio") {
    from(speechTestAudio) { include("*.wav", "manifest.json", "kws-extra/*.wav", "kws-extra/manifest.json", "kws-trimmed/*.wav", "kws-trimmed/manifest.json", "wake-handover/*.wav", "wake-handover/manifest.json") }
    into(layout.buildDirectory.dir("generated/speechTestAssets/speech-fixtures"))
    onlyIf { speechTestAudio.isDirectory }
}
tasks.matching { it.name == "preDebugAndroidTestBuild" }.configureEach { dependsOn(prepareSpeechTestAudio) }

val commandTestAudio = rootProject.projectDir.resolve("../../.cache/bundled-speech/command-quality")
val prepareCommandTestAudio = tasks.register<Sync>("prepareBundledCommandTestAudio") {
    from(commandTestAudio) { include("*.wav", "manifest.json") }
    into(layout.buildDirectory.dir("generated/speechTestAssets/command-fixtures"))
    onlyIf { commandTestAudio.isDirectory }
}
tasks.matching { it.name == "preDebugAndroidTestBuild" }.configureEach { dependsOn(prepareCommandTestAudio) }
