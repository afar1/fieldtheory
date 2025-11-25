// =============================================================================
// LittleOneHelper - Swift CLI for CoreAudio integration.
// Communicates with Electron via JSON over stdin/stdout.
// =============================================================================

import Foundation
import CoreAudio
import AudioToolbox

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
}

struct DefaultInputChangedMessage: Codable {
    let type = "defaultInputChanged"
    let deviceId: String?
}

struct LogMessage: Codable {
    let type = "log"
    let level: String
    let message: String
}

struct ErrorMessage: Codable {
    let type = "error"
    let message: String
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
    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8) else {
        return
    }
    print(json)
    fflush(stdout)
}

/// Send a log message to Electron.
func sendLog(level: String, message: String) {
    let logMessage = LogMessage(type: "log", level: level, message: message)
    sendJSON(logMessage)
}

/// Send an error message to Electron.
func sendError(_ message: String) {
    let errorMessage = ErrorMessage(type: "error", message: message)
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
        }
    }
}

// MARK: - Main Entry Point

func main() {
    sendLog(level: "info", message: "LittleOneHelper started")
    
    let handler = MessageHandler()
    
    // Read JSON messages from stdin, one per line.
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { continue }
        
        guard let data = trimmed.data(using: .utf8) else {
            sendError("Failed to parse input as UTF-8")
            continue
        }
        
        do {
            let message = try JSONDecoder().decode(IncomingMessage.self, from: data)
            handler.handle(message)
        } catch {
            sendError("Failed to parse JSON: \(error.localizedDescription)")
        }
    }
}

// Run the main loop.
main()

// Keep the run loop alive for callbacks.
RunLoop.main.run()
