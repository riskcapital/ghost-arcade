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
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let object = output.join("mac_video_decoder.o");
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
    run(
        Command::new("xcrun")
            .args(["ar", "crs"])
            .arg(&library)
            .arg(&object),
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
        "IOSurface",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
