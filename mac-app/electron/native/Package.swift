// swift-tools-version:5.7
// =============================================================================
// Package.swift - Swift Package Manager configuration for FieldTheoryHelper.
// =============================================================================

import PackageDescription

let package = Package(
    name: "FieldTheoryHelper",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "FieldTheoryHelper", targets: ["FieldTheoryHelper"])
    ],
    dependencies: [],
    targets: [
        .target(
            name: "WebRTCVad",
            path: "Sources/WebRTCVad",
            sources: ["src"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("src")
            ]
        ),
        .executableTarget(
            name: "FieldTheoryHelper",
            dependencies: ["WebRTCVad"],
            path: "Sources/FieldTheoryHelper",
            exclude: ["GazeTrackingHelper.swift"],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("ScreenCaptureKit")
            ]
        )
    ]
)
