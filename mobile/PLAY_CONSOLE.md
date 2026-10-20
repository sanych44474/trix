# Google Play Console answers for Hack Limits

Answers for the Play Console forms, checked against the code on 2026-10-20. When what the app
collects changes, update this file and the forms together, and `public/privacy.html` with them.

Links to put in the console (replace `<worker>` with the production Worker origin):

- Privacy policy: `https://<worker>/privacy.html`
- Account deletion: `https://<worker>/account-deletion.html`

## Data safety

Is all user data encrypted in transit? **Yes** (HTTPS only; the app sets `usesCleartextTraffic=false`).
Do you provide a way for users to request that their data is deleted? **Yes** (in app: More → Delete
account; on the web: the account deletion page; in Telegram: `/deleteme`).

Data collected (nothing is shared with third parties for their own purposes; processors acting for
us do not count as "sharing" in Play's definition). No data is used for advertising.

<table>
  <tr><th>Category / type</th><th>Collected</th><th>Purpose</th><th>Optional?</th></tr>
  <tr><td>Personal info — Name</td><td>Yes</td><td>App functionality, Account management</td><td>Required (Telegram name or Google profile)</td></tr>
  <tr><td>Personal info — Email address</td><td>Yes</td><td>Account management</td><td>Optional (email or Google sign-in)</td></tr>
  <tr><td>Personal info — User IDs</td><td>Yes</td><td>Account management</td><td>Required</td></tr>
  <tr><td>Health and fitness — Health info</td><td>Yes (injuries, limitations, body weight and measurements, check-ins)</td><td>App functionality, Personalization</td><td>Optional</td></tr>
  <tr><td>Health and fitness — Fitness info</td><td>Yes (workouts, steps from Health Connect, Strava activities if connected)</td><td>App functionality, Personalization</td><td>Required for the core feature</td></tr>
  <tr><td>Photos and videos — Photos</td><td>Yes (progress photos, meal photos for estimates)</td><td>App functionality</td><td>Optional</td></tr>
  <tr><td>Messages — Other in-app messages</td><td>Yes (AI coach questions, messages with a trainer)</td><td>App functionality</td><td>Optional</td></tr>
  <tr><td>App activity — App interactions</td><td>Yes (feature usage counters)</td><td>Analytics</td><td>Required</td></tr>
  <tr><td>App info and performance — Crash logs / Diagnostics</td><td>Yes (server-side error records)</td><td>App functionality</td><td>Required</td></tr>
  <tr><td>Device or other IDs</td><td>Yes (Firebase Installation ID for push)</td><td>App functionality</td><td>Optional (only with notifications)</td></tr>
  <tr><td>Location, Financial info, Contacts, Calendar, Audio, Files, Web browsing</td><td>No</td><td>—</td><td>—</td></tr>
</table>

Notes: voice input uses Android's on-device speech recognition, so no audio reaches us. Uploaded
photos are re-encoded on the phone, which strips location data.

## Health apps declaration

- Does the app have health features? **Yes.**
- Categories: **Activity and fitness**; **Nutrition and weight management**.
- Health Connect: the app reads **Steps** (`android.permission.health.READ_STEPS`) to log today's
  steps. Justification: "Shows and syncs the user's daily step count to their training dashboard."
  It writes nothing to Health Connect.
- Not a medical device; does not diagnose or treat.

## App content, other forms

- Ads: **No ads.**
- Target audience: 18+ (fitness coaching). The app is not designed for children.
- Government app / financial features / news: **No.**
- App access for review: provide a test account (email sign-in) with a plan, and the steps to sign
  in with a one-time code — the reviewer needs a mailbox you control, or a Telegram test account.

## Before the production release

- Closed test: at least 12 testers opted in for 14 consecutive days (personal developer accounts).
- Upload key: keep it outside the repo; enroll in Play App Signing; add both SHA-1 fingerprints to
  the Firebase Android app (it already has the debug key) so Google sign-in works for Play builds.
