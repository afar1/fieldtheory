#!/bin/bash
#
# iOS-only trim of ../../build-xcframework.sh.
# Produces build-apple/whisper.xcframework with ios-arm64 (device) and
# ios-arm64_x86_64-simulator slices. Run from the repo root.

IOS_MIN_OS_VERSION=16.4

BUILD_SHARED_LIBS=OFF
WHISPER_BUILD_EXAMPLES=OFF
WHISPER_BUILD_TESTS=OFF
WHISPER_BUILD_SERVER=OFF
GGML_METAL=ON
GGML_METAL_EMBED_LIBRARY=ON
GGML_BLAS_DEFAULT=ON
GGML_METAL_USE_BF16=ON
GGML_OPENMP=OFF

COMMON_C_FLAGS="-Wno-macro-redefined -Wno-shorten-64-to-32 -Wno-unused-command-line-argument -g"
COMMON_CXX_FLAGS="-Wno-macro-redefined -Wno-shorten-64-to-32 -Wno-unused-command-line-argument -g"

COMMON_CMAKE_ARGS=(
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_REQUIRED=NO
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY=""
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO
    -DCMAKE_XCODE_ATTRIBUTE_DEBUG_INFORMATION_FORMAT="dwarf-with-dsym"
    -DCMAKE_XCODE_ATTRIBUTE_GCC_GENERATE_DEBUGGING_SYMBOLS=YES
    -DCMAKE_XCODE_ATTRIBUTE_COPY_PHASE_STRIP=NO
    -DCMAKE_XCODE_ATTRIBUTE_STRIP_INSTALLED_PRODUCT=NO
    -DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=ggml
    -DBUILD_SHARED_LIBS=${BUILD_SHARED_LIBS}
    -DWHISPER_BUILD_EXAMPLES=${WHISPER_BUILD_EXAMPLES}
    -DWHISPER_BUILD_TESTS=${WHISPER_BUILD_TESTS}
    -DWHISPER_BUILD_SERVER=${WHISPER_BUILD_SERVER}
    -DGGML_METAL_EMBED_LIBRARY=${GGML_METAL_EMBED_LIBRARY}
    -DGGML_BLAS_DEFAULT=${GGML_BLAS_DEFAULT}
    -DGGML_METAL=${GGML_METAL}
    -DGGML_METAL_USE_BF16=${GGML_METAL_USE_BF16}
    -DGGML_NATIVE=OFF
    -DGGML_OPENMP=${GGML_OPENMP}
)

set -e

rm -rf build-apple build-ios-sim build-ios-device

setup_framework_structure() {
    local build_dir=$1
    local min_os_version=$2
    local framework_name="whisper"

    echo "Creating ios-style framework structure for ${build_dir}"

    mkdir -p ${build_dir}/framework/${framework_name}.framework/Headers
    mkdir -p ${build_dir}/framework/${framework_name}.framework/Modules
    rm -rf ${build_dir}/framework/${framework_name}.framework/Versions

    local header_path=${build_dir}/framework/${framework_name}.framework/Headers/
    local module_path=${build_dir}/framework/${framework_name}.framework/Modules/

    cp include/whisper.h           ${header_path}
    cp ggml/include/ggml.h         ${header_path}
    cp ggml/include/ggml-alloc.h   ${header_path}
    cp ggml/include/ggml-backend.h ${header_path}
    cp ggml/include/ggml-metal.h   ${header_path}
    cp ggml/include/ggml-cpu.h     ${header_path}
    cp ggml/include/ggml-blas.h    ${header_path}
    cp ggml/include/gguf.h         ${header_path}

    cat > ${module_path}module.modulemap << EOF
framework module whisper {
    header "whisper.h"
    header "ggml.h"
    header "ggml-alloc.h"
    header "ggml-backend.h"
    header "ggml-metal.h"
    header "ggml-cpu.h"
    header "ggml-blas.h"
    header "gguf.h"

    link "c++"
    link framework "Accelerate"
    link framework "Metal"
    link framework "Foundation"

    export *
}
EOF

    local plist_path="${build_dir}/framework/${framework_name}.framework/Info.plist"
    cat > ${plist_path} << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>whisper</string>
    <key>CFBundleIdentifier</key>
    <string>org.ggml.whisper</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>whisper</string>
    <key>CFBundlePackageType</key>
    <string>FMWK</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>MinimumOSVersion</key>
    <string>${min_os_version}</string>
    <key>CFBundleSupportedPlatforms</key>
    <array>
        <string>iPhoneOS</string>
    </array>    <key>UIDeviceFamily</key>
    <array>
        <integer>1</integer>
        <integer>2</integer>
    </array>
    <key>DTPlatformName</key>
    <string>iphoneos</string>
    <key>DTSDKName</key>
    <string>iphoneos${min_os_version}</string>
</dict>
</plist>
EOF
}

combine_static_libraries() {
    local build_dir="$1"
    local release_dir="$2"
    local is_simulator="$3"
    local base_dir="$(pwd)"
    local framework_name="whisper"

    local output_lib="${build_dir}/framework/${framework_name}.framework/${framework_name}"

    local libs=(
        "${base_dir}/${build_dir}/src/${release_dir}/libwhisper.a"
        "${base_dir}/${build_dir}/ggml/src/${release_dir}/libggml.a"
        "${base_dir}/${build_dir}/ggml/src/${release_dir}/libggml-base.a"
        "${base_dir}/${build_dir}/ggml/src/${release_dir}/libggml-cpu.a"
        "${base_dir}/${build_dir}/ggml/src/ggml-metal/${release_dir}/libggml-metal.a"
        "${base_dir}/${build_dir}/ggml/src/ggml-blas/${release_dir}/libggml-blas.a"
        "${base_dir}/${build_dir}/src/${release_dir}/libwhisper.coreml.a"
    )

    local temp_dir="${base_dir}/${build_dir}/temp"
    mkdir -p "${temp_dir}"

    libtool -static -o "${temp_dir}/combined.a" "${libs[@]}" 2> /dev/null

    local sdk=""
    local archs=""
    local min_version_flag=""
    local install_name="@rpath/whisper.framework/whisper"
    local frameworks="-framework Foundation -framework Metal -framework Accelerate -framework CoreML"

    if [[ "$is_simulator" == "true" ]]; then
        sdk="iphonesimulator"
        archs="arm64 x86_64"
        min_version_flag="-mios-simulator-version-min=${IOS_MIN_OS_VERSION}"
    else
        sdk="iphoneos"
        archs="arm64"
        min_version_flag="-mios-version-min=${IOS_MIN_OS_VERSION}"
    fi

    local arch_flags=""
    for arch in $archs; do
        arch_flags+=" -arch $arch"
    done

    echo "Creating dynamic library for ios (${sdk})."
    xcrun -sdk $sdk clang++ -dynamiclib \
        -isysroot $(xcrun --sdk $sdk --show-sdk-path) \
        $arch_flags \
        $min_version_flag \
        -Wl,-force_load,"${temp_dir}/combined.a" \
        $frameworks \
        -install_name "$install_name" \
        -o "${base_dir}/${output_lib}"

    if [[ "$is_simulator" == "false" ]]; then
        echo "Marking binary as a framework binary for iOS..."
        xcrun vtool -set-build-version ios ${IOS_MIN_OS_VERSION} ${IOS_MIN_OS_VERSION} -replace \
            -output "${base_dir}/${output_lib}" "${base_dir}/${output_lib}"
    fi

    echo "Creating properly formatted dSYM..."
    mkdir -p "${base_dir}/${build_dir}/dSYMs"
    xcrun dsymutil "${base_dir}/${output_lib}" -o "${base_dir}/${build_dir}/dSYMs/whisper.dSYM"
    cp "${base_dir}/${output_lib}" "${temp_dir}/binary_to_strip"
    xcrun strip -S "${temp_dir}/binary_to_strip" -o "${temp_dir}/stripped_lib"
    mv "${temp_dir}/stripped_lib" "${base_dir}/${output_lib}"

    if [ -d "${base_dir}/${output_lib}.dSYM" ]; then
        rm -rf "${base_dir}/${output_lib}.dSYM"
    fi

    rm -rf "${temp_dir}"
}

echo "Building for iOS simulator..."
cmake -B build-ios-sim -G Xcode \
    "${COMMON_CMAKE_ARGS[@]}" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_MIN_OS_VERSION} \
    -DIOS=ON \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT=iphonesimulator \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
    -DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=iphonesimulator \
    -DCMAKE_C_FLAGS="${COMMON_C_FLAGS}" \
    -DCMAKE_CXX_FLAGS="${COMMON_CXX_FLAGS}" \
    -DWHISPER_COREML="ON" \
    -DWHISPER_COREML_ALLOW_FALLBACK="ON" \
    -S .
cmake --build build-ios-sim --config Release -- -quiet

echo "Building for iOS devices..."
cmake -B build-ios-device -G Xcode \
    "${COMMON_CMAKE_ARGS[@]}" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=${IOS_MIN_OS_VERSION} \
    -DCMAKE_OSX_SYSROOT=iphoneos \
    -DCMAKE_OSX_ARCHITECTURES="arm64" \
    -DCMAKE_XCODE_ATTRIBUTE_SUPPORTED_PLATFORMS=iphoneos \
    -DCMAKE_C_FLAGS="${COMMON_C_FLAGS}" \
    -DCMAKE_CXX_FLAGS="${COMMON_CXX_FLAGS}" \
    -DWHISPER_COREML="ON" \
    -DWHISPER_COREML_ALLOW_FALLBACK="ON" \
    -S .
cmake --build build-ios-device --config Release -- -quiet

echo "Setting up framework structures..."
setup_framework_structure "build-ios-sim" ${IOS_MIN_OS_VERSION}
setup_framework_structure "build-ios-device" ${IOS_MIN_OS_VERSION}

echo "Creating dynamic libraries from static libraries..."
combine_static_libraries "build-ios-sim" "Release-iphonesimulator" "true"
combine_static_libraries "build-ios-device" "Release-iphoneos" "false"

echo "Creating XCFramework..."
xcodebuild -create-xcframework \
    -framework $(pwd)/build-ios-sim/framework/whisper.framework \
    -debug-symbols $(pwd)/build-ios-sim/dSYMs/whisper.dSYM \
    -framework $(pwd)/build-ios-device/framework/whisper.framework \
    -debug-symbols $(pwd)/build-ios-device/dSYMs/whisper.dSYM \
    -output $(pwd)/build-apple/whisper.xcframework

echo "DONE: $(pwd)/build-apple/whisper.xcframework"
