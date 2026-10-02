# Deploying the beta backend

Written Oct 2 2026, in a session that could not reach Supabase, so **none of this has been
run yet**. Anything marked **(unverified)** was not checked against the CLI or the
Management API. If it fails, check the current Supabase docs and fix this file.

What gets deployed: the migration in `supabase/migrations/`, the six Edge Functions in
`supabase/functions/`, one Edge Function secret (`CRON_SECRET`), two Vault secrets
(`project_url`, `cron_secret`), and some Auth settings on the hosted project.

## 0. What the session needs

| Need | Why |
|---|---|
| `SUPABASE_ACCESS_TOKEN` in the environment (a personal access token, from Account, Access Tokens) | The CLI reads it instead of `supabase login`. |
| The project ref (the `xxxx` in `https://xxxx.supabase.co`) | Every command below. Written as `$REF`. |
| The database password | `supabase link` and `supabase db push`. Written as `$DB_PASSWORD`. |
| Network access to `api.supabase.com`, `$REF.supabase.co` and the project's database pooler host | Deploy, test, migrate. |
| Node 22.18+ | `npx supabase` and the build script. |

```sh
export REF=xxxx                 # the project ref
export DB_PASSWORD=...          # never commit it, never echo it
npx -y supabase@2 --version     # any 2.x
```

## 1. Make sure the function copies are current

The functions import `packages/*/src` through copies in `supabase/functions/_shared/`.

```sh
node scripts/build-functions.ts --check   # exit 1 means stale
node scripts/build-functions.ts           # rewrite them if so, then commit
```

## 2. Link the project

```sh
npx supabase link --project-ref "$REF" --password "$DB_PASSWORD"
```

`--password` (short form `-p`) is **(unverified)** for the current CLI. Without it, the CLI
prompts. It writes `supabase/.temp/`, which is git-ignored.

If linking or `db push` cannot reach the database: the direct host
(`db.$REF.supabase.co`) is IPv6-only on most plans. Use the session pooler connection
string from the dashboard's **Connect** button with `--db-url` instead **(unverified that
the CLI does not pick the pooler itself)**.

## 3. Apply the migration

```sh
npx supabase db push --dry-run   # should list 20261003000000_beta.sql only
npx supabase db push
```

It creates the five tables, their RLS policies and column grants, the Vault functions,
enables `pg_cron` and `pg_net`, and schedules the job `hangoverbot-check` every minute.
The job sends nothing until step 5 adds the Vault secrets.

Vault (`supabase_vault`) is on by default in hosted projects. If the push fails on
`vault.`, check: `select extname from pg_extension where extname = 'supabase_vault';`.

## 4. Deploy the functions and set the cron secret

```sh
# A fresh random secret. Keep it in the environment only.
export CRON_SECRET=$(openssl rand -hex 32)
npx supabase secrets set CRON_SECRET="$CRON_SECRET" --project-ref "$REF"

npx supabase functions deploy espn-connect connection-setup read decide swap --project-ref "$REF"
npx supabase functions deploy check --no-verify-jwt --project-ref "$REF"
```

`config.toml` already says `verify_jwt = false` for `check`; the flag is there in case
deploy does not read it. Naming several functions in one `deploy` is **(unverified)**:
if it is refused, deploy them one at a time. If deploy asks for Docker, add `--use-api`
**(unverified)**: it bundles on Supabase's side instead.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into every function by
Supabase. Nothing else needs setting.

If the app's calls fail at the gateway with `401 Invalid JWT` while its session is
fine (possible on projects using the newer asymmetric JWT signing keys, **unverified**),
redeploy those five with `--no-verify-jwt` as well. Each one checks the caller itself
with `auth.getUser`, so that is safe.

## 5. Add the Vault secrets the cron job reads

The job reads `project_url` and `cron_secret` from `vault.decrypted_secrets` on every run.
`cron_secret` must equal `CRON_SECRET` from step 4.

With `psql` and the session pooler connection string from the dashboard's **Connect**
button (`$DB_URL`). Values go in as psql variables so they stay out of the shell history:

```sh
psql "$DB_URL" -v project_url="https://$REF.supabase.co" -v cron_secret="$CRON_SECRET" <<'SQL'
select vault.create_secret(:'project_url', 'project_url');
select vault.create_secret(:'cron_secret', 'cron_secret');
SQL
```

Without `psql`: the dashboard's SQL editor, with the values pasted in. Or the
Management API's `POST https://api.supabase.com/v1/projects/$REF/database/query` with a
JSON body `{"query": "..."}` and `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`
**(unverified)**.

To rotate the cron secret later, change both together:

```sql
select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<new secret>');
```

then `npx supabase secrets set CRON_SECRET=<new secret> --project-ref "$REF"`.

## 6. Auth settings on the hosted project

`config.toml` sets these for local runs only. On the hosted project, in the dashboard:

1. **Authentication, Sign In / Providers: Allow anonymous sign-ins: on.** Every app user
   starts anonymous.
2. **Email provider: Confirm email: on**, **Secure email change: on**, **Email OTP length: 6**.
3. **Authentication, Emails, Templates, "Change email address"**: subject
   `Your HangoverBot code`, body from `supabase/templates/email_change.html`. It must
   contain `{{ .Token }}`: the claim screen asks for the 6-digit code
   (`updateUser({ email })`, then `verifyOtp({ type: "email_change" })`), and the default
   template sends only a link.
4. **Email sending.** Supabase's built-in email service only delivers to addresses of
   the organisation's team members, and only a few an hour **(check the current limits)**.
   For the owner's own beta, either invite the owner's email address to the Supabase
   organisation, or set up custom SMTP under **Authentication, SMTP Settings**. Without
   one of those, nobody can claim an account, and without a claimed account there are no
   automatic moves.

The same through the Management API, `PATCH https://api.supabase.com/v1/projects/$REF/config/auth`,
all field names **(unverified)**:

```json
{
  "external_anonymous_users_enabled": true,
  "mailer_autoconfirm": false,
  "mailer_secure_email_change_enabled": true,
  "mailer_otp_length": 6,
  "mailer_subjects_email_change": "Your HangoverBot code",
  "mailer_templates_email_change_content": "<contents of supabase/templates/email_change.html>"
}
```

`npx supabase config push` can also push `config.toml`'s `[auth]` section **(unverified)**.
Read its diff before accepting: it may also overwrite settings the file leaves at their
defaults, such as the site URL.

## 7. Check it works

```sh
# Refused without the secret:
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$REF.supabase.co/functions/v1/check"     # 401

# Accepted with it. With no leagues connected yet: {"checked":0,"deferred":0,"results":[]}
curl -s -X POST "https://$REF.supabase.co/functions/v1/check" \
  -H "x-cron-secret: $CRON_SECRET" -H 'content-type: application/json' -d '{}'
```

Then, in SQL, after a minute or two:

```sql
select jobname, schedule, active from cron.job;                    -- hangoverbot-check, * * * * *, true
select status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 5;      -- succeeded
select status_code, content, error_msg, created
  from net._http_response order by created desc limit 5;           -- 200 and the JSON above
```

A `401` in `net._http_response` means the Vault `cron_secret` and the function's
`CRON_SECRET` differ. A `503` means `CRON_SECRET` is not set on the functions.

The function logs (dashboard, Edge Functions, a function, Logs) carry connection ids
and outcomes only. If anything there looks like a cookie, an ESPN URL with headers or a
credential, stop and fix the code: that must never be logged.

The first real proof of ESPN is the app: sign in to ESPN inside it, pick the league,
and the **What we read from ESPN** screen is `connection-setup` and `read` working.
Whether ESPN answers requests from Supabase's servers at all is **unverified** until then.

## 8. Values the app needs

```sh
npx supabase projects api-keys --project-ref "$REF"     # (unverified command name)
```

`EXPO_PUBLIC_SUPABASE_URL=https://$REF.supabase.co` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
(the `anon` key, or the dashboard's **Project Settings, API Keys**) go into `eas.json`'s
build profiles. Both are public. The service-role key never goes into the app.

## Stopping the automation

Every scheduled check, at once, until resumed:

```sql
select cron.alter_job((select jobid from cron.job where jobname = 'hangoverbot-check'), active := false);
-- and to resume:
select cron.alter_job((select jobid from cron.job where jobname = 'hangoverbot-check'), active := true);
```

One user's league only: set its protection to Alerts or Ask Me in the app, or pause it.

## Changing things later

- **Code in `packages/`:** `node scripts/build-functions.ts`, commit, redeploy the functions.
- **Schema:** a new, later-dated file in `supabase/migrations/`, then `npx supabase db push`.
  Never edit a migration that has been pushed.
