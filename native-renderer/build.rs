use std::{env, path::PathBuf, process::Command};

fn run(command: &mut Command, label: &str) {
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("{label}: {error}"));
    assert!(status.success(), "{label} failed: {status}");
}

fn main() {
    println!("cargo:rerun-if-changed=src/mac_video_decoder.mm");
    println!("cargo:rerun-if-changed=src/mac_video_decoder.h");
    println!("cargo:rerun-if-changed=src/mac_video_recorder.mm");
    println!("cargo:rerun-if-changed=src/mac_video_recorder.h");
    println!("cargo:rerun-if-changed=src/mac_syphon_server.mm");
    println!("cargo:rerun-if-changed=src/mac_syphon_server.h");
    println!("cargo:rerun-if-changed=src/mac_live_capture.mm");
    println!("cargo:rerun-if-changed=src/mac_live_capture.h");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let object = output.join("mac_video_decoder.o");
    let recorder_object = output.join("mac_video_recorder.o");
    let syphon_object = output.join("mac_syphon_server.o");
    let capture_object = output.join("mac_live_capture.o");
    let library = output.join("libghost_mac_video_decoder.a");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("unsupported macOS architecture: {other:?}"),
    };
    let deployment = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "11.0".into());
    run(
        Command::new("xcrun")
            .args([
                "--sdk",
                "macosx",
                "clang++",
                "-std=c++17",
                "-fobjc-arc",
                "-fblocks",
                "-fvisibility=hidden",
                "-Wall",
                "-Wextra",
                "-Wno-deprecated-declarations",
                "-O2",
                "-arch",
                arch,
            ])
            .arg(format!("-mmacosx-version-min={deployment}"))
            .args(["-c", "src/mac_video_decoder.mm", "-o"])
            .arg(&object),
        "compile macOS hardware video decoder",
    );
    // In-core recording: AVAssetWriter encodes the composite IOSurface on the
    // GPU instead of the host reading every frame back to encode it.
    run(
        Command::new("xcrun")
            .args([
                "--sdk",
                "macosx",
                "clang++",
                "-std=c++17",
                "-fobjc-arc",
                "-fblocks",
                "-fvisibility=hidden",
                "-Wall",
                "-Wextra",
                "-Wno-deprecated-declarations",
                "-O2",
                "-arch",
                arch,
            ])
            .arg(format!("-mmacosx-version-min={deployment}"))
            .args(["-c", "src/mac_video_recorder.mm", "-o"])
            .arg(&recorder_object),
        "compile macOS hardware video recorder",
    );
    // Syphon out from the core: an OpenGL Syphon server fed by the core's
    // own IOSurface textures. The framework is opened at run time, so only
    // the system OpenGL framework is linked.
    run(
        Command::new("xcrun")
            .args([
                "--sdk",
                "macosx",
                "clang++",
                "-std=c++17",
                "-fobjc-arc",
                "-fblocks",
                "-fvisibility=hidden",
                "-Wall",
                "-Wextra",
                "-Wno-deprecated-declarations",
                "-O2",
                "-arch",
                arch,
            ])
            .arg(format!("-mmacosx-version-min={deployment}"))
            .args(["-c", "src/mac_syphon_server.mm", "-o"])
            .arg(&syphon_object),
        "compile macOS Syphon server",
    );
    // Live capture in the core: cameras (AVFoundation) and screens or
    // windows (ScreenCaptureKit), imported straight into source slots.
    run(
        Command::new("xcrun")
            .args([
                "--sdk",
                "macosx",
                "clang++",
                "-std=c++17",
                "-fobjc-arc",
                "-fblocks",
                "-fvisibility=hidden",
                "-Wall",
                "-Wextra",
                "-Wno-deprecated-declarations",
                "-O2",
                "-arch",
                arch,
            ])
            .arg(format!("-mmacosx-version-min={deployment}"))
            .args(["-c", "src/mac_live_capture.mm", "-o"])
            .arg(&capture_object),
        "compile macOS live capture",
    );
    run(
        Command::new("xcrun")
            .args(["ar", "crs"])
            .arg(&library)
            .arg(&object)
            .arg(&recorder_object)
            .arg(&syphon_object)
            .arg(&capture_object),
        "archive macOS hardware video decoder",
    );
    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static=ghost_mac_video_decoder");
    println!("cargo:rustc-link-lib=c++");
    for framework in [
        "AVFoundation",
        "VideoToolbox",
        "CoreMedia",
        "CoreVideo",
        "Foundation",
        "AppKit",
        "IOSurface",
        "OpenGL",
        "CoreGraphics",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    // ScreenCaptureKit is macOS 12.3+; weak so the core still starts on 11.
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
}
