import SwiftUI
import AVFAudio
import AppKit

struct VoiceEntry: Identifiable, Equatable {
    let id: String
    let name: String
    let language: String
    let quality: Int
    let traits: Int

    var isEloquence: Bool {
        id.contains(".eloquence.")
    }

    var isLegacyNovelty: Bool {
        id.contains("com.apple.speech.synthesis.voice.")
    }

    var isSuperCompact: Bool {
        id.contains(".voice.super-compact.")
    }

    var isCompactOrBetter: Bool {
        id.contains(".voice.compact.") || !isSuperCompact
    }

    var isEnglish: Bool {
        language.hasPrefix("en")
    }
}

@MainActor
final class VoiceSamplerModel: NSObject, ObservableObject, @preconcurrency AVSpeechSynthesizerDelegate {
    @Published var searchText = ""
    @Published var sampleText = "The quick brown fox jumps over the lazy dog. This is the Field Theory voice sampler."
    @Published var selectedVoiceID: String?
    @Published private(set) var speakingVoiceID: String?
    @Published private(set) var copiedVoiceID: String?
    @Published var englishOnly = true
    @Published var hideLegacyAndNovelty = true
    @Published var hideSuperCompact = false

    let voices: [VoiceEntry]

    private let synthesizer = AVSpeechSynthesizer()
    private var copiedResetTask: Task<Void, Never>?

    override init() {
        self.voices = AVSpeechSynthesisVoice.speechVoices()
            .map { voice in
                VoiceEntry(
                    id: voice.identifier,
                    name: voice.name,
                    language: voice.language,
                    quality: voice.quality.rawValue,
                    traits: Int(voice.voiceTraits.rawValue)
                )
            }
            .sorted {
                if $0.language == $1.language {
                    return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                }
                return $0.language.localizedCaseInsensitiveCompare($1.language) == .orderedAscending
            }

        super.init()
        synthesizer.delegate = self
        selectedVoiceID = voices.first?.id
    }

    var filteredVoices: [VoiceEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)

        return voices.filter { voice in
            if englishOnly && !voice.isEnglish {
                return false
            }

            if hideLegacyAndNovelty && (voice.isEloquence || voice.isLegacyNovelty || voice.traits != 0) {
                return false
            }

            if hideSuperCompact && voice.isSuperCompact {
                return false
            }

            if query.isEmpty {
                return true
            }

            return voice.name.localizedCaseInsensitiveContains(query) ||
                voice.language.localizedCaseInsensitiveContains(query) ||
                voice.id.localizedCaseInsensitiveContains(query)
        }
    }

    func speak(_ voice: VoiceEntry) {
        stop()
        guard let speechVoice = AVSpeechSynthesisVoice(identifier: voice.id) else { return }

        let utterance = AVSpeechUtterance(string: sampleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Voice sampler test." : sampleText)
        utterance.voice = speechVoice
        utterance.rate = 0.47
        utterance.prefersAssistiveTechnologySettings = false

        selectedVoiceID = voice.id
        speakingVoiceID = voice.id
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        speakingVoiceID = nil
    }

    func copyIdentifier(_ voice: VoiceEntry) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(voice.id, forType: .string)
        copiedVoiceID = voice.id

        copiedResetTask?.cancel()
        copiedResetTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            self?.copiedVoiceID = nil
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speakingVoiceID = nil
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speakingVoiceID = nil
    }
}

struct VoiceRowView: View {
    let voice: VoiceEntry
    let isSelected: Bool
    let isSpeaking: Bool
    let wasCopied: Bool
    let onSelect: () -> Void
    let onPlay: () -> Void
    let onCopy: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(voice.name)
                        .font(.headline)
                    if isSpeaking {
                        Text("Speaking")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.accentColor.opacity(0.15))
                            .clipShape(Capsule())
                    }
                    if wasCopied {
                        Text("Copied")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }

                Text("\(voice.language)  quality:\(voice.quality)  traits:\(voice.traits)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(voice.id)
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 12)

            HStack(spacing: 8) {
                Button("Play", action: onPlay)
                Button("Copy ID", action: onCopy)
                    .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? Color.accentColor.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

struct VoiceSamplerView: View {
    @StateObject private var model = VoiceSamplerModel()

    var body: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Voice Sampler")
                    .font(.title2.weight(.semibold))

                Text("Plays the macOS voices exposed through AVSpeechSynthesizer. Curated mode hides Eloquence, novelty voices, and optionally the tiny super-compact voices so the list is closer to current Apple speech voices.")
                    .foregroundStyle(.secondary)

                HStack(spacing: 12) {
                    TextField("Search by name, language, or identifier", text: $model.searchText)
                        .textFieldStyle(.roundedBorder)

                    Button("Stop") {
                        model.stop()
                    }
                }

                HStack(spacing: 16) {
                    Toggle("English only", isOn: $model.englishOnly)
                    Toggle("Hide legacy/novelty", isOn: $model.hideLegacyAndNovelty)
                    Toggle("Hide super-compact", isOn: $model.hideSuperCompact)
                }
                .toggleStyle(.checkbox)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Sample Text")
                        .font(.subheadline.weight(.medium))
                    TextEditor(text: $model.sampleText)
                        .font(.body)
                        .frame(minHeight: 90)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                        )
                }

                Text("\(model.filteredVoices.count) voices")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if model.hideLegacyAndNovelty {
                    Text("This Mac still may not expose the downloadable Siri voices from current iPhone Settings, so curated mode is only an approximation.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            List(model.filteredVoices) { voice in
                VoiceRowView(
                    voice: voice,
                    isSelected: model.selectedVoiceID == voice.id,
                    isSpeaking: model.speakingVoiceID == voice.id,
                    wasCopied: model.copiedVoiceID == voice.id,
                    onSelect: {
                        model.selectedVoiceID = voice.id
                    },
                    onPlay: {
                        model.speak(voice)
                    },
                    onCopy: {
                        model.copyIdentifier(voice)
                    }
                )
                .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
        }
        .padding(20)
        .frame(minWidth: 900, minHeight: 700)
    }
}

@main
struct VoiceSamplerApp: App {
    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }

    var body: some Scene {
        WindowGroup {
            VoiceSamplerView()
        }
        .windowResizability(.contentSize)
    }
}
