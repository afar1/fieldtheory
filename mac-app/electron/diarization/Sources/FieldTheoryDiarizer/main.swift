import FluidAudio
import Foundation

private let sidecarProtocolVersion = 1

private struct DiarizationRequest: Decodable {
    let type: String
    let audioPath: String?
}

private struct SpeakerInterval: Encodable {
    let speakerId: String
    let startTimeSeconds: Double
    let endTimeSeconds: Double
    let qualityScore: Double
}

private struct SidecarResponse: Encodable {
    let ok: Bool
    let ready: Bool?
    let protocolVersion: Int?
    let speakerCount: Int?
    let segments: [SpeakerInterval]?
    let error: String?

    static func readyResponse() -> SidecarResponse {
        SidecarResponse(
            ok: true,
            ready: true,
            protocolVersion: sidecarProtocolVersion,
            speakerCount: nil,
            segments: nil,
            error: nil
        )
    }

    static func success(segments: [SpeakerInterval]) -> SidecarResponse {
        SidecarResponse(
            ok: true,
            ready: nil,
            protocolVersion: sidecarProtocolVersion,
            speakerCount: Set(segments.map(\.speakerId)).count,
            segments: segments,
            error: nil
        )
    }

    static func failure(_ message: String) -> SidecarResponse {
        SidecarResponse(
            ok: false,
            ready: nil,
            protocolVersion: sidecarProtocolVersion,
            speakerCount: nil,
            segments: nil,
            error: message
        )
    }
}

@available(macOS 14.0, *)
private final class DiarizationService {
    private let manager: OfflineDiarizerManager
    private var modelsPrepared = false

    init() {
        let config = OfflineDiarizerConfig(
            segmentationStepRatio: 0.1,
            minSegmentDuration: 0.0,
            exclusiveSegments: false
        )
        manager = OfflineDiarizerManager(config: config)
    }

    func diarize(audioPath: String) async throws -> [SpeakerInterval] {
        guard !audioPath.isEmpty else {
            throw SidecarError.invalidAudioPath("audioPath must not be empty")
        }

        let audioURL = URL(fileURLWithPath: audioPath).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: audioURL.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else {
            throw SidecarError.invalidAudioPath("audio file does not exist: \(audioURL.path)")
        }

        if !modelsPrepared {
            let environment = ProcessInfo.processInfo.environment
            let configuredDirectory = environment["FIELD_THEORY_DIARIZATION_MODELS_DIR"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let configuredDirectory, !configuredDirectory.isEmpty {
                try await manager.prepareModels(
                    directory: URL(fileURLWithPath: configuredDirectory).standardizedFileURL
                )
            } else {
                try await manager.prepareModels()
            }
            modelsPrepared = true
        }

        let result = try await manager.process(audioURL)
        return result.segments.map { segment in
            SpeakerInterval(
                speakerId: segment.speakerId,
                startTimeSeconds: Double(segment.startTimeSeconds),
                endTimeSeconds: Double(segment.endTimeSeconds),
                qualityScore: Double(segment.qualityScore)
            )
        }
    }
}

private enum SidecarError: LocalizedError {
    case invalidAudioPath(String)
    case invalidRequest(String)

    var errorDescription: String? {
        switch self {
        case .invalidAudioPath(let message), .invalidRequest(let message):
            return message
        }
    }
}

@main
private struct FieldTheoryDiarizer {
    static func main() async {
        guard #available(macOS 14.0, *) else {
            writeResponse(.failure("Offline diarization requires macOS 14 or later"))
            return
        }

        let service = DiarizationService()
        writeResponse(.readyResponse())

        while let line = readLine(strippingNewline: true) {
            guard !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                continue
            }

            let response = await handle(line: line, service: service)
            writeResponse(response)
        }
    }

    @available(macOS 14.0, *)
    private static func handle(
        line: String,
        service: DiarizationService
    ) async -> SidecarResponse {
        do {
            let request = try JSONDecoder().decode(
                DiarizationRequest.self,
                from: Data(line.utf8)
            )
            guard request.type == "diarize" else {
                throw SidecarError.invalidRequest("unsupported request type: \(request.type)")
            }
            guard let audioPath = request.audioPath else {
                throw SidecarError.invalidRequest("diarize request requires audioPath")
            }

            let segments = try await service.diarize(audioPath: audioPath)
            return .success(segments: segments)
        } catch {
            return .failure(error.localizedDescription)
        }
    }

    private static func writeResponse(_ response: SidecarResponse) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            var data = try encoder.encode(response)
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
        } catch {
            let fallback = "{\"error\":\"Failed to encode diarization response\",\"ok\":false,\"protocolVersion\":\(sidecarProtocolVersion)}\n"
            FileHandle.standardOutput.write(Data(fallback.utf8))
        }
    }
}
