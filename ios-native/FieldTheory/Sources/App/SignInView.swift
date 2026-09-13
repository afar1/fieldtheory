import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    @State private var email = ""
    @State private var code = ""
    @State private var awaitingCode = false
    @State private var busy = false
    @State private var reviewerDemoBusy = false
    @FocusState private var focusedField: Field?

    private enum Field { case email, code }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: "asterisk")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
                .padding(.bottom, 18)

            Text("Field Theory")
                .font(.custom("Source Serif 4", size: 32).weight(.semibold))
                .foregroundStyle(Theme.text(colorScheme))

            Text("Made by Field Theory")
                .font(.custom("Source Sans 3", size: 13))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .padding(.top, 4)

            Text(awaitingCode ? "Enter the code we emailed you" : "Sign in or create an account")
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .padding(.top, 8)

            VStack(spacing: 14) {
                if awaitingCode {
                    TextField("123456", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .focused($focusedField, equals: .code)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 24, weight: .medium, design: .monospaced))
                        .padding(.vertical, 14)
                        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
                } else {
                    TextField("you@example.com", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .email)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 18))
                        .padding(.vertical, 14)
                        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
                }

                Button {
                    submit()
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(.white)
                        } else {
                            Text(awaitingCode ? "Verify" : "Send Code")
                                .font(.system(size: 17, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent(model.settings.accentPreset, colorScheme), in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
                }
                .disabled(busy || (awaitingCode ? code.count < 6 : !email.contains("@")))

                if awaitingCode {
                    Button("Use a different email") {
                        awaitingCode = false
                        code = ""
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textMuted(colorScheme))
                }

                if let error = model.auth.lastError {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.unread)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: 12) {
                    Divider()
                    Text("or")
                        .font(.footnote)
                        .foregroundStyle(Theme.textMuted(colorScheme))
                    Divider()
                }
                .padding(.vertical, 4)

                Button {
                    enterReviewerDemo()
                } label: {
                    Group {
                        if reviewerDemoBusy {
                            ProgressView()
                        } else {
                            Text("Open Reviewer Demo")
                                .font(.system(size: 17, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.bordered)
                .disabled(busy || reviewerDemoBusy)
                .accessibilityIdentifier("ReviewerDemoButton")

                Text("Uses isolated sample content stored only on this device. No account is created and production sync stays off.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted(colorScheme))
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 36)
            .padding(.horizontal, 32)
            .frame(maxWidth: 420)

            Spacer()

            Link("Privacy Policy", destination: AppLinks.privacyPolicy)
                .accessibilityIdentifier("PrivacyPolicyLink")
                .font(.footnote)
                .padding(.bottom, 8)

#if targetEnvironment(simulator)
            Button("Preview UI with sample data") {
                model.enterPreviewMode()
            }
            .font(.system(size: 14))
            .foregroundStyle(Theme.textMuted(colorScheme))
            .padding(.bottom, 8)
#endif
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background(colorScheme))
    }

    private func submit() {
        busy = true
        Task {
            defer { busy = false }
            if awaitingCode {
                _ = await model.auth.verifyCode(code.trimmingCharacters(in: .whitespaces))
            } else {
                let sent = await model.auth.sendCode(to: email.trimmingCharacters(in: .whitespaces).lowercased())
                if sent {
                    awaitingCode = true
                    focusedField = .code
                }
            }
        }
    }

    private func enterReviewerDemo() {
        reviewerDemoBusy = true
        model.auth.lastError = nil
        Task {
            defer { reviewerDemoBusy = false }
            do {
                try await model.enterReviewerDemo(seed: ReviewerDemoFixtures.seed)
                model.auth.beginReviewerDemo()
            } catch {
                model.auth.lastError = "Reviewer Demo could not open its local sample workspace. Please try again."
            }
        }
    }
}
