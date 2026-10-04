# Deploying the beta backend

Rewritten Oct 3 2026 for the way the deploy will actually happen: a cloud session with
the **Supabase MCP connector** (scoped to project `givfmjtlbojhsntceone` by `.mcp.json`) and
the **Expo MCP connector**, and **no shell access to Supabase or Expo**: no CLI, no
database password, no pooler host, no `SUPABASE_ACCESS_TOKEN`, no `EXPO_TOKEN`. The session
can run local commands (npm scripts) and read files; everything remote goes through a tool.

**None of this has been run yet.** Anything marked **(unverified)** is a tool parameter or
dashboard path written from the tools' descriptions, not from a run. If a call is refused,
read its error, fix the call, and fix this file.

What gets deployed: the migration in `supabase/migrations/`, the six Edge Functions in
`supabase/functions/`, two Vault secrets (`project_url`, `cron_secret`), one Edge Function
secret (`CRON_SECRET`, the owner's, by hand), and some Auth settings on the hosted project
(the owner's, by hand).

## 0. Who does what

| The session, through tools | The owner, in the dashboard on a phone |
|---|---|
| `apply_migration`, `execute_sql`: the schema, the cron job, the Vault secrets | `CRON_SECRET` on the Edge Functions (step 3) |
| `deploy_edge_function` ×6, `list_edge_functions` | Anonymous sign-ins on (step 5) |
| `get_publishable_keys`: confirm `eas.json` | Two email templates with `{{ .Token }}` (step 5) |
| `get_advisors`, `query_logs`: check it | Email delivery: invited address or SMTP (step 5) |
| `build_run`, `build_info`, `build_logs` (Expo), building the **pushed** branch from GitHub | Link the GitHub repo to the EAS project on expo.dev, then install the APK from the build page (step 8) |

The dashboard is `https://supabase.com/dashboard/project/givfmjtlbojhsntceone`. On a phone
the left sidebar is behind the menu button; the names below are the sidebar entries.

## 1. Make sure the function copies are current, and build the bundles

The functions import `packages/*/src` through copies in `supabase/functions/_shared/`,
and `_lib/` beside them. `deploy_edge_function` sends one function at a time as a flat
list of files named relative to that function's folder, so it cannot reach `../_lib` or
`../_shared`. `npm run functions:bundle` writes each function as a folder that stands on
its own.

```sh
npm run functions:check    # exit 1 means stale (npm test checks this too)
npm run functions:build    # rewrite the copies if so, then commit
npm run functions:bundle   # supabase/.bundle/<function>/ with a manifest.json each (gitignored)
```

`scripts/bundle-functions.test.ts` (in `npm test`) checks every import in every bundle
resolves inside it. `cd supabase/.bundle/<function> && npx -y deno@2 check index.ts` is
the same proof by Deno, and passed for all six on Oct 3.

## 2. Apply the migration

One call:

```
apply_migration
  name:  "20261003000000_beta"
  query: <the whole of supabase/migrations/20261003000000_beta.sql>
```

`name` is a label in snake_case, not a version: the tool's own description asks for "the
name of the migration in snake_case", and **the version it records in
`supabase_migrations.schema_migrations` is its own (the time of the call), with the name
stored beside it** (unverified: from the tool's description, not a run). The CLI matches
local files to hosted rows by version alone, so it would never recognise
`20261003000000_beta.sql` as applied and `db push` would try to run it again. After the
call, read what was recorded:

```sql
-- execute_sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Write the version here and commit: **applied version: `_______________`** (fill in after
step 2). Then either rename the local file to `<version>_beta.sql` so the CLI matches it,
or run `migration repair` before any `db push` (see "Fallback").

It creates the five tables, their RLS policies and column grants, the Vault functions,
enables `pg_cron` and `pg_net`, and schedules the job `hangoverbot-check` every minute.
The job sends nothing until step 3 adds the Vault secrets.

If the call fails on the `cron.schedule` at the end (the migration runner and `pg_cron`
disagreeing about the schema, say), run that last statement alone with `execute_sql`.
If it fails on `vault.`: `execute_sql`
`select extname from pg_extension where extname = 'supabase_vault';` and, if empty,
`create extension supabase_vault;` **(unverified: on by default on hosted projects)**.

Check:

```sql
-- execute_sql
select jobname, schedule, active from cron.job;                          -- hangoverbot-check, * * * * *, true
select table_name from information_schema.tables where table_schema = 'public' order by 1;
--  actions, activity, connections, credentials, devices
```

## 3. The cron secret, in two places

The cron job reads `project_url` and `cron_secret` from Vault on every run and sends the
secret as `x-cron-secret`. The `check` function compares it with its own `CRON_SECRET`.
**No MCP tool can set a function secret**, so that half is the owner's.

1. The session makes a secret locally and keeps it out of the repo and the logs. Short
   enough to type on a phone, long enough to be a secret:

   ```sh
   openssl rand -base64 24      # 32 characters, e.g. 7Qm3...
   ```

2. The session stores it, and the project URL, in Vault:

   ```sql
   -- execute_sql
   select vault.create_secret('https://givfmjtlbojhsntceone.supabase.co', 'project_url');
   select vault.create_secret('<the secret>', 'cron_secret');
   ```

3. The session gives the owner the secret (in the chat, once; it protects only the
   checker's trigger). **The owner, on the phone:** dashboard → **Edge Functions** →
   **Secrets** tab (the dashboard's "Edge Function Secrets Management" page) → **Add new
   secret** → Key `CRON_SECRET`, Value the secret, pasted → **Save** **(unverified: the
   tab's exact label; it is the page that lists `SUPABASE_URL` and the keys already)**.
   The secret applies to every function on the next request; no redeploy.

Until step 3 is done, `check` refuses every call, cron's included, with 503
`not_configured` and the log line `check: CRON_SECRET is not set. Add it in the dashboard
under Edge Functions, Secrets...`. Cron trying every minute and getting 503 is harmless.

To rotate later: `vault.update_secret` on `cron_secret` (see "Changing things later"),
then the owner edits `CRON_SECRET` the same way.

## 4. Deploy the six functions

**As done on Oct 4:** the 24-file bundles below are about 140 KB each, too large to send inline
in one `deploy_edge_function` call. `npm run functions:compile` turns each bundle into one
JS file (`supabase/.bundle-min/<fn>/index.js`, 20 to 50 KB, same code without comments) with
a `deno.json` that maps only `@supabase/supabase-js`. Deploy those two files per function:
`entrypoint_path: "index.js"`, `import_map_path: "deno.json"`, `verify_jwt: false`. A change
to the engine needs both `check` and `decide` redeployed together: an approval re-runs the
engine and refuses a proposal the other engine would not make.

For each of `espn-connect`, `connection-setup`, `read`, `decide`, `swap`, `check`, read
`supabase/.bundle/<name>/manifest.json`, read every file it lists, and call:

```
deploy_edge_function
  name:             <name>
  entrypoint_path:  "index.ts"
  import_map_path:  "deno.json"
  verify_jwt:       false
  files:            [ { name: "index.ts", content: ... }, { name: "deno.json", content: ... },
                      { name: "_lib/auth.ts", content: ... }, ..., { name: "_shared/service/words.ts", content: ... } ]
```

(24 files per function.) `import_map_path` is the bundle's `deno.json`, whose `imports`
map `@rosterbots/*` to `./_shared/...` and `@supabase/supabase-js` to
`npm:@supabase/supabase-js@2` **(unverified: that the deploy takes a deno.json as the
import map and keeps file subfolders; both are what the Management API documents)**.

**`verify_jwt: false` for all six, on purpose.** The gateway's JWT check knows only the
legacy JWT secret. This project uses the newer API keys (`sb_publishable_` in `eas.json`,
`sb_secret_` on the server) and may sign sessions with the newer signing keys, in which
case the gateway refuses valid sessions with `401 Invalid JWT` before a function runs. It
costs nothing to turn off: every user function checks the caller itself
(`_lib/auth.ts` `requireUser`: `auth.getUser` on the bearer token, `401 unauthorized`
without a user; the publishable key alone is refused too), and `check` takes
`x-cron-secret`, which pg_cron sends with no JWT at all, so `check` *must* have it off or
cron's calls never arrive. `supabase/config.toml` says the same for the CLI path.
The tool **has** the field: `verify_jwt` is **required**, its default is `true`, and its
description argues for `true` ("you SHOULD ALWAYS enable this"). It is still `false` here,
on every deploy and every redeploy, for the reasons above; each bundle's `manifest.json`
carries `verify_jwt: false` so the value is read, not remembered. If a deploy ever lands
with it on, the owner can turn it off in the dashboard, **Edge Functions** → the function →
**Details** → *Verify JWT with legacy secret* off **(unverified label)**, `check` first.

Then `list_edge_functions`: six functions, each `ACTIVE`, each `verify_jwt: false`.

The functions need no secrets of their own beyond `CRON_SECRET`: Supabase injects
`SUPABASE_URL` and the database key. Which key: the hosted runtime provides the legacy
`SUPABASE_SERVICE_ROLE_KEY` and, on projects with the newer keys, `SUPABASE_SECRET_KEYS`
(a JSON object of named `sb_secret_` keys) **(unverified names, from Supabase's
environment-variables page)**. `_lib/keys.ts` takes whichever is set, newer first, and
logs only the variable's name (`store: database key from ...`). If every function answers
500 and the log says `SUPABASE_URL and one of SUPABASE_SECRET_KEYS, SUPABASE_SECRET_KEY,
SUPABASE_SERVICE_ROLE_KEY must be set`, the runtime names the key something else: add
that name to `keys.ts`, or set `SUPABASE_SECRET_KEY` by hand on the Secrets page to the
project's secret key (dashboard, **Project Settings** → **API Keys**). A key that is set
but **refused** looks different: every user call answers 401, not 500 (step 6).

## 5. What the owner sets by hand in the dashboard

Under **Authentication**:

1. **Sign In / Providers** → **Allow anonymous sign-ins: on.** Every app user starts
   anonymous. Without it the app cannot start a session at all.
2. **Email** provider: **Confirm email: on**, **Secure email change: on**, **Email OTP
   length: 6** (the default; check it is not 8).
3. **Emails** → **Templates** → **Change email address**: subject `Your HangoverBot code`,
   body from `supabase/templates/email_change.html`. It must contain `{{ .Token }}`: the
   claim screen asks for the 6-digit code (`updateUser({ email })` then
   `verifyOtp({ type: "email_change" })`), and the default template sends only a link.
4. **Emails** → **Templates** → **Magic Link**: subject `Your HangoverBot sign-in code`,
   body from `supabase/templates/magic_link.html`, with `{{ .Token }}` for the same
   reason: signing back in to a claimed account (a reinstall, a second phone) uses
   `signInWithOtp` then `verifyOtp({ type: "email" })`, which sends this template.
5. **Email delivery.** Supabase's built-in sender delivers only to members of the Supabase
   organisation, and only a few an hour **(check the current limits)**. For the owner's
   own beta: invite the owner's email address to the organisation (**Organization
   settings** → **Team**), or set up custom SMTP (**Authentication** → **SMTP Settings**).
   Without one of those nobody can claim an account, and without a claimed account there
   are no automatic moves.

The session can check 1 and 2 afterwards with `get_advisors` (type `security`), which
flags auth misconfigurations, and with `query_logs` (service `auth`) once the app has
tried to sign in.

## 6. Check it works

After a minute or two:

```sql
-- execute_sql
select status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 5;      -- succeeded
select status_code, content, error_msg, created
  from net._http_response order by created desc limit 5;           -- 200 {"checked":0,"deferred":0,"results":[]}
```

- `503` with `not_configured`: `CRON_SECRET` is not set on the functions yet (step 3).
- `401`: the Vault `cron_secret` and the function's `CRON_SECRET` differ.
- `401` with a gateway body (`Invalid JWT`, no `error` field): `check` still has
  `verify_jwt` on (step 4).
- `500`: `query_logs` (service `edge-function`) for `check`; a `store: ... (42P01)` means
  the migration did not run, `must be set` means the key names (step 4).

Then `get_advisors` with `security` and `performance`: nothing about the five tables
should be `ERROR` (RLS is on everywhere; the Vault functions are `service_role` only).

A user-path smoke test, if the session's network allows HTTPS to
`givfmjtlbojhsntceone.supabase.co` (curl is local, not Supabase shell access):

```sh
# An anonymous session, as the app makes one (needs step 5.1):
curl -s -X POST "https://givfmjtlbojhsntceone.supabase.co/auth/v1/signup" \
  -H "apikey: sb_publishable_kWKeng0Nnl7eo2TCc326aA_W2_vCT60" -H 'content-type: application/json' -d '{}'
# -> {"access_token": "...", ...}. Then, with that token:
curl -s -X POST "https://givfmjtlbojhsntceone.supabase.co/functions/v1/read" \
  -H "Authorization: Bearer <access_token>" -H "apikey: sb_publishable_kWKeng0Nnl7eo2TCc326aA_W2_vCT60" \
  -H 'content-type: application/json' -d '{"connectionId":"00000000-0000-0000-0000-000000000000"}'
# -> 404 {"error":"not_found",...}. A 401 here means the gateway or requireUser refused the session.
```

Two 401s look alike from the phone and are not:

- A 401 whose body has **no `error` field** (`Invalid JWT`) is the gateway's: `verify_jwt`
  is on for that function (step 4).
- A 401 `{"error":"unauthorized"}` on **every** call with a fresh session, with
  `auth: getUser refused (401 ...)` in that function's log (`query_logs`, service
  `edge-function`), means the Auth server refused the function's **own** key, not the
  user's token: the runtime injected only the legacy `SUPABASE_SERVICE_ROLE_KEY` and the
  project's legacy JWT keys are disabled (plausible here: `eas.json` already carries an
  `sb_publishable_` key). The app shows it as "Your session has ended" on every screen
  after sign-in. The remedy is on the Secrets page: `SUPABASE_SECRET_KEY` = the project's
  `sb_secret_` key (**Project Settings** → **API Keys**); `_lib/keys.ts` prefers it over the
  legacy name. `requireUser` logs the refusal's status and error name only, never the token.

That proves the session reaches a function, the function reaches the database, and the
caller check works. The first real proof of ESPN is the app (step 8): sign in to ESPN
inside it, pick the league, and the **What we read from ESPN** screen is `espn-connect`,
`connection-setup` and `read` working. Whether ESPN answers requests from Supabase's
servers at all is **unverified** until then.

The function logs (`query_logs`, or the dashboard's **Edge Functions** → a function →
**Logs**) carry connection ids and outcomes only. If anything there looks like a cookie,
an ESPN URL with headers or a credential, stop and fix the code: that must never be logged.

## 7. Values the app needs

`get_publishable_keys` → the `sb_publishable_` key. It, and the project URL, are already
in `apps/mobile/eas.json` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
both profiles): confirm they match. Both are public by design. The secret key never goes
into the app.

## 8. The app build, through the Expo MCP connector

The project exists on expo.dev: id `ffa6f3e6-8c06-4fc3-a893-5605dd208191`, slug
`rosterbuddies-fkijb1junjqxswiiv33pi`, in `apps/mobile/app.config.ts`.

`build_run` builds **from a GitHub repository connected to the EAS project**, never from
the session's checkout (its description: "requires a GitHub repository to be connected to
the project"). So two things come first:

1. **The owner, on expo.dev:** the project → **GitHub** (under the project's settings) →
   install the Expo GitHub app on the repository if asked → connect this repo → **Base
   directory** `apps/mobile` **(unverified: the page's exact labels)**. Without this the
   call is refused for want of a connected repository.
2. **The coordinator pushes the branch to build.** `eas.json`, `app.config.ts` and the
   whole app are read from that commit on GitHub, not from the local checkout: an edit
   that is not pushed is not in the build.

Then, with the tool's real parameters (`platform`, `buildProfile` and `gitRef` are
required; `appId` or `appFullName` names the project; `baseDirectory` is the monorepo's):

```
build_run
  appId:          "ffa6f3e6-8c06-4fc3-a893-5605dd208191"
  platform:       "ANDROID"
  buildProfile:   "preview"
  gitRef:         "<the pushed branch, tag or commit SHA>"
  baseDirectory:  "apps/mobile"
build_info    buildId: <the id build_run returns>: status, and when finished the artifact (APK) URL
build_logs    the same id, when it fails
```

The Android preview profile makes an APK with an install link that opens on the phone
(allow the browser to install apps when Android asks). iOS (`profile: production`) needs
the Apple developer account, an APNs key and an App Store Connect API key first; see
`apps/mobile/README.md`. Android push is optional for Sunday (everything also lands in
Activity): a Firebase `google-services.json` as the EAS file variable
`GOOGLE_SERVICES_JSON`, plus an FCM V1 key under the project's credentials on expo.dev.

## Stopping the automation

Every scheduled check, at once, until resumed:

```sql
-- execute_sql
select cron.alter_job((select jobid from cron.job where jobname = 'hangoverbot-check'), active := false);
-- and to resume:
select cron.alter_job((select jobid from cron.job where jobname = 'hangoverbot-check'), active := true);
```

One user's league only: in the app, set its protection to Alerts or Ask Me, or pause it,
or **Settings** → **Forget my ESPN sign-in**, which deletes the credential (and with it the
leagues, and the cookies from Vault). The same from the dashboard, for an account nobody
can open any more (an old anonymous one, say):

```sql
-- execute_sql. Find it:
select c.id as credential_id, c.user_id, u.email, u.is_anonymous, n.league_id, n.status, n.authority, n.last_checked_at
  from public.credentials c
  join auth.users u on u.id = c.user_id
  left join public.connections n on n.credential_id = c.id
  order by n.last_checked_at desc nulls last;
-- Pause its leagues (reversible):
update public.connections set status = 'paused' where credential_id = '<credential_id>';
-- Or delete the credential: its leagues, actions and activity go with it, and the
-- credentials_drop_secret trigger removes the cookies from Vault.
delete from public.credentials where id = '<credential_id>';
```

## Fallback: the Supabase CLI

For a machine with a shell, network access to `api.supabase.com`, `givfmjtlbojhsntceone.supabase.co`
and the database pooler host, `SUPABASE_ACCESS_TOKEN` and the database password.
**(unverified)** throughout: none of it has run.

```sh
export REF=givfmjtlbojhsntceone
npx -y supabase@2 link --project-ref "$REF" --password "$DB_PASSWORD"   # -p; or --db-url with the pooler string
npx supabase db push --dry-run     # before the migration is applied: lists 20261003000000_beta.sql only.
                                   # After step 2 it must list nothing; if it still lists the file, the hosted
                                   # row has the version apply_migration gave it (step 2), so first:
npx supabase migration repair --status applied <that version>             # or rename the file to <version>_beta.sql
npx supabase db push
npx supabase secrets set CRON_SECRET="$CRON_SECRET" --project-ref "$REF"
npx supabase functions deploy --project-ref "$REF"      # all six; config.toml carries verify_jwt = false and the import maps
                                                        # add --no-verify-jwt if deploy ignores the file; --use-api if it asks for Docker
```

The Vault secrets as in step 3, through `psql "$DB_URL"` with `-v` variables so the
values stay out of the shell history, or the dashboard's SQL editor. The CLI's Postgres
client does not go through an HTTPS proxy, which is why a cloud session cannot use it.

`npx supabase config push` can push `config.toml`'s `[auth]` section **(unverified)**;
read its diff first, it may also overwrite settings the file leaves at defaults.

## Changing things later

- **Code in `packages/`:** `npm run functions:build`, commit, `npm run functions:bundle`,
  redeploy the functions whose bundles changed (all six share `_shared`, so usually all).
  **Every redeploy passes `verify_jwt: false`**, read from the bundle's `manifest.json`: the
  tool's field is required, defaults to `true`, and its description argues for `true`. A
  redeploy that takes the default puts the gateway check back on, and for `check` that means
  every cron POST is refused at the door with 401 while `cron.job_run_details` still says
  `succeeded`, so nothing is checked on Sunday until someone reads `net._http_response`.
  Afterwards `list_edge_functions` must show `verify_jwt: false` for all six.
- **Schema:** a new, later-dated file in `supabase/migrations/`, applied with
  `apply_migration` (or `db push`). Never edit a migration that has been applied. The
  Oct 3 edits to `20261003000000_beta.sql` (`write_verified_at`, the credential delete
  policy, two indexes) were made before it was ever applied.
- **The cron secret:** change both halves together:
  `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<new secret>');`
  and the owner edits `CRON_SECRET` on the Secrets page.
