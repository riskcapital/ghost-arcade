// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GhostArcadeOsc",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "GhostArcadeOsc", targets: ["GhostArcadeOsc"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "GhostArcadeOsc",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/GhostArcadeOsc",
            resources: [
                .process("PrivacyInfo.xcprivacy")
            ]
        )
    ]
)
