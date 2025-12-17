# Supabase Email Templates

This document provides guidance for customizing the email templates used by Field Theory's authentication system.

## Accessing Email Templates

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Email Templates**

## Email Types

### 1. Confirmation Email (Email Verification)

**Subject:** `Verify your Field Theory account`

**Purpose:** Sent when a user signs up to verify their email address.

**Recommended content:**
- Field Theory logo header
- Clear "Verify Email" button/link
- Brief explanation: "Click below to verify your email and start using Field Theory."
- Note: Link expires in 24 hours

**Template variables available:**
- `{{ .ConfirmationURL }}` - The verification link
- `{{ .Token }}` - The verification token (if using OTP)
- `{{ .Email }}` - User's email address

### 2. Password Reset Email

**Subject:** `Reset your Field Theory password`

**Purpose:** Sent when a user requests a password reset.

**Recommended content:**
- Field Theory logo header  
- Clear "Reset Password" button
- Brief explanation: "Click below to reset your password."
- Security note: "If you didn't request this, ignore this email."
- Note: Link expires in 1 hour

**Template variables available:**
- `{{ .ConfirmationURL }}` - The password reset link (redirects to our hosted reset page)
- `{{ .Email }}` - User's email address

### 3. Magic Link Email

**Subject:** `Sign in to Field Theory`

**Purpose:** Sent for passwordless authentication.

**Recommended content:**
- Field Theory logo header
- Clear "Sign In" button
- Brief explanation: "Click below to sign in. No password needed!"
- Note: Link expires in 1 hour and can only be used once

**Template variables available:**
- `{{ .ConfirmationURL }}` - The magic link
- `{{ .Email }}` - User's email address

## Styling Guidelines

### HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="
  margin: 0;
  padding: 0;
  background-color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="
          max-width: 480px;
          background-color: #1e293b;
          border-radius: 12px;
          border: 1px solid #334155;
        ">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 32px 32px 0 32px;">
              <span style="font-size: 40px;">🎙️</span>
              <h1 style="
                margin: 8px 0 0 0;
                font-size: 24px;
                color: #f8fafc;
              ">Field Theory</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 24px 32px;">
              <p style="
                margin: 0 0 24px 0;
                font-size: 16px;
                color: #e2e8f0;
                text-align: center;
              ">
                [Your message here]
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="{{ .ConfirmationURL }}" style="
                      display: inline-block;
                      padding: 14px 32px;
                      background-color: #3b82f6;
                      color: #ffffff;
                      text-decoration: none;
                      font-weight: 600;
                      font-size: 16px;
                      border-radius: 8px;
                    ">
                      [Button Text]
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="
              padding: 24px 32px;
              border-top: 1px solid #334155;
              text-align: center;
            ">
              <p style="
                margin: 0;
                font-size: 12px;
                color: #64748b;
              ">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

### Brand Colors

| Purpose | Color |
|---------|-------|
| Background (dark) | `#0f172a` |
| Card background | `#1e293b` |
| Border | `#334155` |
| Primary text | `#f8fafc` |
| Secondary text | `#e2e8f0` |
| Muted text | `#64748b` |
| Primary button | `#3b82f6` |
| Success | `#22c55e` |

## URL Configuration

In **Authentication** → **URL Configuration**, add:

**Redirect URLs:**
- `http://localhost:5173/reset-password.html` (development)
- `https://afar1.github.io/field-theory/reset-password.html` (production)

The password reset flow works as follows:
1. User clicks "Forgot password" in the app
2. They receive an email with a link to the hosted reset page
3. They set their new password on that page
4. They return to the app and sign in with the new password

## Testing

1. Create a test account with a real email address
2. Trigger each email type (sign up, password reset, magic link)
3. Check that:
   - Emails arrive promptly
   - Links work and redirect correctly  
   - Styling renders correctly in different email clients (Gmail, Apple Mail, Outlook)
   - Mobile rendering looks good

