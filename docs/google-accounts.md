# Connect personal Gmail and Google Calendar

Connect the Google accounts you want Nakama to use for email and calendar. These connections remain independent of ChatGPT, Claude and Kling; adding a Google account does not enable video generation or change your AI roles.

## One-time Google client setup

Nakama is your private desktop application. Google's OAuth system still needs an application client ID before it can show a sign-in consent screen.

1. Open the Google Cloud console using the Google account that will own the private OAuth configuration.
2. Choose or create a project for this integration. Enable Gmail API and Google Calendar API.
3. Configure the Google Auth Platform consent screen. For personal Gmail accounts, use the appropriate external/testing configuration and add each personal account as a test user.
4. Create an OAuth client of type **Desktop app**. Keep the downloaded credential file private.
5. In Nakama's Google connection panel, enter the desktop client ID and, if the client configuration supplies one, its client secret. Choose Gmail, Calendar, or both.
6. Open the Google sign-in link and select the intended personal account. Grant the requested permissions.
7. Return to Nakama and confirm the connected email address. Repeat for additional accounts.

The application uses a random localhost callback port. Do not create a web-application client with an unrelated fixed callback URL. Consent settings, Workspace administration, and testing-token expiry can require reconnecting; use Google's current console guidance if the labels differ.

## Everyday use

Select the account before reading messages, sending an email, or adding an event. Gmail search retrieves a limited list and message summaries. Sending uses a separate explicit action. Calendar requests carry start/end dates with timezone offsets so an ambiguous local time is not silently interpreted.

The ordinary-action confirmation setting applies to explicit sends and event creation where integrated. A draft or open composer must remain labelled as such until the provider confirms the write.

Disconnect an account in Nakama to remove its local credential. You can also revoke Nakama's access from your Google account's third-party access settings. Revocation may invalidate more than one local connection created for the same OAuth client.

## Troubleshooting

- **Access blocked or unverified app:** check your consent-screen test users and organisation policy.
- **Redirect mismatch:** confirm that the client is a Desktop app.
- **Expired access:** reconnect; testing applications can have limited refresh-token lifetimes.
- **Wrong account:** disconnect that record and add the intended identity. Gmail and Calendar can use separately selected accounts.
- **Missing permission:** reconnect with the service enabled and grant its scopes.

No real email or calendar write is performed as part of Nakama's local automated tests.

Official references: [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Calendar event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
