plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.nakama.companion"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "dev.nakama.companion"
        minSdk = 35
        targetSdk = 36
        ndk { abiFilters += setOf("arm64-v8a", "x86_64") }
        versionCode = 6
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/bundledSpeechAssets"))
    sourceSets.getByName("androidTest").assets.srcDir(layout.buildDirectory.dir("generated/speechTestAssets"))
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}

apply(from = rootProject.file("bundled-speech.gradle.kts"))
tasks.named("preBuild").configure { dependsOn("prepareBundledSpeechModel") }

dependencies {
    implementation(files(layout.buildDirectory.file("bundled-runtime/sherpa-onnx-1.13.8-asr-only.aar")).builtBy("prepareBundledSpeechRuntime"))
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui:1.8.2")
    implementation("androidx.compose.ui:ui-tooling-preview:1.8.2")
    implementation("androidx.compose.foundation:foundation:1.8.2")
    implementation("androidx.compose.material3:material3:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling:1.8.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
