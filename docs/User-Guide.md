# User Guide

This guide is for product users and admins using the web app.

App URL in local development: `http://localhost:3000`

## 1. Sign Up And Sign In

### Create an account

1. Open `/register`.
2. Enter email, password, and confirm password.
3. Submit the form.
4. You are redirected to `/dashboard` on success.

### Sign in

1. Open `/login`.
2. Enter email and password.
3. Select Sign In.
4. You are redirected to your post-login page (usually `/dashboard`).

## 2. Dashboard Walkthrough (`/dashboard`)

The dashboard shows:

- Current account identity (email, role, user id)
- Summary statistics:
  - total chats
  - files uploaded
  - token estimate
  - api calls
- Quick actions:
  - Start Chat
  - Upload File
  - Settings

If stats fail to load, use the Retry button shown in the dashboard alert.

## 3. Chat Flow (`/chat`)

### Start a text chat

1. Open `/chat`.
2. Type your prompt in the composer.
3. Submit to start streaming response.
4. The assistant response streams token-by-token in the UI.

### Resume/inspect history

1. In chat page, open history panel.
2. Choose an earlier session.
3. Session messages are loaded in read-only history view.

### Voice transcription flow

1. Start a transcription session from chat voice controls.
2. Allow microphone permission.
3. Speak while audio is posted to active transcription session.
4. Transcribed text events appear in real time.
5. Stop/close session when done.

## 4. Upload And Processing Flow (`/upload`)

### Upload and process a file

1. Open `/upload`.
2. Drag and drop a file (or choose from file picker).
3. Select mode:
   - sync: immediate extraction/chunk result
   - background: queued async processing
4. Monitor status and progress in jobs list.

### Use processed output

For completed jobs, you can inspect:

- chunk counts and token counts
- preview snippets (`chunkPreviews`)
- full chunk text payload (`chunkTexts`)

## 5. AI Provider Settings (`/settings/ai-providers`)

Admin/owner users can:

1. Open AI Providers page.
2. Add provider config with API key and optional tuning values.
3. Edit existing provider configs.
4. Deactivate provider configs.

Supported providers are fetched from backend (`/api/tenant/providers`).

## 6. Active Sessions (`/settings/active-sessions`)

Use this page to manage refresh-token sessions.

1. View active token ids.
2. Copy token id when troubleshooting.
3. Revoke an individual token/session.

Warning shown in UI: revoking your current active session will log you out on next API request.

## 7. Typical End-User Journeys

### Journey A: New user to first chat

1. Register at `/register`.
2. Land on `/dashboard`.
3. Go to `/chat`.
4. Send first message.

### Journey B: Admin setup to usable AI

1. Sign in as admin/owner.
2. Open `/settings/ai-providers`.
3. Add provider credentials.
4. Open `/chat` and verify responses.

### Journey C: Document-assisted workflow

1. Open `/upload` and process document.
2. Review extracted chunks.
3. Open `/chat` and use chunk context in prompts.

## 8. Troubleshooting

### Cannot sign in

- Verify credentials.
- Confirm backend is running.
- If recently revoked sessions, sign in again.

### Provider settings page fails

- Ensure account role is `admin` or `owner`.
- Verify backend `/api/tenant/providers` and `/api/tenant/config` are healthy.

### Upload fails

- Check file type/size limits.
- Confirm backend and Redis are running.

### Chat streaming stops

- Verify backend health and provider config.
- Retry message; for persistent issues, re-login and retry.

## 9. Screenshot Notes

This version documents all user flows with step-by-step instructions.
If you are preparing a marketplace listing, add UI screenshots for these pages:

- login/register
- dashboard
- chat with streamed response
- upload jobs list and details
- ai provider settings
- active sessions
