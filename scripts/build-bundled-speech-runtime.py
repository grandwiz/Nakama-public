#!/usr/bin/env python3
"""Build the pinned, ASR-only Android JNI runtime; uses Python's standard library.

Run through build-bundled-speech-runtime.ps1 on Windows. Model weights are separate.
Build outputs and downloaded inputs remain under the ignored .cache directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache/bundled-speech"
VERSION = "1.13.8"
NDK_VERSION = "28.2.13676358"
CMAKE_VERSION = "3.22.1"
ABIS = ("x86_64", "arm64-v8a")
INPUTS = {
    "source": {"url": "https://codeload.github.com/k2-fsa/sherpa-onnx/zip/refs/tags/v1.13.8", "file": "sherpa-onnx-v1.13.8-source.zip", "sha256": "b63b7613812346f2d1396a3a7f94accd47539e3dadc3ea385ba6474c70ab9897"},
    "kotlinAar": {"url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-1.13.8.aar", "file": "sherpa-onnx-1.13.8.aar", "sha256": "633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96"},
    "onnxruntime": {"url": "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/onnxruntime-android-1.28.2.zip", "file": "onnxruntime-android-1.28.2.zip", "sha256": "01518867f78241138b6aa25925802e843a4fa9085af8d303d49e35bbb52aff4d"},
}
FLAGS = ["-DANDROID_PLATFORM=android-35", "-DANDROID_STL=c++_static", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON", "-DSHERPA_ONNX_ENABLE_TTS=OFF", "-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF", "-DSHERPA_ONNX_ENABLE_BINARY=OFF", "-DSHERPA_ONNX_ENABLE_PYTHON=OFF", "-DSHERPA_ONNX_ENABLE_TESTS=OFF", "-DSHERPA_ONNX_ENABLE_CHECK=OFF", "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF", "-DSHERPA_ONNX_ENABLE_JNI=ON", "-DSHERPA_ONNX_ENABLE_C_API=OFF", "-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF", "-DSHERPA_ONNX_ENABLE_RKNN=OFF", "-DSHERPA_ONNX_ENABLE_QNN=OFF", "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384"]
OUT = CACHE / f"sherpa-onnx-{VERSION}-asr-only.aar"
PROVENANCE = OUT.with_suffix(".provenance.json")


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def recipe():
    return {"schema": 1, "engine": VERSION, "ndk": NDK_VERSION, "cmake": CMAKE_VERSION, "abis": list(ABIS), "inputs": INPUTS, "flags": FLAGS, "builderSha256": sha(Path(__file__))}


def verified_cache():
    try:
        old = json.loads(PROVENANCE.read_text(encoding="utf-8"))
        return old["recipe"] == recipe() and old["outputSha256"] == sha(OUT)
    except (OSError, ValueError, KeyError):
        return False


def download(pin):
    dest = CACHE / pin["file"]
    if dest.exists():
        if sha(dest) != pin["sha256"]:
            raise RuntimeError(f"Pinned input hash mismatch: {dest}. Remove that file and retry.")
        return dest
    # CMake may already have fetched this exact, hash-pinned archive.
    for candidate in (CACHE / "native").glob("build-*/_deps/onnxruntime-subbuild/onnxruntime-populate-prefix/src/" + pin["file"]):
        if sha(candidate) == pin["sha256"]:
            shutil.copyfile(candidate, dest)
            return dest
    pending = dest.with_suffix(dest.suffix + ".download")
    print(f"Downloading {pin['url']}", flush=True)
    with urllib.request.urlopen(pin["url"], timeout=120) as response, pending.open("wb") as output:
        shutil.copyfileobj(response, output)
    if sha(pending) != pin["sha256"]:
        raise RuntimeError(f"Downloaded input hash mismatch: {pending}")
    pending.replace(dest)
    return dest


def extract(source_zip, target):
    # ZIP symlink entries are written as regular text, never followed or created.
    # Upstream sample-app symlinks are not inputs to this native JNI target.
    with zipfile.ZipFile(source_zip) as archive:
        for info in archive.infolist():
            dest = (target / info.filename).resolve()
            if not dest.is_relative_to(target.resolve()):
                raise RuntimeError(f"Unsafe archive path: {info.filename}")
            if info.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                data = archive.read(info)
                if not dest.exists() or dest.read_bytes() != data:
                    dest.write_bytes(data)


def elf_metadata(data):
    if data[:6] != b"\x7fELF\x02\x01":
        raise RuntimeError("Expected little-endian 64-bit ELF")
    phoff = struct.unpack_from("<Q", data, 32)[0]
    phentsize, phnum = struct.unpack_from("<HH", data, 54)
    loads, dynamic = [], None
    for i in range(phnum):
        ptype, pflags, offset, addr, _, filesz, memsz, align = struct.unpack_from("<IIQQQQQQ", data, phoff + i * phentsize)
        if ptype == 1:
            if align < 16384 or (addr - offset) % 16384:
                raise RuntimeError("ELF is not aligned for 16 KB pages")
            loads.append((offset, addr, filesz, align))
        elif ptype == 2:
            dynamic = (offset, filesz)
    if not loads or dynamic is None:
        raise RuntimeError("ELF lacks expected load/dynamic table")
    strtab, needed = None, []
    for pos in range(dynamic[0], sum(dynamic), 16):
        tag, val = struct.unpack_from("<QQ", data, pos)
        if tag == 0:
            break
        if tag == 5:
            strtab = val
        if tag == 1:
            needed.append(val)
    string_offset = next(offset + strtab - addr for offset, addr, size, _ in loads if strtab is not None and addr <= strtab < addr + size)
    libraries = [data[string_offset + val:].split(b"\0", 1)[0].decode("ascii") for val in needed]
    allowed = {"libandroid.so", "liblog.so", "libonnxruntime.so", "libm.so", "libdl.so", "libc.so"}
    if set(libraries) - allowed:
        raise RuntimeError(f"Unexpected native dependency: {libraries}")
    return {"needed": libraries, "loadAlignments": [x[3] for x in loads], "sha256": hashlib.sha256(data).hexdigest()}


def run(command, log):
    print("Running " + str(command[0]) + " (log: " + str(log) + ")", flush=True)
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run([str(x) for x in command], stdout=stream, stderr=subprocess.STDOUT, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); see {log}\n" + "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android-sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
    parser.add_argument("--jobs", type=int, default=min(6, os.cpu_count() or 2))
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if verified_cache():
        print(f"Verified ASR-only runtime: {OUT}")
        return
    if args.verify_only:
        raise RuntimeError("ASR-only runtime or matching provenance missing. Run scripts/build-bundled-speech-runtime.ps1 first.")
    if os.name != "nt":
        raise RuntimeError("This pinned toolchain builder currently supports Windows; use Windows Android SDK NDK 28.2.13676358 and CMake 3.22.1.")
    sdk = Path(args.android_sdk or Path(os.environ["LOCALAPPDATA"]) / "Android/Sdk")
    ndk = sdk / "ndk" / NDK_VERSION
    cmake = sdk / "cmake" / CMAKE_VERSION / "bin/cmake.exe"
    ninja = cmake.with_name("ninja.exe")
    strip = ndk / "toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe"
    for tool in (cmake, ninja, strip, ndk / "build/cmake/android.toolchain.cmake"):
        if not tool.is_file():
            raise RuntimeError(f"Missing pinned Android SDK tool: {tool}; install NDK {NDK_VERSION} and CMake {CMAKE_VERSION} with SDK Manager.")
    CACHE.mkdir(parents=True, exist_ok=True)
    source_zip, original_aar, ort_zip = [download(INPUTS[key]) for key in ("source", "kotlinAar", "onnxruntime")]
    native = CACHE / "native"
    source = native / f"sherpa-onnx-{VERSION}"
    # Re-extract the hash-checked upstream source, including upstream Android patches applied at configure time.
    extract(source_zip, native)
    shutil.copyfile(ort_zip, source / INPUTS["onnxruntime"]["file"])
    payload, library_info = {}, {}
    with zipfile.ZipFile(original_aar) as original:
        for info in original.infolist():
            if not info.is_dir() and not info.filename.startswith("jni/"):
                payload[info.filename] = original.read(info)
    with zipfile.ZipFile(ort_zip) as ort:
        for abi in ABIS:
            build = native / f"build-{abi}"
            build.mkdir(parents=True, exist_ok=True)
            run([cmake, "-S", source, "-B", build, "-G", "Ninja", f"-DCMAKE_MAKE_PROGRAM={ninja.as_posix()}", f"-DCMAKE_TOOLCHAIN_FILE={(ndk / 'build/cmake/android.toolchain.cmake').as_posix()}", f"-DANDROID_ABI={abi}", *FLAGS], native / f"configure-{abi}.log")
            run([cmake, "--build", build, "--target", "sherpa-onnx-jni", "--parallel", str(max(1, args.jobs))], native / f"build-{abi}.log")
            built = build / "lib/libsherpa-onnx-jni.so"
            stripped = build / "lib/libsherpa-onnx-jni-stripped.so"
            shutil.copyfile(built, stripped)
            subprocess.run([str(strip), "--strip-unneeded", str(stripped)], check=True)
            jni = stripped.read_bytes()
            if any(marker in jni for marker in (b"espeak_Initialize", b"espeak-ng-data", b"piper_phonemize")):
                raise RuntimeError("Unexpected TTS implementation in ASR-only JNI")
            matches = [name for name in ort.namelist() if name.endswith(f"jni/{abi}/libonnxruntime.so")]
            if len(matches) != 1:
                raise RuntimeError(f"ORT archive has unexpected entries for {abi}")
            for name, data in (("libsherpa-onnx-jni.so", jni), ("libonnxruntime.so", ort.read(matches[0]))):
                path = f"jni/{abi}/{name}"
                library_info[path] = elf_metadata(data)
                payload[path] = data
    pending = OUT.with_suffix(".pending.aar")
    with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name, data in sorted(payload.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, data)
    pending.replace(OUT)
    record = {"recipe": recipe(), "outputSha256": sha(OUT), "nativeLibraries": library_info, "note": "Source built with TTS OFF; standard AAR contributes Kotlin/resources only. ASR dependency download hashes are pinned by the verified upstream CMake source. Model assets are bundled separately."}
    PROVENANCE.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Built ASR-only runtime: {OUT}\nSHA-256: {record['outputSha256']}\nProvenance: {PROVENANCE}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bundled speech runtime: {error}", file=sys.stderr)
        sys.exit(1)
