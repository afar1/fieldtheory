// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FieldTheoryDiarizer",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "FieldTheoryDiarizer", targets: ["FieldTheoryDiarizer"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            exact: "0.15.6"
        )
    ],
    targets: [
        .executableTarget(
            name: "FieldTheoryDiarizer",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ]
        )
    ]
)
