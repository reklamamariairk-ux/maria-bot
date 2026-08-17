# App Store submission — Котик Комбат

## App record

- Bundle ID: `ru.mariairk.kotik`
- Name: `Котик Комбат`
- Primary category: Games / Casual
- Privacy Policy URL: `https://bot.145-223-121-47.sslip.io/privacy`
- Support URL: `https://bot.145-223-121-47.sslip.io/support`
- Price: Free
- In-App Purchases: No
- Tracking: No

## App Privacy answers

Declare these data types as linked to the user and not used for tracking:

- Contact Info → Name — App Functionality
- Identifiers → User ID — App Functionality
- User Content → Gameplay Content — App Functionality
- Usage Data → Product Interaction — App Functionality and Analytics
- Purchases → Purchase History — App Functionality (only after the user links the Maria loyalty account)

Guest progress remains only on the device and is not collected. Do not declare advertising, precise location, contacts, health, financial information, device ID, or tracking unless the implementation changes.

## Review Notes

`Котик Комбат` is a free casual game. It can be played without an account in guest mode. Optional authentication saves progress and enables leaderboards and social game features. Virtual coins cannot be purchased for money and have no cash value. Random chests/cases use only free virtual currency earned through gameplay. The app contains an in-app Privacy link and a Delete Profile control. Deleting a profile removes server-side game progress and analytics but does not delete the user's separate Telegram/VK/MAX or Maria loyalty account.

Provide App Review with either a test login that does not require access to a personal messenger account, or confirm that every core gameplay screen is available in guest mode.

## Final Mac checklist

The repository contains `.github/workflows/ios-testflight.yml`, so the archive can be built on GitHub's macOS runner without owning a Mac. Configure these repository secrets before running it:

- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64` for `ru.mariairk.kotik`
- `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64` when TestFlight upload is enabled

Run **Actions → iOS — Kotik Combat → Run workflow**. Leave TestFlight upload disabled for the first signing check; enable it after the signed IPA is produced successfully.

1. `npm ci && npx cap sync ios`
2. Open `ios/App/App.xcworkspace` in the current Xcode.
3. Select the Apple Developer team and enable Automatically manage signing.
4. Confirm version/build numbers and iOS deployment target.
5. Generate an Xcode Privacy Report and reconcile it with `PrivacyInfo.xcprivacy` and App Privacy answers.
6. Test guest play, authenticated play, Privacy and Delete Profile on a physical iPhone and iPad layout.
7. Archive, Validate App, upload to App Store Connect, then test through TestFlight.
