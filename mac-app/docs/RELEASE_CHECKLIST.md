# Release Checklist - v0.1.25+maxwell

## Core Features to Verify

- [ ] **Popular Commands** - Review and ensure it's solid
- [ ] **Priority mic minute counting** - Verify counting logic is accurate
- [ ] **Draw page audit** - Ensure it operates as expected
- [ ] **Shared Fields** - Test that sharing works correctly between accounts

## UI/UX Fixes

- [ ] **Version display** - Bottom right shows "2.4" but should show "0.1.25+maxwell"
- [ ] **Header spacing** - Review spacing between "Sign in" button and Opal mic dropdown
- [ ] **Menu bar icon** - Update the icon image and confirm the text
- [ ] **Onboarding/tutorial page** - Review and update as needed

## Quota & Usage Display

- [ ] **Image drawings usage** - Add drawing count to footer usage display (X of 20 drawings)
- [ ] **Monthly reset** - Confirm quota reset happens correctly on first of month
- [ ] **Search limitation** - Ensure search only returns results from first visible page for free users

## Pro Account

- [ ] **Pro benefits outline** - Document what Pro includes for upgrade prompt
- [ ] **Upgrade flow test** - Test via production build

## Build & Distribution

- [ ] **Production build** - Create packaged build pushed to GitHub
- [ ] **Auto-update test** - Verify update functionality works
- [ ] **Fresh Mac test** - Run on new Mac to experience as new user

## Website

- [ ] **Update web page** - Refresh marketing site with current features

## Future Features (Lower Priority)

- [ ] **Invite codes** - Referral system:
  - Inviter gets +250 priority mic minutes and +25 auto-stacks per signup
  - If referral becomes paying user, inviter gets 1 month Pro free
- [ ] **Recommended mics** - Curate list of recommended microphones
