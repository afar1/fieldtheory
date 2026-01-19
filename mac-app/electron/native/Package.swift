// swift-tools-version:5.7
// =============================================================================
// Package.swift - Swift Package Manager configuration for FieldTheoryHelper.
// =============================================================================

import PackageDescription

let package = Package(
    name: "FieldTheoryHelper",
    platforms: [
        .macOS(.v11)
    ],
    products: [
        .executable(name: "FieldTheoryHelper", targets: ["FieldTheoryHelper"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "FieldTheoryHelper",
            dependencies: [],
            path: "Sources/FieldTheoryHelper",
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox")
            ]
        )
    ]
)
