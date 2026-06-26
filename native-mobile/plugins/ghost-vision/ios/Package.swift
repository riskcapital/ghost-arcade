// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GhostArcadeVision",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "GhostArcadeVision", targets: ["GhostArcadeVision"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "GhostArcadeVision",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "Sources/GhostArcadeVision",
            resources: [
                .process("PrivacyInfo.xcprivacy")
            ]
        )
    ]
)
