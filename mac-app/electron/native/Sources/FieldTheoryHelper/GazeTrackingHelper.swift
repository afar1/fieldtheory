import Foundation
import AVFoundation
import Vision
import CoreMedia
import simd

struct GazeTrackingStatusMessage: Codable {
    let type = "gazeTrackingStatus"
    let running: Bool
    let cameraAuthorized: Bool
    let targetFps: Int
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case type
        case running
        case cameraAuthorized
        case targetFps
        case reason
    }
}

struct GazeNormalizedEyePosition: Codable {
    let x: Double
    let y: Double
}

struct GazeHeadPose: Codable {
    let yaw: Double
    let pitch: Double
    let roll: Double
}

struct GazeVector: Codable {
    let x: Double
    let y: Double
    let z: Double
}

struct GazeFaceBounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct GazeLandmarkPoint: Codable {
    let x: Double
    let y: Double
}

struct GazeEyeGeometry: Codable {
    let medialCanthus: GazeLandmarkPoint
    let lateralCanthus: GazeLandmarkPoint
    let irisCenter: GazeLandmarkPoint
}

struct GazeLandmarks: Codable {
    let leftEye: GazeEyeGeometry
    let rightEye: GazeEyeGeometry
}

struct GazeSampleMessage: Codable {
    let type = "gazeSample"
    let timestampMs: Int64
    let confidence: Double
    let leftEye: GazeNormalizedEyePosition
    let rightEye: GazeNormalizedEyePosition
    let combinedEye: GazeNormalizedEyePosition
    let headPose: GazeHeadPose
    let gazeVector: GazeVector
    let faceBounds: GazeFaceBounds
    let faceSize: Double
    let distanceScale: Double
    let landmarks: GazeLandmarks

    enum CodingKeys: String, CodingKey {
        case type
        case timestampMs
        case confidence
        case leftEye
        case rightEye
        case combinedEye
        case headPose
        case gazeVector
        case faceBounds
        case faceSize
        case distanceScale
        case landmarks
    }
}

private struct EyeNormalizationResult {
    let normalizedX: Double
    let normalizedY: Double
    let quality: Double
    let medialCorner: CGPoint
    let lateralCorner: CGPoint
    let irisCenter: CGPoint
    let centerSource: EyeCenterSource
}

private enum EyeCenterSource {
    case pupilLandmark
    case lumaFallback
    case geometricFallback
}

/**
 * Capture + Vision + normalization pipeline for gaze estimation.
 * Frames are processed in memory only and never written to disk.
 */
final class GazeTrackingHelper: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = GazeTrackingHelper()

    private let captureQueue = DispatchQueue(label: "fieldtheory.gaze.capture", qos: .userInitiated)
    private let visionQueue = DispatchQueue(label: "fieldtheory.gaze.vision", qos: .userInitiated)
    private let stateLock = NSLock()

    private var captureSession: AVCaptureSession?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var sequenceRequestHandler = VNSequenceRequestHandler()

    private var running: Bool = false
    private var cameraAuthorized: Bool = false
    private var targetFps: Int = 15
    private var reason: String? = "Disabled"
    private var lastOutputTimestampMs: Int64 = 0
    private var referenceFaceSize: Double?
    private var fallbackFrameCount = 0
    private var processedFrameCount = 0
    private var lastFallbackLogTimestampMs: Int64 = 0

    private override init() {
        super.init()
    }

    func start(targetFps requestedFps: Int, completion: @escaping (GazeTrackingStatusMessage) -> Void) {
        let clampedFps = max(1, min(30, requestedFps))
        let status = AVCaptureDevice.authorizationStatus(for: .video)

        switch status {
        case .authorized:
            self.withStateLock {
                self.cameraAuthorized = true
                self.reason = nil
            }
            self.startCaptureSession(targetFps: clampedFps, completion: completion)

        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self = self else { return }
                if granted {
                    self.withStateLock {
                        self.cameraAuthorized = true
                        self.reason = nil
                    }
                    self.startCaptureSession(targetFps: clampedFps, completion: completion)
                } else {
                    self.withStateLock {
                        self.running = false
                        self.cameraAuthorized = false
                        self.reason = "Camera permission denied"
                    }
                    DispatchQueue.main.async {
                        completion(self.status())
                    }
                }
            }

        case .denied, .restricted:
            self.withStateLock {
                self.running = false
                self.cameraAuthorized = false
                self.reason = "Camera permission denied"
            }
            completion(self.status())

        @unknown default:
            self.withStateLock {
                self.running = false
                self.cameraAuthorized = false
                self.reason = "Camera permission unavailable"
            }
            completion(self.status())
        }
    }

    func stop() -> GazeTrackingStatusMessage {
        captureQueue.sync {
            stopCaptureSessionOnCaptureQueue()
        }

        return status()
    }

    func status() -> GazeTrackingStatusMessage {
        return withStateLock {
            GazeTrackingStatusMessage(
                running: running,
                cameraAuthorized: cameraAuthorized,
                targetFps: targetFps,
                reason: reason
            )
        }
    }

    private func startCaptureSession(targetFps: Int, completion: @escaping (GazeTrackingStatusMessage) -> Void) {
        captureQueue.async { [weak self] in
            guard let self = self else { return }

            // Ensure previous session state is fully torn down before rebuilding.
            self.stopCaptureSessionOnCaptureQueue()

            let session = AVCaptureSession()
            session.beginConfiguration()
            if session.canSetSessionPreset(.vga640x480) {
                session.sessionPreset = .vga640x480
            }

            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
                ?? AVCaptureDevice.default(for: .video) else {
                self.withStateLock {
                    self.running = false
                    self.reason = "No camera device available"
                }
                session.commitConfiguration()
                DispatchQueue.main.async {
                    completion(self.status())
                }
                return
            }

            do {
                let input = try AVCaptureDeviceInput(device: camera)
                guard session.canAddInput(input) else {
                    self.withStateLock {
                        self.running = false
                        self.reason = "Unable to add camera input"
                    }
                    session.commitConfiguration()
                    DispatchQueue.main.async {
                        completion(self.status())
                    }
                    return
                }
                session.addInput(input)
            } catch {
                self.withStateLock {
                    self.running = false
                    self.reason = "Failed to create camera input: \(error.localizedDescription)"
                }
                session.commitConfiguration()
                DispatchQueue.main.async {
                    completion(self.status())
                }
                return
            }

            do {
                try camera.lockForConfiguration()
                let supported = camera.activeFormat.videoSupportedFrameRateRanges.contains {
                    $0.minFrameRate <= Double(targetFps) && Double(targetFps) <= $0.maxFrameRate
                }
                if supported {
                    let frameDuration = CMTime(value: 1, timescale: CMTimeScale(targetFps))
                    camera.activeVideoMinFrameDuration = frameDuration
                    camera.activeVideoMaxFrameDuration = frameDuration
                }
                camera.unlockForConfiguration()
            } catch {
                sendLog(level: "warn", message: "Gaze camera FPS configuration failed: \(error.localizedDescription)")
            }

            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            output.setSampleBufferDelegate(self, queue: self.visionQueue)

            guard session.canAddOutput(output) else {
                self.withStateLock {
                    self.running = false
                    self.reason = "Unable to add video output"
                }
                session.commitConfiguration()
                DispatchQueue.main.async {
                    completion(self.status())
                }
                return
            }
            session.addOutput(output)

            if let connection = output.connection(with: .video), connection.isVideoMirroringSupported {
                connection.isVideoMirrored = true
            }

            session.commitConfiguration()
            session.startRunning()

            self.captureSession = session
            self.videoOutput = output

            self.withStateLock {
                self.running = true
                self.targetFps = targetFps
                self.reason = nil
                self.lastOutputTimestampMs = 0
                self.referenceFaceSize = nil
            }

            DispatchQueue.main.async {
                completion(self.status())
            }
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let active = withStateLock { running }
        if !active { return }

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        let timestampMs = presentationTimestampMs(from: sampleBuffer)
        let shouldProcess = withStateLock { () -> Bool in
            let intervalMs = Int64(max(1, 1000 / max(1, targetFps)))
            if lastOutputTimestampMs > 0 && (timestampMs - lastOutputTimestampMs) < intervalMs {
                return false
            }
            lastOutputTimestampMs = timestampMs
            return true
        }

        if !shouldProcess {
            return
        }

        let request = VNDetectFaceLandmarksRequest()
        request.usesCPUOnly = false
        request.preferBackgroundProcessing = true
        if let latestRevision = VNDetectFaceLandmarksRequest.supportedRevisions.max() {
            request.revision = latestRevision
        }

        do {
            try sequenceRequestHandler.perform([request], on: pixelBuffer, orientation: .upMirrored)
        } catch {
            sendLog(level: "warn", message: "Gaze Vision request failed: \(error.localizedDescription)")
            return
        }

        guard let faces = request.results,
              let observation = faces.max(by: { $0.confidence < $1.confidence }),
              let sample = normalizedSample(from: observation, pixelBuffer: pixelBuffer, timestampMs: timestampMs) else {
            return
        }

        // Serialize JSON output on main queue to avoid stdout line interleaving.
        DispatchQueue.main.async {
            sendJSON(sample)
        }
    }

    private func normalizedSample(
        from observation: VNFaceObservation,
        pixelBuffer: CVPixelBuffer,
        timestampMs: Int64
    ) -> GazeSampleMessage? {
        guard let landmarks = observation.landmarks,
              let leftEye = extractEyeNormalization(
                eyeRegion: landmarks.leftEye,
                pupilRegion: landmarks.leftPupil,
                pixelBuffer: pixelBuffer,
                faceBounds: observation.boundingBox,
                faceCenterX: observation.boundingBox.midX
              ),
              let rightEye = extractEyeNormalization(
                eyeRegion: landmarks.rightEye,
                pupilRegion: landmarks.rightPupil,
                pixelBuffer: pixelBuffer,
                faceBounds: observation.boundingBox,
                faceCenterX: observation.boundingBox.midX
              ) else {
            return nil
        }

        trackFallbackUsage(leftEye: leftEye, rightEye: rightEye, timestampMs: timestampMs)

        let combinedX = (leftEye.normalizedX + rightEye.normalizedX) * 0.5
        let combinedY = (leftEye.normalizedY + rightEye.normalizedY) * 0.5

        // Convert [0,1] normalized eye offsets to centered vector components.
        let centeredX = (combinedX - 0.5) * 2.0
        let centeredY = (0.5 - combinedY) * 2.0
        let baseVector = simd_normalize(simd_double3(centeredX, centeredY, 1.0))

        let yaw = observation.yaw?.doubleValue ?? 0.0
        let pitch: Double
        if #available(macOS 12.0, *) {
            pitch = observation.pitch?.doubleValue ?? 0.0
        } else {
            pitch = 0.0
        }
        let roll = observation.roll?.doubleValue ?? 0.0
        let poseRotation = rotationMatrix(yaw: yaw, pitch: pitch, roll: roll)
        let compensated = simd_normalize(simd_inverse(poseRotation) * baseVector)

        let faceBounds = observation.boundingBox
        let faceArea = max(0.000_001, Double(faceBounds.width * faceBounds.height))
        let faceSize = sqrt(faceArea)
        let referenceFaceSize = withStateLock { () -> Double in
            if self.referenceFaceSize == nil {
                self.referenceFaceSize = faceSize
            }
            return self.referenceFaceSize ?? faceSize
        }
        let distanceScale = max(0.25, min(4.0, referenceFaceSize / max(faceSize, 0.000_001)))

        let faceConfidence = Double(observation.confidence)
        let eyeQuality = (leftEye.quality + rightEye.quality) * 0.5
        let confidence = clamp(faceConfidence * eyeQuality, min: 0.0, max: 1.0)

        return GazeSampleMessage(
            timestampMs: timestampMs,
            confidence: confidence,
            leftEye: GazeNormalizedEyePosition(
                x: leftEye.normalizedX,
                y: leftEye.normalizedY
            ),
            rightEye: GazeNormalizedEyePosition(
                x: rightEye.normalizedX,
                y: rightEye.normalizedY
            ),
            combinedEye: GazeNormalizedEyePosition(
                x: combinedX,
                y: combinedY
            ),
            headPose: GazeHeadPose(yaw: yaw, pitch: pitch, roll: roll),
            gazeVector: GazeVector(x: compensated.x, y: compensated.y, z: compensated.z),
            faceBounds: GazeFaceBounds(
                x: Double(faceBounds.origin.x),
                y: Double(faceBounds.origin.y),
                width: Double(faceBounds.size.width),
                height: Double(faceBounds.size.height)
            ),
            faceSize: faceSize,
            distanceScale: distanceScale,
            landmarks: GazeLandmarks(
                leftEye: GazeEyeGeometry(
                    medialCanthus: makeLandmarkPoint(leftEye.medialCorner),
                    lateralCanthus: makeLandmarkPoint(leftEye.lateralCorner),
                    irisCenter: makeLandmarkPoint(leftEye.irisCenter)
                ),
                rightEye: GazeEyeGeometry(
                    medialCanthus: makeLandmarkPoint(rightEye.medialCorner),
                    lateralCanthus: makeLandmarkPoint(rightEye.lateralCorner),
                    irisCenter: makeLandmarkPoint(rightEye.irisCenter)
                )
            )
        )
    }

    private func extractEyeNormalization(
        eyeRegion: VNFaceLandmarkRegion2D?,
        pupilRegion: VNFaceLandmarkRegion2D?,
        pixelBuffer: CVPixelBuffer,
        faceBounds: CGRect,
        faceCenterX: CGFloat
    ) -> EyeNormalizationResult? {
        guard let eyeRegion = eyeRegion else { return nil }

        let eyePoints = pointsInImageNormalized(for: eyeRegion, faceBounds: faceBounds)
        guard eyePoints.count >= 2 else { return nil }

        let pupilPoints = pupilRegion.map { pointsInImageNormalized(for: $0, faceBounds: faceBounds) } ?? []

        guard let minPoint = eyePoints.min(by: { $0.x < $1.x }),
              let maxPoint = eyePoints.max(by: { $0.x < $1.x }) else {
            return nil
        }

        let eyeCenterX = eyePoints.reduce(0.0) { $0 + $1.x } / CGFloat(eyePoints.count)
        let medialCorner: CGPoint
        let lateralCorner: CGPoint
        if eyeCenterX < faceCenterX {
            medialCorner = maxPoint
            lateralCorner = minPoint
        } else {
            medialCorner = minPoint
            lateralCorner = maxPoint
        }

        let irisCenter: CGPoint
        let centerSource: EyeCenterSource
        if !pupilPoints.isEmpty {
            irisCenter = averagePoint(pupilPoints)
            centerSource = .pupilLandmark
        } else if let estimated = estimateIrisCenterFromLuma(
            pixelBuffer: pixelBuffer,
            eyePointsNormalized: eyePoints
        ) {
            irisCenter = estimated
            centerSource = .lumaFallback
        } else {
            irisCenter = averagePoint(eyePoints)
            centerSource = .geometricFallback
        }

        let minY = eyePoints.map(\.y).min() ?? irisCenter.y
        let maxY = eyePoints.map(\.y).max() ?? irisCenter.y

        let horizontalSpan = medialCorner.x - lateralCorner.x
        let verticalSpan = maxY - minY
        if abs(horizontalSpan) < 0.000_001 || verticalSpan < 0.000_001 {
            return nil
        }

        let normalizedX = clamp(
            Double((irisCenter.x - medialCorner.x) / (lateralCorner.x - medialCorner.x)),
            min: 0.0,
            max: 1.0
        )
        let normalizedY = clamp(
            Double((irisCenter.y - minY) / verticalSpan),
            min: 0.0,
            max: 1.0
        )

        let spanQuality = clamp(Double(abs(horizontalSpan) / 0.03), min: 0.0, max: 1.0)
        let opennessQuality = clamp(Double(verticalSpan / 0.012), min: 0.0, max: 1.0)
        let centerQuality: Double
        switch centerSource {
        case .pupilLandmark:
            centerQuality = 1.0
        case .lumaFallback:
            centerQuality = 0.82
        case .geometricFallback:
            centerQuality = 0.45
        }
        let quality = clamp(
            (opennessQuality * 0.45) + (spanQuality * 0.35) + (centerQuality * 0.20),
            min: 0.0,
            max: 1.0
        )

        return EyeNormalizationResult(
            normalizedX: normalizedX,
            normalizedY: normalizedY,
            quality: quality,
            medialCorner: medialCorner,
            lateralCorner: lateralCorner,
            irisCenter: irisCenter,
            centerSource: centerSource
        )
    }

    private func estimateIrisCenterFromLuma(
        pixelBuffer: CVPixelBuffer,
        eyePointsNormalized: [CGPoint]
    ) -> CGPoint? {
        guard eyePointsNormalized.count >= 3 else { return nil }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        if width <= 2 || height <= 2 {
            return nil
        }

        let polygon = eyePointsNormalized.map { point in
            CGPoint(
                x: clamp(Double(point.x), min: 0.0, max: 1.0) * Double(width - 1),
                y: (1.0 - clamp(Double(point.y), min: 0.0, max: 1.0)) * Double(height - 1)
            )
        }

        let minXPx = max(0, Int(floor(Double(polygon.map(\.x).min() ?? 0))))
        let maxXPx = min(width - 1, Int(ceil(Double(polygon.map(\.x).max() ?? CGFloat(width - 1)))))
        let minYPx = max(0, Int(floor(Double(polygon.map(\.y).min() ?? 0))))
        let maxYPx = min(height - 1, Int(ceil(Double(polygon.map(\.y).max() ?? CGFloat(height - 1)))))

        if minXPx >= maxXPx || minYPx >= maxYPx {
            return nil
        }

        let centerX = polygon.reduce(0.0) { $0 + $1.x } / Double(polygon.count)
        let centerY = polygon.reduce(0.0) { $0 + $1.y } / Double(polygon.count)
        let sigma = max(4.0, Double(max(maxXPx - minXPx, maxYPx - minYPx)) * 0.45)
        let sigmaDenominator = 2.0 * sigma * sigma

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
              let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            return nil
        }

        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)

        struct Candidate {
            let x: Double
            let y: Double
            let luma: Double
            let spatialWeight: Double
        }

        var candidates: [Candidate] = []
        candidates.reserveCapacity(512)

        let step = 2
        for y in stride(from: minYPx, through: maxYPx, by: step) {
            for x in stride(from: minXPx, through: maxXPx, by: step) {
                let point = CGPoint(x: Double(x), y: Double(y))
                if !pointInPolygon(point, polygon: polygon) {
                    continue
                }

                let pixel = baseAddress
                    .advanced(by: y * bytesPerRow + x * 4)
                    .assumingMemoryBound(to: UInt8.self)

                let b = Double(pixel[0])
                let g = Double(pixel[1])
                let r = Double(pixel[2])
                let luma = (0.114 * b) + (0.587 * g) + (0.299 * r)

                let dx = Double(x) - centerX
                let dy = Double(y) - centerY
                let spatialWeight = Foundation.exp(-(((dx * dx) + (dy * dy)) / sigmaDenominator))

                candidates.append(
                    Candidate(
                        x: Double(x),
                        y: Double(y),
                        luma: luma,
                        spatialWeight: spatialWeight
                    )
                )
            }
        }

        if candidates.count < 20 {
            return nil
        }

        let sortedLuma = candidates.map(\.luma).sorted()
        let thresholdIndex = min(sortedLuma.count - 1, max(0, Int(Double(sortedLuma.count) * 0.35)))
        let threshold = sortedLuma[thresholdIndex]

        var weightedX = 0.0
        var weightedY = 0.0
        var totalWeight = 0.0

        for candidate in candidates where candidate.luma <= threshold {
            let darknessWeight = max(0.5, (threshold - candidate.luma) + 1.0)
            let weight = darknessWeight * max(0.1, candidate.spatialWeight)
            weightedX += candidate.x * weight
            weightedY += candidate.y * weight
            totalWeight += weight
        }

        if totalWeight <= 0.000_001 {
            return nil
        }

        let irisX = weightedX / totalWeight
        let irisY = weightedY / totalWeight

        return CGPoint(
            x: clamp(irisX / Double(max(1, width - 1)), min: 0.0, max: 1.0),
            y: clamp(1.0 - (irisY / Double(max(1, height - 1))), min: 0.0, max: 1.0)
        )
    }

    private func pointInPolygon(_ point: CGPoint, polygon: [CGPoint]) -> Bool {
        if polygon.count < 3 {
            return false
        }

        var inside = false
        var j = polygon.count - 1

        for i in 0..<polygon.count {
            let pi = polygon[i]
            let pj = polygon[j]

            let intersects = ((pi.y > point.y) != (pj.y > point.y)) &&
                (point.x < ((pj.x - pi.x) * (point.y - pi.y) / max(0.000_001, (pj.y - pi.y)) + pi.x))

            if intersects {
                inside.toggle()
            }

            j = i
        }

        return inside
    }

    private func trackFallbackUsage(
        leftEye: EyeNormalizationResult,
        rightEye: EyeNormalizationResult,
        timestampMs: Int64
    ) {
        processedFrameCount += 1
        if leftEye.centerSource != .pupilLandmark || rightEye.centerSource != .pupilLandmark {
            fallbackFrameCount += 1
        }

        if lastFallbackLogTimestampMs == 0 {
            lastFallbackLogTimestampMs = timestampMs
            return
        }

        if (timestampMs - lastFallbackLogTimestampMs) < 5000 {
            return
        }

        let fallbackRatio = processedFrameCount > 0
            ? Double(fallbackFrameCount) / Double(processedFrameCount)
            : 0.0
        let ratioPercent = Int((fallbackRatio * 100.0).rounded())

        if fallbackRatio > 0.5 {
            sendLog(
                level: "warn",
                message: "Gaze pupil landmarks missing on \(ratioPercent)% of frames; using fallback iris estimation"
            )
        } else {
            sendLog(
                level: "debug",
                message: "Gaze pupil fallback ratio \(ratioPercent)% over last \(processedFrameCount) frames"
            )
        }

        processedFrameCount = 0
        fallbackFrameCount = 0
        lastFallbackLogTimestampMs = timestampMs
    }

    private func pointsInImageNormalized(for region: VNFaceLandmarkRegion2D, faceBounds: CGRect) -> [CGPoint] {
        var points: [CGPoint] = []
        points.reserveCapacity(region.pointCount)

        let normalizedPoints = region.normalizedPoints
        for index in 0..<region.pointCount {
            let point = normalizedPoints[index]
            let x = faceBounds.origin.x + CGFloat(point.x) * faceBounds.size.width
            let y = faceBounds.origin.y + CGFloat(point.y) * faceBounds.size.height
            points.append(CGPoint(x: x, y: y))
        }

        return points
    }

    private func averagePoint(_ points: [CGPoint]) -> CGPoint {
        guard !points.isEmpty else { return CGPoint(x: 0, y: 0) }
        let sum = points.reduce(CGPoint(x: 0, y: 0)) { partial, point in
            CGPoint(x: partial.x + point.x, y: partial.y + point.y)
        }
        return CGPoint(
            x: sum.x / CGFloat(points.count),
            y: sum.y / CGFloat(points.count)
        )
    }

    private func rotationMatrix(yaw: Double, pitch: Double, roll: Double) -> simd_double3x3 {
        let cx = cos(pitch)
        let sx = sin(pitch)
        let cy = cos(yaw)
        let sy = sin(yaw)
        let cz = cos(roll)
        let sz = sin(roll)

        let rx = simd_double3x3(
            simd_double3(1, 0, 0),
            simd_double3(0, cx, -sx),
            simd_double3(0, sx, cx)
        )
        let ry = simd_double3x3(
            simd_double3(cy, 0, sy),
            simd_double3(0, 1, 0),
            simd_double3(-sy, 0, cy)
        )
        let rz = simd_double3x3(
            simd_double3(cz, -sz, 0),
            simd_double3(sz, cz, 0),
            simd_double3(0, 0, 1)
        )

        return rz * ry * rx
    }

    private func presentationTimestampMs(from sampleBuffer: CMSampleBuffer) -> Int64 {
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if presentationTime.isValid && presentationTime.seconds.isFinite {
            return Int64((presentationTime.seconds * 1000.0).rounded())
        }
        return Int64((Date().timeIntervalSince1970 * 1000.0).rounded())
    }

    private func makeLandmarkPoint(_ point: CGPoint) -> GazeLandmarkPoint {
        return GazeLandmarkPoint(
            x: Double(clamp(Double(point.x), min: 0.0, max: 1.0)),
            y: Double(clamp(Double(point.y), min: 0.0, max: 1.0))
        )
    }

    private func clamp(_ value: Double, min minimum: Double, max maximum: Double) -> Double {
        return Swift.max(minimum, Swift.min(maximum, value))
    }

    private func withStateLock<T>(_ block: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return block()
    }

    private func stopCaptureSessionOnCaptureQueue() {
        if let session = captureSession, session.isRunning {
            session.stopRunning()
        }

        if let output = videoOutput {
            output.setSampleBufferDelegate(nil, queue: nil)
        }

        if let session = captureSession {
            session.beginConfiguration()
            for input in session.inputs {
                session.removeInput(input)
            }
            for output in session.outputs {
                session.removeOutput(output)
            }
            session.commitConfiguration()
        }

        withStateLock {
            running = false
            reason = "Disabled"
            lastOutputTimestampMs = 0
            referenceFaceSize = nil
        }

        captureSession = nil
        videoOutput = nil
        sequenceRequestHandler = VNSequenceRequestHandler()
    }
}
