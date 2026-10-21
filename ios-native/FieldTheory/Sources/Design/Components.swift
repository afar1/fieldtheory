import SwiftUI

/// Top toast for brief notices and ongoing Voice progress.
@MainActor
@Observable
final class ToastCenter {
    private var transientMessage: String?
    private var transientSymbol: String?
    private var statusMessage: String?
    private var statusSymbol: String?
    private var hideTask: Task<Void, Never>?

    var message: String? { transientMessage ?? statusMessage }
    var symbol: String? { transientMessage == nil ? statusSymbol : transientSymbol }

    func show(_ message: String, symbol: String? = nil, duration: Double = 1.8) {
        transientMessage = message
        transientSymbol = symbol
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.transientMessage = nil
        }
    }

    func setStatus(_ message: String?, symbol: String? = nil) {
        statusMessage = message
        statusSymbol = symbol
    }
}

struct ToastOverlay: View {
    let toast: ToastCenter

    var body: some View {
        // Toasts drop from the top — the bottom belongs to the tab bar,
        // record pill, and floating mic.
        VStack {
            if let message = toast.message {
                HStack(spacing: 7) {
                    if let symbol = toast.symbol {
                        Image(systemName: symbol)
                            .font(.system(size: 13, weight: .semibold))
                    }
                    Text(message)
                        .font(.system(size: 14, weight: .medium))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .transition(.move(edge: .top).combined(with: .opacity))
                .padding(.top, 6)
            }
            Spacer()
        }
        .animation(.spring(duration: 0.35), value: toast.message)
        .allowsHitTesting(false)
    }
}

struct UnreadDot: View {
    var body: some View {
        Circle()
            .fill(Theme.unread)
            .frame(width: 9, height: 9)
    }
}

/// Author callsign chip, top-left of river cards.
struct CallsignBadge: View {
    let callsign: String
    let accent: Color

    var body: some View {
        Text(callsign.uppercased())
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .tracking(0.8)
            .foregroundStyle(accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 3.5)
            .background(accent.opacity(0.12), in: Capsule())
    }
}

extension Date {
    var relativeShort: String {
        if abs(timeIntervalSinceNow) < 60 { return "now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}

extension Int64 {
    var msToDate: Date { Date(timeIntervalSince1970: Double(self) / 1000) }
}
