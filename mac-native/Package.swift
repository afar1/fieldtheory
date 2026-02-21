// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FieldTheoryNative",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "FieldTheoryNativeApp", targets: ["FieldTheoryNativeApp"]),
    ],
    targets: [
        .executableTarget(
            name: "FieldTheoryNativeApp",
            path: "Sources/FieldTheoryNativeApp",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreAudio"),
                .linkedLibrary("sqlite3"),
            ]
        ),
        .testTarget(
            name: "FieldTheoryNativeAppTests",
            dependencies: ["FieldTheoryNativeApp"],
            path: "Tests/FieldTheoryNativeAppTests"
        ),
    ]
)
