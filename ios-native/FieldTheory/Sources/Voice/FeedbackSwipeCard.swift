import SwiftUI

/// Cards live in a grid/scroll view, where List-only swipeActions do not work.
struct FeedbackSwipeCard<Content: View>: View {
    let status: Bool?
    let enabled: Bool
    let onFeedback: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var revealed = false

    private var label: String {
        if let status { return status ? "Feedback sent" : "Feedback queued" }
        return "Send feedback to support"
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            if revealed {
                Button(action: onFeedback) {
                    Label(label, systemImage: status == true ? "checkmark.bubble" : "bubble.left")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 140)
                        .frame(maxHeight: .infinity)
                        .padding(.horizontal, 12)
                        .foregroundStyle(.white)
                        .background(Color.blue)
                }
                .buttonStyle(.plain)
                .disabled(status != nil)
                .accessibilityLabel(label)
            }
            content()
                .offset(x: revealed ? -172 : 0)
        }
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .simultaneousGesture(DragGesture(minimumDistance: 25).onEnded { value in
            guard enabled, abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
            withAnimation(.easeOut(duration: 0.2)) { revealed = value.translation.width < -40 }
        })
        .onChange(of: enabled) { _, value in if !value { revealed = false } }
        .accessibilityAction(named: Text("Send feedback to support")) {
            if enabled && status == nil { onFeedback() }
        }
    }
}
