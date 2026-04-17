//
// Swift voice sampler bridge for temporary on-device/simulator voice inspection.
//

import Foundation
import AVFAudio

@objc(VoiceSamplerModule)
final class VoiceSamplerModule: RCTEventEmitter, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var hasListeners = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    @available(iOS 17.0, *)
    private static func personalVoiceAuthorizationStatusString(
        _ status: AVSpeechSynthesizer.PersonalVoiceAuthorizationStatus
    ) -> String {
        switch status {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .unsupported:
            return "unsupported"
        case .authorized:
            return "authorized"
        @unknown default:
            return "unknown"
        }
    }

    @objc
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        ["speechStateDidChange"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    private func activateSpeechAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
    }

    private func deactivateSpeechAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func sendSpeechState(_ state: String) {
        guard hasListeners else {
            return
        }

        sendEvent(withName: "speechStateDidChange", body: ["state": state])
    }

    @objc(personalVoiceAuthorizationStatus:rejecter:)
    func personalVoiceAuthorizationStatus(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        if #available(iOS 17.0, *) {
            resolve(Self.personalVoiceAuthorizationStatusString(AVSpeechSynthesizer.personalVoiceAuthorizationStatus))
            return
        }

        resolve("unsupported")
    }

    @objc(requestPersonalVoiceAuthorization:rejecter:)
    func requestPersonalVoiceAuthorization(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 17.0, *) {
            AVSpeechSynthesizer.requestPersonalVoiceAuthorization { status in
                DispatchQueue.main.async {
                    resolve(Self.personalVoiceAuthorizationStatusString(status))
                }
            }
            return
        }

        resolve("unsupported")
    }

    @objc(listVoices:rejecter:)
    func listVoices(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        let voices: [[String: Any]] = AVSpeechSynthesisVoice.speechVoices()
            .map { voice in
                let traits: Int
                let isPersonalVoice: Bool
                if #available(iOS 17.0, *) {
                    traits = Int(voice.voiceTraits.rawValue)
                    isPersonalVoice = voice.voiceTraits.contains(.isPersonalVoice)
                } else {
                    traits = 0
                    isPersonalVoice = false
                }

                return [
                    "id": voice.identifier,
                    "name": voice.name,
                    "language": voice.language,
                    "quality": voice.quality.rawValue,
                    "traits": traits,
                    "isEloquence": voice.identifier.contains(".eloquence."),
                    "isLegacyNovelty": voice.identifier.contains("com.apple.speech.synthesis.voice."),
                    "isSuperCompact": voice.identifier.contains(".voice.super-compact."),
                    "isPersonalVoice": isPersonalVoice,
                ]
            }
            .sorted {
                let leftLanguage = ($0["language"] as? String) ?? ""
                let rightLanguage = ($1["language"] as? String) ?? ""
                if leftLanguage == rightLanguage {
                    let leftName = ($0["name"] as? String) ?? ""
                    let rightName = ($1["name"] as? String) ?? ""
                    return leftName.localizedCaseInsensitiveCompare(rightName) == .orderedAscending
                }
                return leftLanguage.localizedCaseInsensitiveCompare(rightLanguage) == .orderedAscending
            }

        resolve(voices)
    }

    @objc(speak:text:)
    func speak(_ identifier: String, text: String) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)

            guard let voice = AVSpeechSynthesisVoice(identifier: identifier) else {
                NSLog("VoiceSamplerModule: missing voice for identifier %@", identifier)
                return
            }

            do {
                try self.activateSpeechAudioSession()
            } catch {
                NSLog("VoiceSamplerModule: failed to activate speech audio session: %@", error.localizedDescription)
                return
            }

            let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let utterance = AVSpeechUtterance(string: trimmedText.isEmpty ? "Voice sampler test." : trimmedText)
            utterance.voice = voice
            utterance.rate = 0.47
            utterance.prefersAssistiveTechnologySettings = false

            self.synthesizer.speak(utterance)
        }
    }

    @objc
    func pause() {
        DispatchQueue.main.async {
            _ = self.synthesizer.pauseSpeaking(at: .immediate)
        }
    }

    @objc
    func resume() {
        DispatchQueue.main.async {
            _ = self.synthesizer.continueSpeaking()
        }
    }

    @objc
    func stop() {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            self.deactivateSpeechAudioSession()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        sendSpeechState("speaking")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didPause utterance: AVSpeechUtterance) {
        sendSpeechState("paused")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didContinue utterance: AVSpeechUtterance) {
        sendSpeechState("speaking")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        deactivateSpeechAudioSession()
        sendSpeechState("stopped")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        deactivateSpeechAudioSession()
        sendSpeechState("stopped")
    }
}
