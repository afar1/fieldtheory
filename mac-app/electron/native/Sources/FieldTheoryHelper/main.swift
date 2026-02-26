// =============================================================================
// FieldTheoryHelper - Swift CLI for CoreAudio integration.
// Communicates with Electron via JSON over stdin/stdout.
// =============================================================================

import Foundation
import CoreAudio
import AudioToolbox
import AVFoundation
import ApplicationServices
import AppKit

// MARK: - Data Models

/// Represents an audio device as reported to Electron.
struct Device: Codable {
    let id: String
    let name: String
    let isInput: Bool
    let isOutput: Bool
    let manufacturer: String?
    let transportType: String?
}

/// Message types received from Electron.
enum MessageType: String, Codable {
    case getDevices
    case getDefaultInput
    case setDefaultInput
    case startMonitoring
    case startRecording
    case stopRecording
    case snapshotRecording
    case cancelRecording
    case checkPermissions
    case checkFocusedTextInput
    case getFrontmostWindowBounds
    // Sound playback
    case preloadSounds
    case playSound
    case stopSounds
    // Text injection
    case typeIntoApp
    // Window focus by title
    case focusWindowByTitle
    // Silence detection harvest mode
    case setHarvestMode
    // Window management (Squares)
    case setWindowFrame
    case getWindowList
    // Gaze tracking
    case startGazeTracking
    case stopGazeTracking
    case getGazeTrackingStatus
}

/// Message received from Electron.
struct IncomingMessage: Codable {
    let type: MessageType
    let deviceId: String?
    let soundPath: String?      // For playSound
    let soundPaths: [String]?   // For preloadSounds
    let bundleId: String?       // For typeIntoApp, focusWindowByTitle
    let text: String?           // For typeIntoApp
    let pressEnter: Bool?       // For typeIntoApp
    let titleSubstring: String? // For focusWindowByTitle
    let mode: String?           // For setHarvestMode ("command" or "dictation")
    // Window management (Squares)
    let pid: Int32?             // For setWindowFrame
    let title: String?          // For setWindowFrame
    let x: Int?                 // For setWindowFrame
    let y: Int?                 // For setWindowFrame
    let width: Int?             // For setWindowFrame
    let height: Int?            // For setWindowFrame
    let sourceX: Int?           // Optional source frame for disambiguating duplicate titles
    let sourceY: Int?           // Optional source frame for disambiguating duplicate titles
    let sourceWidth: Int?       // Optional source frame for disambiguating duplicate titles
    let sourceHeight: Int?      // Optional source frame for disambiguating duplicate titles
    let targetFps: Int?         // For startGazeTracking
}

// MARK: - Outgoing Message Types

struct DevicesChangedMessage: Codable {
    let type = "devicesChanged"
    let devices: [Device]
    
    enum CodingKeys: String, CodingKey {
        case type
        case devices
    }
}

struct DefaultInputChangedMessage: Codable {
    let type = "defaultInputChanged"
    let deviceId: String?
    
    enum CodingKeys: String, CodingKey {
        case type
        case deviceId
    }
}

struct LogMessage: Codable {
    let type = "log"
    let level: String
    let message: String
    
    enum CodingKeys: String, CodingKey {
        case type
        case level
        case message
    }
}

struct ErrorMessage: Codable {
    let type = "error"
    let message: String
    
    enum CodingKeys: String, CodingKey {
        case type
        case message
    }
}

struct RecordingStartedMessage: Codable {
    let type = "recordingStarted"
    
    enum CodingKeys: String, CodingKey {
        case type
    }
}

struct RecordingStoppedMessage: Codable {
    let type = "recordingStopped"
    let filePath: String
    
    enum CodingKeys: String, CodingKey {
        case type
        case filePath
    }
}

struct RecordingSnapshotMessage: Codable {
    let type = "recordingSnapshot"
    let filePath: String

    enum CodingKeys: String, CodingKey {
        case type
        case filePath
    }
}

struct RecordingChunkReadyMessage: Codable {
    let type = "recordingChunkReady"
    let filePath: String

    enum CodingKeys: String, CodingKey {
        case type
        case filePath
    }
}

struct RecordingCancelledMessage: Codable {
    let type = "recordingCancelled"
    
    enum CodingKeys: String, CodingKey {
        case type
    }
}

struct AudioLevelMessage: Codable {
    let type = "audioLevel"
    let level: Double  // 0.0 to 1.0
    let isSpeech: Bool

    enum CodingKeys: String, CodingKey {
        case type
        case level
        case isSpeech
    }
}

struct PermissionsStatusMessage: Codable {
    let type = "permissionsStatus"
    let accessibilityGranted: Bool
    
    enum CodingKeys: String, CodingKey {
        case type
        case accessibilityGranted
    }
}

struct FocusedTextInputStatusMessage: Codable {
    let type = "focusedTextInputStatus"
    let hasTextInput: Bool
    
    enum CodingKeys: String, CodingKey {
        case type
        case hasTextInput
    }
}

/// Response with the frontmost window bounds (on-demand request).
struct FrontmostWindowBoundsMessage: Codable {
    let type = "frontmostWindowBounds"
    let windowBounds: WindowBounds?

    struct WindowBounds: Codable {
        let x: Int
        let y: Int
        let width: Int
        let height: Int
    }

    enum CodingKeys: String, CodingKey {
        case type
        case windowBounds
    }
}

/// Response after preloading sounds.
struct SoundsPreloadedMessage: Codable {
    let type = "soundsPreloaded"
    let count: Int

    enum CodingKeys: String, CodingKey {
        case type
        case count
    }
}

/// Result of typing text into an app.
struct TypeIntoAppResultMessage: Codable {
    let type = "typeIntoAppResult"
    let success: Bool
    let error: String?

    enum CodingKeys: String, CodingKey {
        case type
        case success
        case error
    }
}

/// Result of focusing a window by title.
struct FocusWindowByTitleResultMessage: Codable {
    let type = "focusWindowByTitleResult"
    let success: Bool
    let error: String?

    enum CodingKeys: String, CodingKey {
        case type
        case success
        case error
    }
}

/// Result of setWindowFrame command.
struct WindowFrameSetMessage: Codable {
    let type = "windowFrameSet"
    let success: Bool

    enum CodingKeys: String, CodingKey {
        case type
        case success
    }
}

/// Window info returned by getWindowList.
struct WindowListEntry: Codable {
    let windowId: Int
    let ownerName: String
    let ownerPID: Int32
    let ownerBundleId: String
    let title: String
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let layer: Int
}

/// Response to getWindowList command.
struct WindowListMessage: Codable {
    let type = "windowList"
    let windows: [WindowListEntry]

    enum CodingKeys: String, CodingKey {
        case type
        case windows
    }
}

// MARK: - Window Animator (Squares)

/// Manages window frame manipulation via the Accessibility API.
/// Provides sub-millisecond frame setting for instant window snapping.
final class WindowAnimator {

    static let shared = WindowAnimator()

    private init() {}

    // MARK: - AXUIElement Resolution

    /// Find the AXUIElement for a window by PID and title.
    /// If sourceFrame is provided, use it to disambiguate duplicate titles.
    /// Returns nil if no matching window is found.
    private func findWindow(pid: pid_t, title: String, sourceFrame: CGRect?) -> AXUIElement? {
        let appElement = AXUIElementCreateApplication(pid)

        var windowsValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsValue)

        guard result == .success, let windows = windowsValue as? [AXUIElement] else {
            return nil
        }

        // Try exact title match first.
        var titleMatches: [AXUIElement] = []
        for window in windows {
            var titleValue: CFTypeRef?
            let titleResult = AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue)
            if titleResult == .success, let windowTitle = titleValue as? String, windowTitle == title {
                titleMatches.append(window)
            }
        }

        // If we know the source frame, use it to disambiguate duplicate titles.
        if let sourceFrame {
            if let exactTitleAndFrame = titleMatches.first(where: { window in
                guard let frame = getWindowFrame(window) else { return false }
                return frameApproximatelyEqual(frame, sourceFrame)
            }) {
                return exactTitleAndFrame
            }

            // Title may have changed between discovery and move; fall back to frame-only match.
            if let frameOnlyMatch = windows.first(where: { window in
                guard let frame = getWindowFrame(window) else { return false }
                return frameApproximatelyEqual(frame, sourceFrame)
            }) {
                return frameOnlyMatch
            }
        }

        if let firstTitleMatch = titleMatches.first {
            return firstTitleMatch
        }

        // Fallback: return the first window (frontmost) if title didn't match.
        return windows.first
    }

    /// Read a window's current frame from AX attributes.
    private func getWindowFrame(_ window: AXUIElement) -> CGRect? {
        var posValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        let posResult = AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posValue)
        let sizeResult = AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue)

        guard
            posResult == .success,
            sizeResult == .success,
            let posRef = posValue,
            let sizeRef = sizeValue,
            CFGetTypeID(posRef) == AXValueGetTypeID(),
            CFGetTypeID(sizeRef) == AXValueGetTypeID()
        else {
            return nil
        }

        let posAX = unsafeBitCast(posRef, to: AXValue.self)
        let sizeAX = unsafeBitCast(sizeRef, to: AXValue.self)

        var position = CGPoint.zero
        var size = CGSize.zero
        guard
            AXValueGetType(posAX) == .cgPoint,
            AXValueGetType(sizeAX) == .cgSize,
            AXValueGetValue(posAX, .cgPoint, &position),
            AXValueGetValue(sizeAX, .cgSize, &size)
        else {
            return nil
        }

        return CGRect(origin: position, size: size)
    }

    /// Tolerant frame comparison (avoids sub-pixel / rounding mismatches).
    private func frameApproximatelyEqual(_ a: CGRect, _ b: CGRect, tolerance: CGFloat = 2.0) -> Bool {
        abs(a.origin.x - b.origin.x) <= tolerance &&
        abs(a.origin.y - b.origin.y) <= tolerance &&
        abs(a.size.width - b.size.width) <= tolerance &&
        abs(a.size.height - b.size.height) <= tolerance
    }

    /// Set a window's frame (position + size) using the Accessibility API.
    /// Returns true if successful.
    func setFrame(
        pid: pid_t,
        title: String,
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        sourceFrame: CGRect? = nil
    ) -> Bool {
        guard let window = findWindow(pid: pid, title: title, sourceFrame: sourceFrame) else {
            return false
        }

        return setFrameOnElement(window, x: x, y: y, width: width, height: height)
    }

    /// Set frame directly on an already-resolved AXUIElement.
    private func setFrameOnElement(_ window: AXUIElement, x: Int, y: Int, width: Int, height: Int) -> Bool {
        // Set position first, then size (order matters for some apps).
        var position = CGPoint(x: CGFloat(x), y: CGFloat(y))
        guard let posValue = AXValueCreate(.cgPoint, &position) else { return false }
        AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)

        var size = CGSize(width: CGFloat(width), height: CGFloat(height))
        guard let sizeValue = AXValueCreate(.cgSize, &size) else { return false }
        AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)

        return true
    }

    // MARK: - Window List

    /// Get all on-screen windows with their info (replaces JXA window discovery).
    func getWindowList() -> [WindowListEntry] {
        guard let windowList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return []
        }

        // Build a PID -> bundleId map from running applications.
        var pidToBundleId: [pid_t: String] = [:]
        for app in NSWorkspace.shared.runningApplications {
            if let bundleId = app.bundleIdentifier {
                pidToBundleId[app.processIdentifier] = bundleId
            }
        }

        var entries: [WindowListEntry] = []

        for windowInfo in windowList {
            guard let layer = windowInfo[kCGWindowLayer as String] as? Int,
                  layer == 0,
                  let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? pid_t,
                  let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
                  let bx = boundsDict["X"],
                  let by = boundsDict["Y"],
                  let bw = boundsDict["Width"],
                  let bh = boundsDict["Height"],
                  bw > 50, bh > 50 else {
                continue
            }

            let ownerName = (windowInfo[kCGWindowOwnerName as String] as? String) ?? ""
            let windowId = (windowInfo[kCGWindowNumber as String] as? Int) ?? 0
            let title = (windowInfo[kCGWindowName as String] as? String) ?? ""
            let bundleId = pidToBundleId[ownerPID] ?? ""

            entries.append(WindowListEntry(
                windowId: windowId,
                ownerName: ownerName,
                ownerPID: ownerPID,
                ownerBundleId: bundleId,
                title: title,
                x: Int(bx),
                y: Int(by),
                width: Int(bw),
                height: Int(bh),
                layer: layer
            ))
        }

        return entries
    }
}

// MARK: - CoreAudio Helper

final class CoreAudioHelper {
    
    /// The singleton instance.
    static let shared = CoreAudioHelper()
    
    /// Property listener callbacks - stored to prevent deallocation.
    private var deviceListListener: AudioObjectPropertyListenerProc?
    private var defaultInputListener: AudioObjectPropertyListenerProc?
    
    /// Flag to track if monitoring is active.
    private var isMonitoring = false
    
    private init() {}
    
    // MARK: - Device Enumeration
    
    /// Get all audio devices in the system.
    func listDevices() -> [Device] {
        var devices: [Device] = []
        
        // Get the list of all device IDs.
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var dataSize: UInt32 = 0
        var status = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize
        )
        
        guard status == noErr else {
            sendLog(level: "error", message: "Failed to get devices data size: \(status)")
            return devices
        }
        
        let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = [AudioDeviceID](repeating: 0, count: deviceCount)
        
        status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )
        
        guard status == noErr else {
            sendLog(level: "error", message: "Failed to get devices: \(status)")
            return devices
        }
        
        // Convert each device ID to a Device struct.
        for deviceID in deviceIDs {
            if let device = makeDevice(deviceID: deviceID) {
                devices.append(device)
            }
        }
        
        return devices
    }
    
    /// Create a Device struct from an AudioDeviceID.
    private func makeDevice(deviceID: AudioDeviceID) -> Device? {
        // Get device UID (stable identifier).
        guard let uid = getDeviceUID(deviceID: deviceID) else {
            return nil
        }
        
        // Get device name.
        let name = getDeviceName(deviceID: deviceID) ?? "Unknown Device"
        
        // Check if device has input/output streams.
        let hasInput = deviceHasStreams(deviceID: deviceID, scope: kAudioDevicePropertyScopeInput)
        let hasOutput = deviceHasStreams(deviceID: deviceID, scope: kAudioDevicePropertyScopeOutput)
        
        // Get manufacturer.
        let manufacturer = getDeviceManufacturer(deviceID: deviceID)
        
        // Get transport type.
        let transportType = getTransportType(deviceID: deviceID)
        
        return Device(
            id: uid,
            name: name,
            isInput: hasInput,
            isOutput: hasOutput,
            manufacturer: manufacturer,
            transportType: transportType
        )
    }
    
    /// Get the UID string for a device.
    private func getDeviceUID(deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var uid: CFString?
        var dataSize = UInt32(MemoryLayout<CFString?>.size)
        
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &uid
        )
        
        guard status == noErr, let uid = uid else {
            return nil
        }
        
        return uid as String
    }
    
    /// Get the name of a device.
    private func getDeviceName(deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var name: CFString?
        var dataSize = UInt32(MemoryLayout<CFString?>.size)
        
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &name
        )
        
        guard status == noErr, let name = name else {
            return nil
        }
        
        return name as String
    }
    
    /// Get the manufacturer of a device.
    private func getDeviceManufacturer(deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceManufacturerCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var manufacturer: CFString?
        var dataSize = UInt32(MemoryLayout<CFString?>.size)
        
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &manufacturer
        )
        
        guard status == noErr, let manufacturer = manufacturer else {
            return nil
        }
        
        return manufacturer as String
    }
    
    /// Check if a device has streams in the given scope (input or output).
    private func deviceHasStreams(deviceID: AudioDeviceID, scope: AudioObjectPropertyScope) -> Bool {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var dataSize: UInt32 = 0
        let status = AudioObjectGetPropertyDataSize(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize
        )
        
        // Device has streams if we can get the size and it's non-zero.
        return status == noErr && dataSize > 0
    }
    
    /// Get the transport type of a device (USB, Bluetooth, Built-in, etc.).
    private func getTransportType(deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var transportType: UInt32 = 0
        var dataSize = UInt32(MemoryLayout<UInt32>.size)
        
        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &transportType
        )
        
        guard status == noErr else {
            return nil
        }
        
        // Map transport type to string.
        switch transportType {
        case kAudioDeviceTransportTypeUSB:
            return "usb"
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE:
            return "bluetooth"
        case kAudioDeviceTransportTypeBuiltIn:
            return "built-in"
        case kAudioDeviceTransportTypeAggregate:
            return "other"
        case kAudioDeviceTransportTypeVirtual:
            return "other"
        case kAudioDeviceTransportTypeUnknown:
            return "other"
        default:
            return "other"
        }
    }
    
    // MARK: - Default Input Device
    
    /// Get the current default input device UID.
    func getDefaultInputDeviceId() -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var deviceID: AudioDeviceID = 0
        var dataSize = UInt32(MemoryLayout<AudioDeviceID>.size)
        
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceID
        )
        
        guard status == noErr, deviceID != kAudioDeviceUnknown else {
            return nil
        }
        
        return getDeviceUID(deviceID: deviceID)
    }
    
    /// Set the default input device by UID.
    func setDefaultInputDevice(uid: String) -> Bool {
        // First, find the device ID for this UID.
        guard let deviceID = findDeviceID(byUID: uid) else {
            sendLog(level: "error", message: "Device not found for UID: \(uid)")
            return false
        }
        
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var mutableDeviceID = deviceID
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            UInt32(MemoryLayout<AudioDeviceID>.size),
            &mutableDeviceID
        )
        
        if status != noErr {
            sendLog(level: "error", message: "Failed to set default input: \(status)")
            return false
        }
        
        sendLog(level: "info", message: "Set default input to: \(uid)")
        return true
    }
    
    /// Find an AudioDeviceID by its UID string.
    private func findDeviceID(byUID uid: String) -> AudioDeviceID? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var dataSize: UInt32 = 0
        var status = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize
        )
        
        guard status == noErr else { return nil }
        
        let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = [AudioDeviceID](repeating: 0, count: deviceCount)
        
        status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )
        
        guard status == noErr else { return nil }
        
        for deviceID in deviceIDs {
            if getDeviceUID(deviceID: deviceID) == uid {
                return deviceID
            }
        }
        
        return nil
    }
    
    // MARK: - Monitoring
    
    /// Start monitoring for device and default input changes.
    func startMonitoring() {
        guard !isMonitoring else {
            sendLog(level: "info", message: "Already monitoring")
            return
        }
        
        isMonitoring = true
        
        // Monitor device list changes.
        var devicesAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        let devicesStatus = AudioObjectAddPropertyListener(
            AudioObjectID(kAudioObjectSystemObject),
            &devicesAddress,
            deviceListChanged,
            nil
        )
        
        if devicesStatus != noErr {
            sendLog(level: "error", message: "Failed to add device list listener: \(devicesStatus)")
        }
        
        // Monitor default input changes.
        var defaultInputAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        let defaultInputStatus = AudioObjectAddPropertyListener(
            AudioObjectID(kAudioObjectSystemObject),
            &defaultInputAddress,
            defaultInputChanged,
            nil
        )
        
        if defaultInputStatus != noErr {
            sendLog(level: "error", message: "Failed to add default input listener: \(defaultInputStatus)")
        }
        
        sendLog(level: "info", message: "Started monitoring CoreAudio changes")
    }
}

// MARK: - Accessibility Helper

/// Provides accessibility-related permission checks and text input detection.
/// Note: CGEventTap-based keyboard monitoring was removed as it required Input Monitoring permission.
final class KeyboardMonitor {

    static let shared = KeyboardMonitor()

    private init() {}

    /// Check if Accessibility permission is granted.
    func checkAccessibilityPermission() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }
    
    /// Get the PID of the app that owns the window at the cursor position.
    /// Uses CGWindowListCopyWindowInfo to find the topmost window under the cursor.
    private func getAppPIDAtCursorPosition() -> pid_t? {
        let mouseLocation = NSEvent.mouseLocation
        guard let mainScreen = NSScreen.main else { return nil }
        
        // Convert from bottom-left origin (NSEvent) to top-left origin (CGWindow)
        let screenHeight = mainScreen.frame.height
        let cursorPoint = CGPoint(x: mouseLocation.x, y: screenHeight - mouseLocation.y)
        
        // Get all on-screen windows, ordered front-to-back
        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        
        // Find the topmost window that contains the cursor
        for windowInfo in windowList {
            guard let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = boundsDict["X"],
                  let y = boundsDict["Y"],
                  let width = boundsDict["Width"],
                  let height = boundsDict["Height"],
                  let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? pid_t else {
                continue
            }
            
            let windowRect = CGRect(x: x, y: y, width: width, height: height)
            if windowRect.contains(cursorPoint) {
                // Skip windows with layer > 0 (menu bar, dock, etc.)
                if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 {
                    continue
                }
                
                let ownerName = windowInfo[kCGWindowOwnerName as String] as? String ?? "unknown"
                sendLog(level: "debug", message: "getAppPIDAtCursorPosition: Found window at cursor - app=\(ownerName), pid=\(ownerPID)")
                return ownerPID
            }
        }
        
        return nil
    }
    
    /// Check if a text input field is currently focused.
    /// Uses Accessibility API to get the focused UI element and check its role.
    /// Handles web content and nested elements by checking the hierarchy.
    func checkFocusedTextInput() -> Bool {
        let isTrusted = AXIsProcessTrusted()
        sendLog(level: "debug", message: "checkFocusedTextInput: isTrusted=\(isTrusted)")
        
        // Try system-wide focused element first
        let systemWideElement = AXUIElementCreateSystemWide()
        var focusedElement: CFTypeRef?
        var result = AXUIElementCopyAttributeValue(
            systemWideElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )
        
        // If system-wide fails, try the app at the cursor position (more reliable than frontmostApplication)
        if result != .success {
            sendLog(level: "debug", message: "checkFocusedTextInput: System-wide failed (error=\(result.rawValue)), trying app at cursor")
            
            if let pid = getAppPIDAtCursorPosition() {
                let appElement = AXUIElementCreateApplication(pid)
                result = AXUIElementCopyAttributeValue(
                    appElement,
                    kAXFocusedUIElementAttribute as CFString,
                    &focusedElement
                )
            } else {
                // Fallback to frontmost application if cursor detection fails
                sendLog(level: "debug", message: "checkFocusedTextInput: Cursor detection failed, trying frontmost app")
                if let frontApp = NSWorkspace.shared.frontmostApplication {
                    let pid = frontApp.processIdentifier
                    let appElement = AXUIElementCreateApplication(pid)
                    sendLog(level: "debug", message: "checkFocusedTextInput: Frontmost app=\(frontApp.localizedName ?? "unknown"), pid=\(pid)")
                    result = AXUIElementCopyAttributeValue(
                        appElement,
                        kAXFocusedUIElementAttribute as CFString,
                        &focusedElement
                    )
                }
            }
        }
        
        sendLog(level: "debug", message: "checkFocusedTextInput: AXError=\(result.rawValue)")
        
        guard result == .success, let element = focusedElement else {
            sendLog(level: "debug", message: "checkFocusedTextInput: No focused element found (error=\(result.rawValue))")
            return false
        }
        
        let axElement = element as! AXUIElement
        return isTextInputElement(axElement) || hasTextInputAncestor(axElement)
    }
    
    /// Check if an element is a text input type.
    private func isTextInputElement(_ element: AXUIElement) -> Bool {
        // Get role
        var roleValue: CFTypeRef?
        let roleResult = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
        let role = (roleResult == .success) ? (roleValue as? String ?? "") : ""
        
        // Get subrole (some elements use this)
        var subroleValue: CFTypeRef?
        let subroleResult = AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleValue)
        let subrole = (subroleResult == .success) ? (subroleValue as? String ?? "") : ""
        
        // Log for debugging
        sendLog(level: "debug", message: "checkFocusedTextInput: role=\(role), subrole=\(subrole)")
        
        // Known text input roles
        let textInputRoles: Set<String> = [
            "AXTextField",
            "AXTextArea", 
            "AXComboBox",
            "AXSearchField",
            "AXWebArea",
            "AXStaticText"  // Some apps use this for editable text
        ]
        
        // Known text input subroles
        let textInputSubroles: Set<String> = [
            "AXSearchField",
            "AXSecureTextField",
            "AXPlainText"
        ]
        
        if textInputRoles.contains(role) || textInputSubroles.contains(subrole) {
            return true
        }
        
        // Check for editable attribute
        var editableValue: CFTypeRef?
        let editableResult = AXUIElementCopyAttributeValue(element, "AXEditable" as CFString, &editableValue)
        if editableResult == .success, let editable = editableValue as? Bool, editable {
            sendLog(level: "debug", message: "checkFocusedTextInput: Element is editable")
            return true
        }
        
        // For groups and containers in web content, check if they might be editable
        if role == "AXGroup" || role == "AXUnknown" {
            // Check contenteditable-style elements
            var roleDescValue: CFTypeRef?
            let roleDescResult = AXUIElementCopyAttributeValue(element, kAXRoleDescriptionAttribute as CFString, &roleDescValue)
            if roleDescResult == .success, let roleDesc = roleDescValue as? String {
                let editableDescriptions = ["text field", "text area", "edit text", "input", "textbox"]
                for desc in editableDescriptions {
                    if roleDesc.lowercased().contains(desc) {
                        sendLog(level: "debug", message: "checkFocusedTextInput: Detected via role description: \(roleDesc)")
                        return true
                    }
                }
            }
        }
        
        return false
    }
    
    /// Walk up the accessibility hierarchy to find if any ancestor is a text input.
    /// This helps with web content where the focused element might be nested.
    private func hasTextInputAncestor(_ element: AXUIElement, depth: Int = 0) -> Bool {
        // Limit depth to prevent infinite loops
        guard depth < 5 else { return false }
        
        // Get parent
        var parentValue: CFTypeRef?
        let parentResult = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &parentValue)
        
        guard parentResult == .success, let parent = parentValue else {
            return false
        }
        
        let parentElement = parent as! AXUIElement
        
        // Check if parent is a text input
        if isTextInputElement(parentElement) {
            return true
        }
        
        // Continue up the tree
        return hasTextInputAncestor(parentElement, depth: depth + 1)
    }
}

// MARK: - App Activation Monitor

/// Monitors when Field Theory becomes the frontmost application.
/// Sends a message to Electron so it can show the clipboard window.
final class AppActivationMonitor {
    
    static let shared = AppActivationMonitor()
    
    private var activationObserver: NSObjectProtocol?
    private var activeSpaceObserver: NSObjectProtocol?
    private var isMonitoring = false
    
    private init() {}
    
    /// Start monitoring for app activation.
    func startMonitoring() -> Bool {
        guard !isMonitoring else {
            return true
        }
        
        // Listen for when our app becomes active (frontmost).
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppActivation(notification: notification)
        }

        // Listen for Mission Control / Space changes and notify Electron so
        // window caches can refresh immediately (in addition to polling).
        activeSpaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleActiveSpaceChanged()
        }
        
        isMonitoring = true
        sendLog(level: "info", message: "App activation monitoring started")
        return true
    }
    
    /// Stop monitoring.
    func stopMonitoring() {
        guard isMonitoring else { return }

        if let activationObserver = activationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
            self.activationObserver = nil
        }

        if let activeSpaceObserver = activeSpaceObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(activeSpaceObserver)
            self.activeSpaceObserver = nil
        }

        isMonitoring = false
        sendLog(level: "info", message: "App activation monitoring stopped")
    }

    /// Broadcast the current frontmost app immediately.
    /// Call this after startMonitoring() to provide initial state to Electron.
    func broadcastCurrentFrontmostApp() {
        guard let frontApp = NSWorkspace.shared.frontmostApplication else {
            sendLog(level: "debug", message: "broadcastCurrentFrontmostApp: No frontmost app")
            return
        }

        let pid = frontApp.processIdentifier
        let bundleId = frontApp.bundleIdentifier
        let appName = frontApp.localizedName

        // Skip if Field Theory itself is frontmost (user just launched it).
        let parentPid = getppid()
        if pid == parentPid {
            sendLog(level: "debug", message: "broadcastCurrentFrontmostApp: Skipping self")
            return
        }

        let windowBounds = getWindowBoundsForApp(pid: pid)
        let message = FrontmostAppChangedMessage(
            bundleId: bundleId,
            name: appName,
            windowBounds: windowBounds
        )
        sendJSON(message)
        sendLog(level: "info", message: "broadcastCurrentFrontmostApp: \(appName ?? "unknown")")
    }
    
    /// Handle app activation notification.
    private func handleAppActivation(notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            sendLog(level: "debug", message: "AppActivationMonitor: No app in notification")
            return
        }

        let parentPid = getppid()
        let activatedPid = app.processIdentifier
        let bundleId = app.bundleIdentifier
        let appName = app.localizedName

        sendLog(level: "debug", message: "AppActivationMonitor: activated=\(activatedPid) parent=\(parentPid) name=\(appName ?? "unknown")")

        // Always send frontmost app info (for command launcher positioning).
        // Get window bounds for the frontmost window of this app.
        let windowBounds = getWindowBoundsForApp(pid: activatedPid)
        let message = FrontmostAppChangedMessage(
            bundleId: bundleId,
            name: appName,
            windowBounds: windowBounds
        )
        sendJSON(message)

        // Also send the legacy message if it's our app.
        if activatedPid == parentPid {
            sendLog(level: "debug", message: "Field Theory (parent process) became frontmost app")
            sendJSON(AppBecameFrontmostMessage())
        }
    }

    /// Handle active Space/desktop changes.
    private func handleActiveSpaceChanged() {
        sendJSON(ActiveSpaceChangedMessage())
        broadcastCurrentFrontmostApp()
    }

    /// Get the bounds of the frontmost window for a given app PID.
    private func getWindowBoundsForApp(pid: pid_t) -> FrontmostAppChangedMessage.WindowBounds? {
        // Get all on-screen windows, ordered front-to-back.
        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        // Find the first (frontmost) window owned by this PID.
        for windowInfo in windowList {
            guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? pid_t,
                  ownerPID == pid,
                  let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = boundsDict["X"],
                  let y = boundsDict["Y"],
                  let width = boundsDict["Width"],
                  let height = boundsDict["Height"] else {
                continue
            }

            // Skip windows with layer > 0 (menu bar, dock, etc.)
            if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 {
                continue
            }

            // Skip very small windows (likely invisible or utility windows).
            if width < 100 || height < 100 {
                continue
            }

            return FrontmostAppChangedMessage.WindowBounds(
                x: Int(x),
                y: Int(y),
                width: Int(width),
                height: Int(height)
            )
        }

        return nil
    }
}

/// Message sent when Field Theory becomes the frontmost app.
struct AppBecameFrontmostMessage: Codable {
    let type = "appBecameFrontmost"

    enum CodingKeys: String, CodingKey {
        case type
    }
}

/// Message sent when the frontmost app changes (for any app, not just ours).
/// Includes window bounds for positioning UI elements.
struct FrontmostAppChangedMessage: Codable {
    let type = "frontmostAppChanged"
    let bundleId: String?
    let name: String?
    let windowBounds: WindowBounds?

    struct WindowBounds: Codable {
        let x: Int
        let y: Int
        let width: Int
        let height: Int
    }

    enum CodingKeys: String, CodingKey {
        case type
        case bundleId
        case name
        case windowBounds
    }
}

/// Message sent when the user changes active macOS Space/Desktop.
struct ActiveSpaceChangedMessage: Codable {
    let type = "activeSpaceChanged"

    enum CodingKeys: String, CodingKey {
        case type
    }
}

// MARK: - Voice Activity Detection (WebRTC VAD)

import WebRTCVad

/// Swift wrapper around libfvad (WebRTC VAD extraction).
/// Accumulates variable-size Float32 buffers into fixed 160-sample (10ms at 16kHz) frames
/// and returns the last VAD decision.
final class VoiceActivityDetector {
    private var inst: OpaquePointer?
    private var frameBuffer: [Int16] = []
    private var lastResult: Bool = false
    private static let frameSize = 160  // 10ms at 16kHz

    /// Whether the VAD instance was successfully created.
    var isValid: Bool { inst != nil }

    /// Initialize with aggressiveness mode 0-3 (default 2 = "aggressive").
    init(mode: Int32 = 2) {
        inst = fvad_new()
        guard let inst = inst else { return }
        fvad_set_mode(inst, mode)
        fvad_set_sample_rate(inst, 16000)
    }

    deinit {
        if let inst = inst { fvad_free(inst) }
    }

    /// Process Float32 samples (16kHz mono). Returns true if speech detected in
    /// the most recently completed 10ms frame.
    func process(samples: UnsafePointer<Float>, count: Int) -> Bool {
        // Convert Float32 → Int16 and append to frame buffer
        for i in 0..<count {
            let clamped = max(-1.0, min(1.0, samples[i]))
            frameBuffer.append(Int16(clamped * 32767.0))
        }

        // Process all complete 10ms frames
        while frameBuffer.count >= VoiceActivityDetector.frameSize {
            let frame = Array(frameBuffer.prefix(VoiceActivityDetector.frameSize))
            frameBuffer.removeFirst(VoiceActivityDetector.frameSize)
            let result = frame.withUnsafeBufferPointer { buf in
                fvad_process(inst, buf.baseAddress, VoiceActivityDetector.frameSize)
            }
            if result >= 0 {
                lastResult = result == 1
            }
        }
        return lastResult
    }

    /// Reset internal state and frame buffer (call on recording restart).
    func reset() {
        frameBuffer.removeAll()
        lastResult = false
        if let inst = inst { fvad_reset(inst) }
    }
}

// MARK: - Audio Recording Helper

/// Manages audio recording using AVAudioEngine.
/// Records from the default input device at 16kHz mono PCM (whisper.cpp format).
final class RecordingHelper {
    
    static let shared = RecordingHelper()

    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var recordingURL: URL?
    private var isRecording = false

    // Pre-created file for fast snapshots — created in background after each snapshot/start
    private var pendingAudioFile: AVAudioFile?
    private var pendingRecordingURL: URL?

    // Voice activity detection
    private let vad = VoiceActivityDetector(mode: 2)

    // Silence detection state (all accessed on main thread only)
    private var hasSpeechSinceLastHarvest = false
    private var silenceTimer: DispatchWorkItem?
    private var harvestMode: String = "command"  // "command" = snappier chunks, "dictation" = slightly longer chunks
    private var consecutiveSpeechMs: Double = 0
    private var voicedMsSinceLastHarvest: Double = 0
    private var observedMsSinceLastHarvest: Double = 0
    private var lastAudioProcessTimeNs: UInt64 = 0

    private static let SPEECH_THRESHOLD: Double = 0.02  // RMS fallback when VAD unavailable
    private static let SILENCE_COMMAND_MS: Int = 200
    private static let SILENCE_DICTATION_MS: Int = 320
    private static let MAX_ACTIVE_CHUNK_COMMAND_MS: Double = 700
    private static let MAX_ACTIVE_CHUNK_DICTATION_MS: Double = 900
    private static let SPEECH_START_HOLD_MS: Double = 70
    private static let MIN_VOICED_MS: Double = 170
    private static let MIN_VOICED_RATIO: Double = 0.14

    private static let wavSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false
    ]

    private init() {}

    /// Pre-create the next WAV file on a background queue so snapshotRecording is near-instant.
    private func prepareNextFile() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let tempDir = FileManager.default.temporaryDirectory
            let fileName = "littleone-recording-\(UUID().uuidString).wav"
            let url = tempDir.appendingPathComponent(fileName)

            do {
                let file = try AVAudioFile(forWriting: url, settings: RecordingHelper.wavSettings)
                DispatchQueue.main.async {
                    guard let self = self, self.isRecording else {
                        // Recording stopped before we finished — clean up
                        try? FileManager.default.removeItem(at: url)
                        return
                    }
                    self.pendingAudioFile = file
                    self.pendingRecordingURL = url
                }
            } catch {
                sendLog(level: "error", message: "Failed to pre-create next audio file: \(error.localizedDescription)")
            }
        }
    }

    /// Process an audio level on the main thread for silence detection.
    /// Called from the tap callback via DispatchQueue.main.async.
    func processAudioLevel(_ level: Double, isSpeech: Bool) {
        guard isRecording else { return }
        // "off" mode: regular transcriber owns the recording — no harvest snapshots.
        guard harvestMode != "off" else { return }

        let nowNs = DispatchTime.now().uptimeNanoseconds
        let deltaMs: Double
        if lastAudioProcessTimeNs == 0 || nowNs < lastAudioProcessTimeNs {
            deltaMs = 0
        } else {
            deltaMs = Double(nowNs - lastAudioProcessTimeNs) / 1_000_000.0
        }
        lastAudioProcessTimeNs = nowNs

        // Use VAD result when available, fall back to RMS threshold
        let speechDetected = vad.isValid ? isSpeech : (level > RecordingHelper.SPEECH_THRESHOLD)
        if speechDetected {
            if deltaMs > 0 {
                consecutiveSpeechMs += deltaMs
            }

            // Require a short sustained run before we treat this as real speech.
            if !hasSpeechSinceLastHarvest && consecutiveSpeechMs >= RecordingHelper.SPEECH_START_HOLD_MS {
                hasSpeechSinceLastHarvest = true
                voicedMsSinceLastHarvest = consecutiveSpeechMs
                observedMsSinceLastHarvest = consecutiveSpeechMs
            } else if hasSpeechSinceLastHarvest {
                voicedMsSinceLastHarvest += max(deltaMs, 0)
                observedMsSinceLastHarvest += max(deltaMs, 0)
            }

            silenceTimer?.cancel()
            silenceTimer = nil

            // Force periodic harvest while user is continuously speaking so the
            // transcript updates incrementally instead of waiting for long pauses.
            if hasSpeechSinceLastHarvest {
                let maxChunkMs = harvestMode == "dictation"
                    ? RecordingHelper.MAX_ACTIVE_CHUNK_DICTATION_MS
                    : RecordingHelper.MAX_ACTIVE_CHUNK_COMMAND_MS

                if observedMsSinceLastHarvest >= maxChunkMs {
                    emitHarvestChunk(trigger: "max-active")
                }
            }
        } else {
            consecutiveSpeechMs = 0
            // Below speech threshold — start harvest timer if speech was detected.
            // The command timeout is intentionally longer than a micro-pause.
            if hasSpeechSinceLastHarvest && silenceTimer == nil {
                if deltaMs > 0 {
                    observedMsSinceLastHarvest += deltaMs
                }
                let silenceMs = harvestMode == "dictation"
                    ? RecordingHelper.SILENCE_DICTATION_MS
                    : RecordingHelper.SILENCE_COMMAND_MS
                let work = DispatchWorkItem { [weak self] in
                    guard let self = self, self.isRecording else { return }
                    self.silenceTimer = nil
                    self.emitHarvestChunk(trigger: "silence")
                }
                silenceTimer = work
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + .milliseconds(silenceMs),
                    execute: work
                )
            }
        }
    }

    /// Reset speech accumulation state used by harvest chunking.
    private func resetHarvestSpeechState() {
        hasSpeechSinceLastHarvest = false
        consecutiveSpeechMs = 0
        voicedMsSinceLastHarvest = 0
        observedMsSinceLastHarvest = 0
    }

    /// Snapshot and emit a harvest chunk when enough speech has accumulated.
    /// If the chunk is mostly noise, it is dropped but still rotates the file so
    /// we don't keep appending low-value audio forever.
    private func emitHarvestChunk(trigger: String) {
        let voicedRatio = observedMsSinceLastHarvest > 0
            ? (voicedMsSinceLastHarvest / observedMsSinceLastHarvest)
            : 0
        let shouldDrop = voicedMsSinceLastHarvest < RecordingHelper.MIN_VOICED_MS
            || voicedRatio < RecordingHelper.MIN_VOICED_RATIO

        if shouldDrop {
            _ = snapshotRecording()
            sendLog(
                level: "info",
                message: String(
                    format: "Dropping low-voice chunk (%@, voiced=%.0fms, ratio=%.2f)",
                    trigger,
                    voicedMsSinceLastHarvest,
                    voicedRatio
                )
            )
            resetHarvestSpeechState()
            return
        }

        if let filePath = snapshotRecording() {
            let message = RecordingChunkReadyMessage(filePath: filePath)
            sendJSON(message)
            sendLog(
                level: "debug",
                message: String(
                    format: "Harvest chunk emitted (%@, voiced=%.0fms, observed=%.0fms)",
                    trigger,
                    voicedMsSinceLastHarvest,
                    observedMsSinceLastHarvest
                )
            )
            resetHarvestSpeechState()
        }
    }

    /// Set the harvest mode and cancel any pending silence timer.
    /// Called from MessageHandler when Node sends setHarvestMode.
    func setHarvestMode(_ mode: String) {
        harvestMode = mode
        silenceTimer?.cancel()
        silenceTimer = nil
        resetHarvestSpeechState()
    }

    /// Start recording from the default input device.
    /// Records to a temporary WAV file at 16kHz mono PCM.
    func startRecording() -> Bool {
        guard !isRecording else {
            sendLog(level: "error", message: "Recording already in progress")
            return false
        }
        
        // Create temporary file path
        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "littleone-recording-\(UUID().uuidString).wav"
        recordingURL = tempDir.appendingPathComponent(fileName)
        
        guard let url = recordingURL else {
            sendLog(level: "error", message: "Failed to create recording URL")
            return false
        }
        
        // Set up audio engine
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        
        sendLog(level: "info", message: "Input format: \(inputFormat.sampleRate)Hz, \(inputFormat.channelCount) channels")
        
        // Target format: 16kHz mono PCM (whisper.cpp requirement)
        let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        )
        
        guard let format = targetFormat else {
            sendLog(level: "error", message: "Failed to create target audio format")
            return false
        }
        
        // Create audio file first
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forWriting: url, settings: RecordingHelper.wavSettings)
            audioFile = file
        } catch {
            sendLog(level: "error", message: "Failed to create audio file: \(error.localizedDescription)")
            return false
        }
        
        // Install tap on input node
        let bufferSize: AVAudioFrameCount = 2048
        let needsConversion = inputFormat.sampleRate != format.sampleRate || inputFormat.channelCount != format.channelCount
        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self, self.isRecording, let audioFile = self.audioFile else { return }

            // 1. Calculate RMS from raw input buffer (for UI level meter)
            var level: Double = 0
            if let channelData = buffer.floatChannelData {
                let channel = channelData[0]
                let frameLength = Int(buffer.frameLength)
                var sum: Float = 0
                for i in 0..<frameLength {
                    let sample = channel[i]
                    sum += sample * sample
                }
                let rms = sqrt(sum / Float(frameLength))
                level = min(1.0, Double(rms))
            }

            // 2. Convert to 16kHz mono (move before VAD so we can run VAD on target format)
            let writeBuffer: AVAudioPCMBuffer
            if needsConversion {
                guard let converter = AVAudioConverter(from: inputFormat, to: format) else {
                    sendLog(level: "error", message: "Failed to create audio converter")
                    // Send level without VAD so UI meter doesn't stall
                    sendJSON(AudioLevelMessage(level: level, isSpeech: false))
                    return
                }

                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / inputFormat.sampleRate)
                guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
                    sendJSON(AudioLevelMessage(level: level, isSpeech: false))
                    return
                }

                var convError: NSError?
                let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
                    outStatus.pointee = .haveData
                    return buffer
                }

                converter.convert(to: convertedBuffer, error: &convError, withInputFrom: inputBlock)

                if let convError = convError {
                    sendLog(level: "error", message: "Audio conversion error: \(convError.localizedDescription)")
                    sendJSON(AudioLevelMessage(level: level, isSpeech: false))
                    return
                }
                writeBuffer = convertedBuffer
            } else {
                writeBuffer = buffer
            }

            // 3. Run VAD on the converted 16kHz Float32 data
            var isSpeech = false
            if let channelData = writeBuffer.floatChannelData {
                isSpeech = self.vad.process(samples: channelData[0], count: Int(writeBuffer.frameLength))
            }

            // 4. Send combined audioLevel message with both level and isSpeech
            sendJSON(AudioLevelMessage(level: level, isSpeech: isSpeech))

            // 5. Dispatch to main thread for silence detection
            DispatchQueue.main.async { [weak self] in
                self?.processAudioLevel(level, isSpeech: isSpeech)
            }

            // 6. Write converted buffer to file
            do {
                try audioFile.write(from: writeBuffer)
            } catch {
                sendLog(level: "error", message: "Failed to write audio buffer: \(error.localizedDescription)")
            }
        }
        
        audioEngine = engine

        // Start engine
        vad.reset()
        do {
            try engine.start()
            isRecording = true
            resetHarvestSpeechState()
            lastAudioProcessTimeNs = 0
            silenceTimer?.cancel()
            silenceTimer = nil
            prepareNextFile()
            sendLog(level: "info", message: "Recording started: \(url.path)")
            return true
        } catch {
            sendLog(level: "error", message: "Failed to start audio engine: \(error.localizedDescription)")
            inputNode.removeTap(onBus: 0)
            audioEngine = nil
            audioFile = nil
            recordingURL = nil
            return false
        }
    }
    
    /// Stop recording and return the file path.
    func stopRecording() -> String? {
        guard isRecording else {
            sendLog(level: "error", message: "No recording in progress (isRecording=false)")
            return nil
        }
        
        guard let engine = audioEngine else {
            sendLog(level: "error", message: "No audio engine available")
            isRecording = false
            return nil
        }
        
        guard let url = recordingURL else {
            sendLog(level: "error", message: "No recording URL available")
            isRecording = false
            audioEngine = nil
            return nil
        }
        
        // Stop recording first
        isRecording = false
        silenceTimer?.cancel()
        silenceTimer = nil
        resetHarvestSpeechState()
        lastAudioProcessTimeNs = 0

        // Remove tap and stop engine
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        
        // Flush and close audio file
        // File is automatically flushed when deallocated
        audioFile = nil
        
        // Get path before clearing URL
        let path = url.path
        
        // Clean up
        audioEngine = nil
        recordingURL = nil

        // Clean up pre-created pending file
        if let pendingURL = pendingRecordingURL {
            try? FileManager.default.removeItem(at: pendingURL)
        }
        pendingAudioFile = nil
        pendingRecordingURL = nil

        // Verify file exists
        if !FileManager.default.fileExists(atPath: path) {
            sendLog(level: "error", message: "Recording file does not exist: \(path)")
            return nil
        }

        // Check file size
        if let attributes = try? FileManager.default.attributesOfItem(atPath: path),
           let fileSize = attributes[.size] as? Int64 {
            sendLog(level: "info", message: "Recording stopped: \(path) (\(fileSize) bytes)")
        } else {
            sendLog(level: "info", message: "Recording stopped: \(path)")
        }

        return path
    }
    
    /// Snapshot the current recording: close the current WAV file and open a new one
    /// without stopping the audio engine or removing the input tap.
    /// Returns the path to the completed file, or nil on failure.
    func snapshotRecording() -> String? {
        guard isRecording else {
            sendLog(level: "error", message: "No recording in progress for snapshot")
            return nil
        }

        guard let oldURL = recordingURL else {
            sendLog(level: "error", message: "No recording URL for snapshot")
            return nil
        }

        // Use pre-created file if available (near-instant), otherwise create synchronously
        let newFile: AVAudioFile
        let newURL: URL
        if let pf = pendingAudioFile, let pu = pendingRecordingURL {
            newFile = pf
            newURL = pu
            pendingAudioFile = nil
            pendingRecordingURL = nil
        } else {
            sendLog(level: "info", message: "Snapshot: pending file not ready, creating synchronously")
            let tempDir = FileManager.default.temporaryDirectory
            let fileName = "littleone-recording-\(UUID().uuidString).wav"
            newURL = tempDir.appendingPathComponent(fileName)
            do {
                newFile = try AVAudioFile(forWriting: newURL, settings: RecordingHelper.wavSettings)
            } catch {
                sendLog(level: "error", message: "Failed to create audio file for snapshot: \(error.localizedDescription)")
                return nil
            }
        }

        // Swap the audio file — the tap callback reads self.audioFile, so the next buffer
        // write goes to the new file. The old file flushes when its last reference drops.
        self.audioFile = newFile
        self.recordingURL = newURL

        // Pre-create the next file for the following snapshot
        prepareNextFile()

        let path = oldURL.path
        if let attributes = try? FileManager.default.attributesOfItem(atPath: path),
           let fileSize = attributes[.size] as? Int64 {
            sendLog(level: "info", message: "Recording snapshot: \(path) (\(fileSize) bytes)")
        }

        return path
    }

    /// Cancel recording without saving.
    func cancelRecording() {
        guard isRecording else {
            return
        }

        isRecording = false
        silenceTimer?.cancel()
        silenceTimer = nil
        resetHarvestSpeechState()
        lastAudioProcessTimeNs = 0
        
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        
        // Delete the file if it exists
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }

        // Clean up pre-created pending file
        if let pendingURL = pendingRecordingURL {
            try? FileManager.default.removeItem(at: pendingURL)
        }

        audioEngine = nil
        audioFile = nil
        recordingURL = nil
        pendingAudioFile = nil
        pendingRecordingURL = nil
        
        sendLog(level: "info", message: "Recording cancelled")
    }
}

// MARK: - CoreAudio Callbacks

/// Callback when the device list changes.
private func deviceListChanged(
    objectID: AudioObjectID,
    numberAddresses: UInt32,
    addresses: UnsafePointer<AudioObjectPropertyAddress>,
    clientData: UnsafeMutableRawPointer?
) -> OSStatus {
    // Get updated device list and send to Electron.
    let devices = CoreAudioHelper.shared.listDevices()
    let message = DevicesChangedMessage(devices: devices)
    sendJSON(message)
    return noErr
}

/// Callback when the default input device changes.
private func defaultInputChanged(
    objectID: AudioObjectID,
    numberAddresses: UInt32,
    addresses: UnsafePointer<AudioObjectPropertyAddress>,
    clientData: UnsafeMutableRawPointer?
) -> OSStatus {
    // Get updated default input and send to Electron.
    let deviceId = CoreAudioHelper.shared.getDefaultInputDeviceId()
    let message = DefaultInputChangedMessage(deviceId: deviceId)
    sendJSON(message)
    return noErr
}

// MARK: - JSON I/O

/// Send a JSON-encodable message to stdout.
func sendJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    do {
        let data = try encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            // Fallback: try to send error message, but avoid recursion
            let fallbackError = ErrorMessage(message: "Failed to convert encoded data to UTF-8 string")
            if let fallbackData = try? encoder.encode(fallbackError),
               let fallbackJson = String(data: fallbackData, encoding: .utf8) {
                print(fallbackJson)
                fflush(stdout)
            }
            return
        }
        print(json)
        fflush(stdout)
    } catch {
        // Try to send error message about encoding failure
        let encodingError = ErrorMessage(message: "Failed to encode JSON: \(error.localizedDescription)")
        if let errorData = try? encoder.encode(encodingError),
           let errorJson = String(data: errorData, encoding: .utf8) {
            print(errorJson)
            fflush(stdout)
        }
    }
}

/// Send a log message to Electron.
func sendLog(level: String, message: String) {
    let logMessage = LogMessage(level: level, message: message)
    sendJSON(logMessage)
}

/// Send an error message to Electron.
func sendError(_ message: String) {
    let errorMessage = ErrorMessage(message: message)
    sendJSON(errorMessage)
}

// MARK: - Sound Playback Helper

/// Manages preloaded NSSound instances for instant playback.
/// Thread safety: Only access from main thread (MessageHandler dispatches there).
final class SoundHelper {
    static let shared = SoundHelper()

    /// Cache of preloaded sounds, keyed by file path.
    private var soundCache: [String: NSSound] = [:]

    private init() {}

    /// Preload a sound file for instant playback.
    /// Returns true if the sound was loaded successfully.
    @discardableResult
    func preload(path: String) -> Bool {
        // Skip if already cached
        if soundCache[path] != nil {
            return true
        }

        // Load sound into memory (byReference: false = copy data for instant playback)
        guard let sound = NSSound(contentsOfFile: path, byReference: false) else {
            sendLog(level: "warn", message: "Failed to preload sound: \(path)")
            return false
        }

        soundCache[path] = sound
        return true
    }

    /// Preload multiple sound files.
    func preloadAll(paths: [String]) -> Int {
        var count = 0
        for path in paths {
            if preload(path: path) {
                count += 1
            }
        }
        sendLog(level: "info", message: "Preloaded \(count) sounds")
        return count
    }

    /// Play a sound. If not preloaded, attempts to load and play.
    /// Fire-and-forget: returns immediately, sound plays asynchronously.
    func play(path: String) {
        // Try to get from cache first
        if let cachedSound = soundCache[path] {
            // NSSound.play() is async - returns immediately
            // Create a copy to allow overlapping playback of same sound
            if let soundCopy = cachedSound.copy() as? NSSound {
                soundCopy.play()
            } else {
                cachedSound.play()
            }
            return
        }

        // Not cached - load and play (slightly slower but still works)
        if preload(path: path) {
            soundCache[path]?.play()
        }
    }

    /// Stop all currently playing sounds.
    func stopAll() {
        for sound in soundCache.values {
            sound.stop()
        }
    }
}

// MARK: - Message Handler

final class MessageHandler {
    
    /// Process an incoming message from Electron.
    func handle(_ message: IncomingMessage) {
        switch message.type {
        case .getDevices:
            let devices = CoreAudioHelper.shared.listDevices()
            let response = DevicesChangedMessage(devices: devices)
            sendJSON(response)
            
        case .getDefaultInput:
            let deviceId = CoreAudioHelper.shared.getDefaultInputDeviceId()
            let response = DefaultInputChangedMessage(deviceId: deviceId)
            sendJSON(response)
            
        case .setDefaultInput:
            if let deviceId = message.deviceId {
                _ = CoreAudioHelper.shared.setDefaultInputDevice(uid: deviceId)
            } else {
                sendError("setDefaultInput requires deviceId")
            }
            
        case .startMonitoring:
            CoreAudioHelper.shared.startMonitoring()
            
        case .startRecording:
            if RecordingHelper.shared.startRecording() {
                let response = RecordingStartedMessage()
                sendJSON(response)
            } else {
                sendError("Failed to start recording")
            }
            
        case .stopRecording:
            if let filePath = RecordingHelper.shared.stopRecording() {
                let response = RecordingStoppedMessage(filePath: filePath)
                sendJSON(response)
            } else {
                sendError("Failed to stop recording")
            }
            
        case .snapshotRecording:
            if let filePath = RecordingHelper.shared.snapshotRecording() {
                let response = RecordingSnapshotMessage(filePath: filePath)
                sendJSON(response)
            } else {
                sendError("Failed to snapshot recording")
            }

        case .cancelRecording:
            RecordingHelper.shared.cancelRecording()
            let response = RecordingCancelledMessage()
            sendJSON(response)
            
        case .checkPermissions:
            let accessibilityGranted = KeyboardMonitor.shared.checkAccessibilityPermission()
            // Note: We no longer check inputMonitoringPermission as it's not needed
            // and checking it causes the app to appear in Input Monitoring settings
            let response = PermissionsStatusMessage(
                accessibilityGranted: accessibilityGranted
            )
            sendJSON(response)
            
        case .checkFocusedTextInput:
            let hasTextInput = KeyboardMonitor.shared.checkFocusedTextInput()
            let response = FocusedTextInputStatusMessage(hasTextInput: hasTextInput)
            sendJSON(response)

        case .getFrontmostWindowBounds:
            let bounds = getFrontmostWindowBounds()
            let response = FrontmostWindowBoundsMessage(windowBounds: bounds)
            sendJSON(response)

        case .preloadSounds:
            if let paths = message.soundPaths {
                let count = SoundHelper.shared.preloadAll(paths: paths)
                let response = SoundsPreloadedMessage(count: count)
                sendJSON(response)
            } else {
                sendError("preloadSounds requires soundPaths array")
            }

        case .playSound:
            if let path = message.soundPath {
                SoundHelper.shared.play(path: path)
                // Fire-and-forget - no response needed for minimal latency
            } else {
                sendError("playSound requires soundPath")
            }

        case .stopSounds:
            SoundHelper.shared.stopAll()
            sendLog(level: "info", message: "All sounds stopped")

        case .typeIntoApp:
            guard let bundleId = message.bundleId, let text = message.text else {
                sendError("typeIntoApp requires bundleId and text")
                let result = TypeIntoAppResultMessage(success: false, error: "Missing bundleId or text")
                sendJSON(result)
                return
            }
            let pressEnter = message.pressEnter ?? false
            typeIntoApp(bundleId: bundleId, text: text, pressEnter: pressEnter)

        case .focusWindowByTitle:
            guard let bundleId = message.bundleId, let titleSubstring = message.titleSubstring else {
                sendError("focusWindowByTitle requires bundleId and titleSubstring")
                let result = FocusWindowByTitleResultMessage(success: false, error: "Missing bundleId or titleSubstring")
                sendJSON(result)
                return
            }
            focusWindowByTitle(bundleId: bundleId, titleSubstring: titleSubstring)

        case .setHarvestMode:
            if let mode = message.mode {
                RecordingHelper.shared.setHarvestMode(mode)
                sendLog(level: "info", message: "Harvest mode set to: \(mode)")
            } else {
                sendError("setHarvestMode requires mode")
            }

        case .setWindowFrame:
            guard let pid = message.pid,
                  let title = message.title,
                  let x = message.x,
                  let y = message.y,
                  let width = message.width,
                  let height = message.height else {
                sendError("setWindowFrame requires pid, title, x, y, width, height")
                let result = WindowFrameSetMessage(success: false)
                sendJSON(result)
                return
            }
            let sourceFrame: CGRect?
            if let sourceX = message.sourceX,
               let sourceY = message.sourceY,
               let sourceWidth = message.sourceWidth,
               let sourceHeight = message.sourceHeight {
                sourceFrame = CGRect(
                    x: CGFloat(sourceX),
                    y: CGFloat(sourceY),
                    width: CGFloat(sourceWidth),
                    height: CGFloat(sourceHeight)
                )
            } else {
                sourceFrame = nil
            }
            let success = WindowAnimator.shared.setFrame(
                pid: pid_t(pid),
                title: title,
                x: x,
                y: y,
                width: width,
                height: height,
                sourceFrame: sourceFrame
            )
            let result = WindowFrameSetMessage(success: success)
            sendJSON(result)

        case .getWindowList:
            let windows = WindowAnimator.shared.getWindowList()
            let result = WindowListMessage(windows: windows)
            sendJSON(result)

        case .startGazeTracking:
            let targetFps = message.targetFps ?? 15
            GazeTrackingHelper.shared.start(targetFps: targetFps) { status in
                sendJSON(status)
            }

        case .stopGazeTracking:
            let status = GazeTrackingHelper.shared.stop()
            sendJSON(status)

        case .getGazeTrackingStatus:
            let status = GazeTrackingHelper.shared.status()
            sendJSON(status)
        }
    }

    /// Type text into a target application using pasteboard + CGEvent key simulation.
    /// Strategy: write text to pasteboard, activate app, Cmd+V, optionally Enter.
    private func typeIntoApp(bundleId: String, text: String, pressEnter: Bool) {
        // Find the running app by bundle ID.
        guard let targetApp = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) else {
            let result = TypeIntoAppResultMessage(success: false, error: "App not running: \(bundleId)")
            sendJSON(result)
            return
        }

        // Write text to pasteboard (don't save/restore — simpler, avoids races with ClipboardManager).
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // Activate the target app.
        targetApp.activate(options: .activateIgnoringOtherApps)

        // Brief delay for app activation.
        usleep(100_000) // 100ms

        // Simulate Cmd+V (paste).
        let source = CGEventSource(stateID: .combinedSessionState)

        // Key down: V with Command modifier
        if let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true) {
            keyDown.flags = .maskCommand
            keyDown.post(tap: .cghidEventTap)
        }
        // Key up: V with Command modifier
        if let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false) {
            keyUp.flags = .maskCommand
            keyUp.post(tap: .cghidEventTap)
        }

        // Delay for paste to complete before pressing Enter.
        usleep(200_000) // 200ms

        // Optionally press Enter (clear flags to avoid Cmd+Enter triggering fullscreen).
        if pressEnter {
            if let enterDown = CGEvent(keyboardEventSource: source, virtualKey: 0x24, keyDown: true) {
                enterDown.flags = []
                enterDown.post(tap: .cghidEventTap)
            }
            if let enterUp = CGEvent(keyboardEventSource: source, virtualKey: 0x24, keyDown: false) {
                enterUp.flags = []
                enterUp.post(tap: .cghidEventTap)
            }
        }

        let result = TypeIntoAppResultMessage(success: true, error: nil)
        sendJSON(result)
    }

    /// Focus a specific window of an app by matching a substring in its title.
    /// Uses AXUIElement to enumerate windows and raise the matching one.
    private func focusWindowByTitle(bundleId: String, titleSubstring: String) {
        // Find the running app by bundle ID.
        guard let targetApp = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) else {
            let result = FocusWindowByTitleResultMessage(success: false, error: "App not running: \(bundleId)")
            sendJSON(result)
            return
        }

        let pid = targetApp.processIdentifier
        let appElement = AXUIElementCreateApplication(pid)

        // Get windows array.
        var windowsValue: CFTypeRef?
        let windowsResult = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsValue)

        guard windowsResult == .success, let windows = windowsValue as? [AXUIElement] else {
            let result = FocusWindowByTitleResultMessage(success: false, error: "Cannot enumerate windows (AXError=\(windowsResult.rawValue))")
            sendJSON(result)
            return
        }

        // Find the window whose title contains the substring.
        for window in windows {
            var titleValue: CFTypeRef?
            let titleResult = AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue)

            guard titleResult == .success, let title = titleValue as? String else {
                continue
            }

            if title.contains(titleSubstring) {
                // Raise the window and activate the app.
                AXUIElementPerformAction(window, kAXRaiseAction as CFString)
                targetApp.activate(options: .activateIgnoringOtherApps)

                let result = FocusWindowByTitleResultMessage(success: true, error: nil)
                sendJSON(result)
                return
            }
        }

        let result = FocusWindowByTitleResultMessage(success: false, error: "No window with title containing '\(titleSubstring)' found")
        sendJSON(result)
    }

    /// Get the bounds of the frontmost window.
    /// Uses CGWindowListCopyWindowInfo which is fast (~1-5ms).
    private func getFrontmostWindowBounds() -> FrontmostWindowBoundsMessage.WindowBounds? {
        // Get the frontmost app's PID.
        guard let frontApp = NSWorkspace.shared.frontmostApplication else {
            return nil
        }
        let pid = frontApp.processIdentifier

        // Get all on-screen windows, ordered front-to-back.
        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        // Find the first (frontmost) window owned by this PID.
        for windowInfo in windowList {
            guard let ownerPID = windowInfo[kCGWindowOwnerPID as String] as? pid_t,
                  ownerPID == pid,
                  let boundsDict = windowInfo[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = boundsDict["X"],
                  let y = boundsDict["Y"],
                  let width = boundsDict["Width"],
                  let height = boundsDict["Height"] else {
                continue
            }

            // Skip windows with layer > 0 (menu bar, dock, etc.)
            if let layer = windowInfo[kCGWindowLayer as String] as? Int, layer > 0 {
                continue
            }

            // Skip very small windows (likely invisible or utility windows).
            if width < 100 || height < 100 {
                continue
            }

            return FrontmostWindowBoundsMessage.WindowBounds(
                x: Int(x),
                y: Int(y),
                width: Int(width),
                height: Int(height)
            )
        }

        return nil
    }
}

// MARK: - Main Entry Point

func setupAndRun() {
    sendLog(level: "info", message: "FieldTheoryHelper started")

    // Start app activation monitoring.
    // This allows us to detect when Field Theory becomes the frontmost app (e.g., via Cmd+Tab).
    _ = AppActivationMonitor.shared.startMonitoring()

    // Broadcast the current frontmost app immediately so Electron has initial state.
    // This fixes Command Launcher paste failing on first use after restart.
    AppActivationMonitor.shared.broadcastCurrentFrontmostApp()
    
    let handler = MessageHandler()
    
    // Read stdin on a background queue so the main run loop can process notification callbacks.
    // This is critical - blocking the main thread with readLine() prevents callbacks from firing.
    DispatchQueue.global(qos: .userInitiated).async {
        while let line = readLine() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            
            guard let data = trimmed.data(using: .utf8) else {
                sendError("Failed to parse input as UTF-8. Input length: \(trimmed.count), first 50 chars: \(String(trimmed.prefix(50)))")
                continue
            }
            
            do {
                let message = try JSONDecoder().decode(IncomingMessage.self, from: data)
                // Handle on main thread for thread safety with UI/event handling.
                DispatchQueue.main.async {
                    handler.handle(message)
                }
            } catch let decodingError as DecodingError {
                var errorDetails = "Failed to parse JSON: "
                switch decodingError {
                case .dataCorrupted(let context):
                    errorDetails += "Data corrupted: \(context.debugDescription)"
                case .keyNotFound(let key, let context):
                    errorDetails += "Key '\(key.stringValue)' not found: \(context.debugDescription)"
                case .typeMismatch(let type, let context):
                    errorDetails += "Type mismatch for \(type): \(context.debugDescription)"
                case .valueNotFound(let type, let context):
                    errorDetails += "Value not found for \(type): \(context.debugDescription)"
                @unknown default:
                    errorDetails += decodingError.localizedDescription
                }
                let inputPreview = trimmed.count > 100 ? String(trimmed.prefix(100)) + "..." : trimmed
                sendError("\(errorDetails). Input preview: \(inputPreview)")
            } catch {
                let inputPreview = trimmed.count > 100 ? String(trimmed.prefix(100)) + "..." : trimmed
                sendError("Failed to parse JSON: \(error.localizedDescription). Input preview: \(inputPreview)")
            }
        }
        
        // If stdin closes, exit the app.
        exit(0)
    }
}

// Setup and start the run loop.
setupAndRun()

// Keep the main run loop alive for notification callbacks.
RunLoop.main.run()
