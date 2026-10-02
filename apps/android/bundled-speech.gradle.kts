import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import groovy.json.JsonOutput

// Pinned build-time downloads only. Recognition has no runtime download or network fallback.
val modelId = "sherpa-onnx-streaming-zipformer-en-2023-06-26"
val modelRevision = "672fbf1b30579d6585301139bb363f42a0ad4a24"
val modelUrl = "https://huggingface.co/csukuangfj/$modelId/resolve/$modelRevision"
val modelFiles = mapOf(
    "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx" to "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1",
    "decoder-epoch-99-avg-1-chunk-16-left-128.onnx" to "7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef",
    "joiner-epoch-99-avg-1-chunk-16-left-128.onnx" to "210591f72b3c56b8364f85f345dca240bc2b4c00632848f4aa923630d5639d3b",
    "tokens.txt" to "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
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
        val verifiedFiles = modelFiles.mapValues { (name, hash) -> pinnedDownload("$modelId/$name", "$modelUrl/$name", hash, 96L * 1024 * 1024) }
        val output = speechAssets.get().asFile.canonicalFile
        val buildRoot = layout.buildDirectory.get().asFile.canonicalFile
        check(output.toPath().startsWith(buildRoot.toPath()) && output != buildRoot) { "Generated assets must stay inside this app's build directory." }
        project.delete(output)
        val modelRoot = File(output, "speech-model/model").apply { mkdirs() }
        val records = mutableListOf<Map<String, Any>>()
        fun record(name: String, target: File) {
            check(target.length() <= 96L * 1024 * 1024) { "Bundled speech file exceeds its size limit." }
            records += mapOf("path" to name, "bytes" to target.length(), "sha256" to sha256(target))
        }
        for ((name, file) in verifiedFiles) {
            val target = File(modelRoot, name)
            file.copyTo(target); record(name, target)
        }
        for (name in listOf("bpe.vocab", "hotwords.txt")) {
            val target = File(modelRoot, name)
            project.file("src/main/speech-config/$name").copyTo(target)
            record(name, target)
        }
        File(output, "speech-model/manifest.json").writeText(JsonOutput.prettyPrint(JsonOutput.toJson(mapOf(
            "id" to modelId, "sourceRevision" to modelRevision, "source" to modelUrl,
            "license" to "Apache-2.0", "files" to records.sortedBy { it["path"].toString() }
        ))) + "\n")
        project.copy { from(project.file("src/main/speech-notices")); into(File(output, "speech-model/notices")) }
        logger.lifecycle("Bundled offline English model: " + modelId + " (" + records.size + " verified files)")
    }
}

// Optional synthetic Android-test corpus, generated locally by scripts/generate-bundled-speech-fixtures.ps1.
// Never copied into the application APK; missing fixtures fail the explicit native corpus test.
val speechTestAudio = rootProject.projectDir.resolve("../../.cache/bundled-speech/audio")
val prepareSpeechTestAudio = tasks.register<Sync>("prepareBundledSpeechTestAudio") {
    from(speechTestAudio) { include("*.wav", "manifest.json") }
    into(layout.buildDirectory.dir("generated/speechTestAssets/speech-fixtures"))
    onlyIf { speechTestAudio.isDirectory }
}
tasks.matching { it.name == "preDebugAndroidTestBuild" }.configureEach { dependsOn(prepareSpeechTestAudio) }
