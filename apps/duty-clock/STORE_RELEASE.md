# Store release pack

## Distribution strategy

- iPhone instructors install prerelease builds through TestFlight and the approved release through the App Store.
- Android instructors install prerelease builds through Google Play internal testing and the approved release through Google Play.
- Do not distribute raw APK files or iOS ad-hoc builds to instructors. Store-managed installs avoid unknown-source and untrusted-developer warnings and provide signed updates.

## Listing details

- App name: `BFC Duty Clock`
- Subtitle / short description: `Simple duty and break tracking for Bendigo Flying Club instructors.`
- Category: Business
- Support URL: `https://portal.bendigoflyingclub.com.au/duty-clock/support/`
- Privacy URL: `https://portal.bendigoflyingclub.com.au/duty-clock/privacy/`
- Account deletion URL: `https://portal.bendigoflyingclub.com.au/duty-clock/account-deletion/`
- Contact: `bfc@bendigoflyingclub.com.au`, `(03) 5443 8395`
- iOS bundle ID: `au.com.bendigoflyingclub.dutyclock`
- Android package: `au.com.bendigoflyingclub.dutyclock`

## Store description

BFC Duty Clock gives authorised Bendigo Flying Club instructors a fast way to record duty periods. Start duty with a prefilled time and a one-time location check, complete the pre-duty declaration, record breaks, and clock off with flying hours prefilled from the club's flight logs. The app uses the same secure account and duty records as the Bendigo Flying Club portal.

## Apple privacy answers

Declare these data types as linked to the user and used for app functionality:

- Contact info: email address.
- Identifiers: user ID.
- Precise location: collected at duty start only.
- Other user content: duty notes and fatigue declaration responses.

The app does not track users across apps or websites, does not show advertising, and does not collect background location. Confirm the final answers against the production build and every included SDK in App Store Connect.

## Google Play Data Safety draft

- Data collected: precise location, email address, user ID, and other user-generated content/duty records.
- Purpose: app functionality and account management.
- Processing: encrypted in transit; user deletion requests are available through the public deletion URL.
- Sharing: no sale or advertising sharing. Supabase processes data as a service provider.
- Location is optional at the operating-system level because a user can continue with a manual location and explanatory note.

The Play account owner remains responsible for checking these answers against the final app and completing the Data Safety form.

## Review access

Both stores must be given a dedicated reviewer account with the instructor role and safe sample data. Do not provide a real instructor's credentials. Include review notes explaining that location is requested only after tapping Start duty and that reviewers can decline permission and enter a manual location plus note.

## Release sequence

1. Enrol the club organisation in Apple Developer and Google Play Console using a club-controlled email address.
2. Sign in to the club's Expo account with `npx eas-cli login`, then run `npx eas-cli build:configure` to attach the EAS project ID.
3. Create the app records in App Store Connect and Play Console using the identifiers above.
4. Add store screenshots from a real iPhone and Android test run, listing text, privacy URLs, declarations and reviewer credentials.
5. Run `npx eas-cli build --platform all --profile production`.
6. Upload the Android App Bundle to Play internal testing and submit the iOS build to TestFlight.
7. Test login, permission denial, on-site/off-site duty start, breaks, clock-off and app updates on physical devices.
8. Promote the tested builds to production review. Share only the App Store and Google Play links with instructors.
