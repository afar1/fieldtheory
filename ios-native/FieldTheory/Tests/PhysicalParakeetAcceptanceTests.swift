import AVFoundation
import UIKit
import XCTest
@testable import FieldTheory

/// Opt-in physical-device evidence. Fixtures are copied into this app's
/// Documents/VoiceAcceptance folder; ordinary CI/simulator runs never download
/// models, create user transcripts, or claim physical-device acceptance.
final class PhysicalParakeetAcceptanceTests: XCTestCase {
    @MainActor
    func testPreparedParakeetOnPhysicalPhone() async throws {
#if targetEnvironment(simulator)
        throw XCTSkip("Requires the intended physical phone and prepared local assets")
#else
        let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoiceAcceptance", isDirectory: true)
        let short = root.appendingPathComponent("short.wav")
        let long = root.appendingPathComponent("long.wav")
        guard FileManager.default.fileExists(atPath: short.path),
              FileManager.default.fileExists(atPath: long.path) else {
            throw XCTSkip("Copy the synthetic acceptance fixtures before this opt-in run")
        }
        let models = ParakeetModelManager()
        await models.checkLocalReadiness()
        let directory = try XCTUnwrap(models.readyModelDirectory,
            "Download and prepare Parakeet through Settings before physical acceptance")
        let service = ParakeetService()
        var measurements: [[String: Any]] = []
        for (name, file, warm) in [("short-cold", short, false),
                                    ("short-warm", short, true),
                                    ("long-warm", long, true)] {
            let audio = try AVAudioFile(forReading: file)
            let duration = Double(audio.length) / audio.processingFormat.sampleRate
            let started = Date()
            let text = try await service.transcribe(audioURL: file, modelDirectory: directory)
            let elapsed = Date().timeIntervalSince(started)
            measurements.append([
                "sample": name, "engine": ParakeetModelManager.identity,
                "warm": warm, "audioDurationSeconds": duration,
                "fileToTextSeconds": elapsed, "realtimeFactor": elapsed / duration,
                "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
                "text": text,
            ])
            let report: [String: Any] = [
                "device": UIDevice.current.model,
                "os": UIDevice.current.systemVersion,
                "sourceCommit": Bundle.main.object(forInfoDictionaryKey: "FTBuildCommit") as? String ?? "unknown",
                "networkClaim": "Local-only loader and inference API; radio state is not asserted by this fixture test",
                "timingBoundary": "file-to-text on physical phone, not microphone stop-to-visible",
                "measurements": measurements,
            ]
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                .write(to: root.appendingPathComponent("parakeet-physical-results.json"), options: .atomic)
            XCTAssertFalse(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name)
            XCTAssertTrue(text.lowercased().contains("field theory"), name)
            XCTAssertTrue(text.lowercased().contains("next steps"), name)
        }
        await service.unload()
#endif
    }
}
