// =============================================================================
// LittleOneHelper - Swift CLI for CoreAudio integration.
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
    case cancelRecording
    case checkPermissions
    case checkFocusedTextInput
    case startKeyboardMonitoring
    case stopKeyboardMonitoring
}

/// Message received from Electron.
struct IncomingMessage: Codable {
    let type: MessageType
    let deviceId: String?
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

struct RecordingCancelledMessage: Codable {
    let type = "recordingCancelled"
    
    enum CodingKeys: String, CodingKey {
        case type
    }
}

struct AudioLevelMessage: Codable {
    let type = "audioLevel"
    let level: Double  // 0.0 to 1.0
    
    enum CodingKeys: String, CodingKey {
        case type
        case level
    }
}

struct PermissionsStatusMessage: Codable {
    let type = "permissionsStatus"
    let accessibilityGranted: Bool
    let inputMonitoringGranted: Bool
    
    enum CodingKeys: String, CodingKey {
        case type
        case accessibilityGranted
        case inputMonitoringGranted
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

struct KeyEventMessage: Codable {
    let type = "keyEvent"
    let characters: String
    let keyCode: Int
    let modifiers: [String]
    
    enum CodingKeys: String, CodingKey {
        case type
        case characters
        case keyCode
        case modifiers
    }
}

struct KeyboardMonitoringDisabledMessage: Codable {
    let type = "keyboardMonitoringDisabled"
    
    enum CodingKeys: String, CodingKey {
        case type
    }
}

struct MenuBarClickedMessage: Codable {
    let type = "menuBarClicked"
    
    enum CodingKeys: String, CodingKey {
        case type
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

// MARK: - Keyboard Monitor

/// Manages global keyboard event monitoring using CGEventTap.
/// Captures keyboard input without stealing focus from the active application.
final class KeyboardMonitor {
    
    static let shared = KeyboardMonitor()
    
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var isMonitoring = false
    
    private init() {}
    
    /// Check if Input Monitoring permission is granted.
    /// Attempts to create a test event tap - if it returns nil, permission is denied.
    func checkInputMonitoringPermission() -> Bool {
        // Try to create a test event tap
        let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
        let testTap = CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(eventMask),
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                return Unmanaged.passUnretained(event)
            },
            userInfo: nil
        )
        
        // If tap is nil, permission is denied
        if testTap == nil {
            return false
        }
        
        // Clean up test tap
        if let tap = testTap {
            CFMachPortInvalidate(tap)
        }
        
        return true
    }
    
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
    
    /// Start monitoring keyboard events.
    /// Only captures events when clipboard history window is visible.
    func startMonitoring() -> Bool {
        guard !isMonitoring else {
            sendLog(level: "info", message: "Keyboard monitoring already active")
            return true
        }
        
        // Check permissions first
        guard checkInputMonitoringPermission() else {
            sendLog(level: "error", message: "Input Monitoring permission denied")
            return false
        }
        
        // Create event tap for keyDown and keyUp events
        let eventMask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
        
        eventTap = CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: CGEventMask(eventMask),
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                // Call the callback on the KeyboardMonitor instance
                let monitor = Unmanaged<KeyboardMonitor>.fromOpaque(refcon!).takeUnretainedValue()
                return monitor.handleEvent(proxy: proxy, type: type, event: event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        )
        
        guard let tap = eventTap else {
            sendLog(level: "error", message: "Failed to create keyboard event tap - permission may be denied")
            return false
        }
        
        // Check if tap is enabled (may be disabled by user input)
        if CGEvent.tapIsEnabled(tap: tap) {
            // Create run loop source
            runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            if let source = runLoopSource {
                // Add to main run loop - CGEventTap callbacks must run on main run loop
                CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            }
            
            isMonitoring = true
            sendLog(level: "info", message: "Keyboard monitoring started")
            return true
        } else {
            // Tap was disabled (likely permission issue)
            CFMachPortInvalidate(tap)
            eventTap = nil
            sendLog(level: "error", message: "Keyboard event tap disabled - permission may have been revoked")
            let message = KeyboardMonitoringDisabledMessage()
            sendJSON(message)
            return false
        }
    }
    
    /// Stop monitoring keyboard events.
    func stopMonitoring() {
        guard isMonitoring else {
            return
        }
        
        if let source = runLoopSource {
            // Remove from main run loop (where we added it)
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            runLoopSource = nil
        }
        
        if let tap = eventTap {
            CFMachPortInvalidate(tap)
            eventTap = nil
        }
        
        isMonitoring = false
        sendLog(level: "info", message: "Keyboard monitoring stopped")
    }
    
    /// Handle keyboard event from CGEventTap callback.
    private func handleEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        // Check if tap was disabled (user may have revoked permission)
        if type == .tapDisabledByUserInput || type == .tapDisabledByTimeout {
            sendLog(level: "warn", message: "Keyboard event tap disabled")
            let message = KeyboardMonitoringDisabledMessage()
            sendJSON(message)
            stopMonitoring()
            return nil
        }
        
        // Only process keyDown events (we'll handle keyUp if needed later)
        guard type == .keyDown else {
            return Unmanaged.passUnretained(event)
        }
        
        // Extract key information
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags
        
        // Get characters (Unicode string)
        var characters: String = ""
        var length: Int = 0
        var buffer = [UniChar](repeating: 0, count: 8)
        event.keyboardGetUnicodeString(maxStringLength: buffer.count, actualStringLength: &length, unicodeString: &buffer)
        if length > 0 {
            characters = String(utf16CodeUnits: buffer, count: Int(length))
        }
        
        // Build modifiers array
        var modifiers: [String] = []
        if flags.contains(.maskCommand) {
            modifiers.append("meta")
        }
        if flags.contains(.maskShift) {
            modifiers.append("shift")
        }
        if flags.contains(.maskControl) {
            modifiers.append("ctrl")
        }
        if flags.contains(.maskAlternate) {
            modifiers.append("alt")
        }
        
        // Send key event to Electron
        let keyMessage = KeyEventMessage(
            characters: characters,
            keyCode: Int(keyCode),
            modifiers: modifiers
        )
        sendJSON(keyMessage)
        
        // Consume the event (don't let it reach the original app)
        // This is the "intercepting" behavior - we swallow the keystroke
        return nil
    }
}

// MARK: - Menu Bar Monitor

/// Monitors for mouse clicks in the menu bar area.
/// Sends a message to Electron when the menu bar is clicked so Field Theory can hide.
final class MenuBarMonitor {
    
    static let shared = MenuBarMonitor()
    
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var isMonitoring = false
    
    // Menu bar is approximately 24-25 pixels tall on standard displays.
    // On notched MacBooks, the safe area is handled differently but clicks in that region
    // still count as menu bar area for our purposes.
    private let menuBarHeight: CGFloat = 25
    
    private init() {}
    
    /// Start monitoring for menu bar clicks.
    func startMonitoring() -> Bool {
        guard !isMonitoring else {
            return true
        }
        
        // Create event tap for left mouse down events.
        // We use listenOnly so we don't block the event - just observe it.
        let eventMask = (1 << CGEventType.leftMouseDown.rawValue)
        
        eventTap = CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,  // Don't block events, just observe
            eventsOfInterest: CGEventMask(eventMask),
            callback: { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in
                let monitor = Unmanaged<MenuBarMonitor>.fromOpaque(refcon!).takeUnretainedValue()
                monitor.handleMouseEvent(event: event)
                return Unmanaged.passUnretained(event)  // Pass event through unchanged
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        )
        
        guard let tap = eventTap else {
            sendLog(level: "error", message: "Failed to create menu bar event tap")
            return false
        }
        
        if CGEvent.tapIsEnabled(tap: tap) {
            runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            if let source = runLoopSource {
                CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
            }
            
            isMonitoring = true
            sendLog(level: "info", message: "Menu bar monitoring started")
            return true
        } else {
            CFMachPortInvalidate(tap)
            eventTap = nil
            sendLog(level: "error", message: "Menu bar event tap disabled")
            return false
        }
    }
    
    /// Stop monitoring for menu bar clicks.
    func stopMonitoring() {
        guard isMonitoring else { return }
        
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
            runLoopSource = nil
        }
        
        if let tap = eventTap {
            CFMachPortInvalidate(tap)
            eventTap = nil
        }
        
        isMonitoring = false
        sendLog(level: "info", message: "Menu bar monitoring stopped")
    }
    
    /// Handle a mouse event and check if it's in the menu bar area.
    private func handleMouseEvent(event: CGEvent) {
        let location = event.location
        
        // Get the screen that contains this click.
        // CGEvent location is in global coordinates where (0,0) is top-left of main display.
        // Menu bar is at the top of each screen.
        guard let screen = NSScreen.screens.first(where: { screen in
            // Check if click is within this screen's bounds
            let frame = screen.frame
            return location.x >= frame.minX && location.x <= frame.maxX
        }) else {
            return
        }
        
        // Calculate the top of the screen in global coordinates.
        // NSScreen.frame.maxY gives the top edge in Cocoa coordinates (origin at bottom-left).
        // But CGEvent uses Quartz coordinates (origin at top-left of main screen).
        let mainScreenHeight = NSScreen.main?.frame.height ?? 0
        let screenTopInQuartz = mainScreenHeight - screen.frame.maxY
        
        // Check if click is in menu bar area (within menuBarHeight from top of this screen).
        if location.y >= screenTopInQuartz && location.y <= screenTopInQuartz + menuBarHeight {
            sendJSON(MenuBarClickedMessage())
        }
    }
}

// MARK: - App Activation Monitor

/// Monitors when Field Theory becomes the frontmost application.
/// Sends a message to Electron so it can show the clipboard window.
final class AppActivationMonitor {
    
    static let shared = AppActivationMonitor()
    
    private var observer: NSObjectProtocol?
    private var isMonitoring = false
    
    private init() {}
    
    /// Start monitoring for app activation.
    func startMonitoring() -> Bool {
        guard !isMonitoring else {
            return true
        }
        
        // Listen for when our app becomes active (frontmost).
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppActivation(notification: notification)
        }
        
        isMonitoring = true
        sendLog(level: "info", message: "App activation monitoring started")
        return true
    }
    
    /// Stop monitoring.
    func stopMonitoring() {
        guard isMonitoring else { return }
        
        if let observer = observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            self.observer = nil
        }
        
        isMonitoring = false
        sendLog(level: "info", message: "App activation monitoring stopped")
    }
    
    /// Handle app activation notification.
    private func handleAppActivation(notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            sendLog(level: "debug", message: "AppActivationMonitor: No app in notification")
            return
        }
        
        // Check if the activated app is our parent process (Electron).
        // This is more reliable than bundle ID matching because:
        // - Works in dev mode, production, and any bundle ID configuration
        // - getppid() returns the parent process ID that spawned this helper
        let parentPid = getppid()
        let activatedPid = app.processIdentifier
        
        // HTTP debug log (appears in debug.log file)
        let debugUrl = URL(string: "http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03")!
        var request = URLRequest(url: debugUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload = """
        {"location":"main.swift:handleAppActivation","message":"app-activated","data":{"activatedPid":\(activatedPid),"parentPid":\(parentPid),"name":"\(app.localizedName ?? "unknown")","match":\(activatedPid == parentPid)},"timestamp":\(Int(Date().timeIntervalSince1970 * 1000)),"sessionId":"debug-session","hypothesisId":"H16"}
        """
        request.httpBody = payload.data(using: .utf8)
        URLSession.shared.dataTask(with: request).resume()
        
        sendLog(level: "debug", message: "AppActivationMonitor: activated=\(activatedPid) parent=\(parentPid) name=\(app.localizedName ?? "unknown")")
        
        if activatedPid == parentPid {
            sendLog(level: "debug", message: "Field Theory (parent process) became frontmost app")
            sendJSON(AppBecameFrontmostMessage())
        }
    }
}

/// Message sent when Field Theory becomes the frontmost app.
struct AppBecameFrontmostMessage: Codable {
    let type = "appBecameFrontmost"
    
    enum CodingKeys: String, CodingKey {
        case type
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
    
    private init() {}
    
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
            file = try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMIsBigEndianKey: false
            ])
            audioFile = file
        } catch {
            sendLog(level: "error", message: "Failed to create audio file: \(error.localizedDescription)")
            return false
        }
        
        // Install tap on input node
        let bufferSize: AVAudioFrameCount = 4096
        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self, self.isRecording, let audioFile = self.audioFile else { return }
            
            // Calculate audio level (RMS) for live waveform display
            if let channelData = buffer.floatChannelData {
                let channel = channelData[0]
                let frameLength = Int(buffer.frameLength)
                var sum: Float = 0
                for i in 0..<frameLength {
                    let sample = channel[i]
                    sum += sample * sample
                }
                let rms = sqrt(sum / Float(frameLength))
                // Normalize to 0-1 range (assuming max amplitude is 1.0)
                let level = min(1.0, Double(rms))
                
                // Send audio level to Electron for live waveform
                let levelMessage = AudioLevelMessage(level: level)
                sendJSON(levelMessage)
            }
            
            // Convert to target format if needed
            if inputFormat.sampleRate != format.sampleRate || inputFormat.channelCount != format.channelCount {
                guard let converter = AVAudioConverter(from: inputFormat, to: format) else {
                    sendLog(level: "error", message: "Failed to create audio converter")
                    return
                }
                
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / inputFormat.sampleRate)
                guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
                    return
                }
                
                var error: NSError?
                let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
                    outStatus.pointee = .haveData
                    return buffer
                }
                
                converter.convert(to: convertedBuffer, error: &error, withInputFrom: inputBlock)
                
                if let error = error {
                    sendLog(level: "error", message: "Audio conversion error: \(error.localizedDescription)")
                    return
                }
                
                // Write converted buffer to file
                do {
                    try audioFile.write(from: convertedBuffer)
                } catch {
                    sendLog(level: "error", message: "Failed to write audio buffer: \(error.localizedDescription)")
                }
            } else {
                // No conversion needed, write directly
                do {
                    try audioFile.write(from: buffer)
                } catch {
                    sendLog(level: "error", message: "Failed to write audio buffer: \(error.localizedDescription)")
                }
            }
        }
        
        audioEngine = engine
        
        // Start engine
        do {
            try engine.start()
            isRecording = true
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
    
    /// Cancel recording without saving.
    func cancelRecording() {
        guard isRecording else {
            return
        }
        
        isRecording = false
        
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        
        // Delete the file if it exists
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        
        audioEngine = nil
        audioFile = nil
        recordingURL = nil
        
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
            
        case .cancelRecording:
            RecordingHelper.shared.cancelRecording()
            let response = RecordingCancelledMessage()
            sendJSON(response)
            
        case .checkPermissions:
            let accessibilityGranted = KeyboardMonitor.shared.checkAccessibilityPermission()
            let inputMonitoringGranted = KeyboardMonitor.shared.checkInputMonitoringPermission()
            let response = PermissionsStatusMessage(
                accessibilityGranted: accessibilityGranted,
                inputMonitoringGranted: inputMonitoringGranted
            )
            sendJSON(response)
            
        case .checkFocusedTextInput:
            let hasTextInput = KeyboardMonitor.shared.checkFocusedTextInput()
            let response = FocusedTextInputStatusMessage(hasTextInput: hasTextInput)
            sendJSON(response)
            
        case .startKeyboardMonitoring:
            if KeyboardMonitor.shared.startMonitoring() {
                sendLog(level: "info", message: "Keyboard monitoring started successfully")
            } else {
                sendError("Failed to start keyboard monitoring - check Input Monitoring permission")
            }
            
        case .stopKeyboardMonitoring:
            KeyboardMonitor.shared.stopMonitoring()
            sendLog(level: "info", message: "Keyboard monitoring stopped")
        }
    }
}

// MARK: - Main Entry Point

func setupAndRun() {
    sendLog(level: "info", message: "LittleOneHelper started")
    
    // Start menu bar monitoring immediately.
    // This allows us to detect when user clicks on the menu bar to hide Field Theory.
    _ = MenuBarMonitor.shared.startMonitoring()
    
    // Start app activation monitoring.
    // This allows us to detect when Field Theory becomes the frontmost app (e.g., via Cmd+Tab).
    _ = AppActivationMonitor.shared.startMonitoring()
    
    let handler = MessageHandler()
    
    // Read stdin on a background queue so the main run loop can process CGEventTap callbacks.
    // This is critical - blocking the main thread with readLine() prevents event callbacks from firing.
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

// Keep the main run loop alive for CGEventTap and other callbacks.
RunLoop.main.run()
