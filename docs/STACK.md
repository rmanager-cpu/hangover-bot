# Stack

Decided 2026-10-02. Anything new goes on this stack unless this file is changed first.

| Layer | Choice |
|---|---|
| Mobile | Expo + React Native + TypeScript |
| Web | Next.js + TypeScript |
| Backend, database, auth | Supabase (Postgres) |
| Background worker | Node/TypeScript, either a persistent worker or a reliable scheduled-job service |
| Push | APNs + FCM, through Expo push to start |
| AI | OpenAI Responses API |
| Crashes and errors | Sentry |
| Browser extension | Manifest V3, TypeScript |

## What follows from it

- **TypeScript everywhere.** Mobile, web, worker and extension can share types and
  logic. Generate the database types from Supabase (`supabase gen types typescript`)
  rather than writing them by hand.
- **Postgres is the source of truth.** Row Level Security is on for every table the
  clients can reach. Clients use the anon key; only the worker and server-side code
  hold the service-role key.
- **AI calls happen on the server, never in a client.** The OpenAI key cannot ship in
  the app, the web bundle or the extension. Calls go through the worker, a Next.js
  route or a Supabase Edge Function.
- **Push starts on Expo's service.** Store each device's Expo push token in Postgres
  and send from the worker. Going straight to APNs/FCM later only changes the sender.
- **The extension authenticates against Supabase** like the other clients do. It does
  not get a separate auth system.
- **Sentry goes in every surface:** mobile, web, worker and extension, one project for
  each, so a crash says where it came from.
