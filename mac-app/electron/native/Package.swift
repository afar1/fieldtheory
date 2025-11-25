// swift-tools-version:5.7
// =============================================================================
// Package.swift - Swift Package Manager configuration for LittleOneHelper.
// =============================================================================

import PackageDescription

let package = Package(
    name: "LittleOneHelper",
    platforms: [
        .macOS(.v11)
    ],
    products: [
        .executable(name: "LittleOneHelper", targets: ["LittleOneHelper"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "LittleOneHelper",
            dependencies: [],
            path: "Sources/LittleOneHelper",
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox")
            ]
        )
    ]
)
