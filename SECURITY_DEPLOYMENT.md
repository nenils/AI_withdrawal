# Security deployment

This release requires both a Supabase migration and new frontend/API images. Do not deploy only one half while recruiting. No live database changes are performed by the coding task.

## 1. Stop collection and update the VM checkout

Pause recruitment in SONA. On the VM:

```sh
cd ~/study
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.supabase-cloud.yml stop study haic-api
git pull --ff-only origin main
```

Take a database/storage backup before changing access policies. Existing rows and files are retained by the migration.

## 2. Configure Supabase authentication

Enable Anonymous Sign-Ins in Supabase Authentication. Participants do not enter an email/password. They must return in the same browser/profile and must not clear browser storage during the four sessions. The private SONA survey code authorizes the first browser binding; keep these links private. Another browser cannot take over an existing binding just by knowing its ID.

Create a confirmed email/password user for each researcher in Supabase Authentication. Use a separate browser profile for researcher access versus participant testing.

## 3. Apply the migration in Supabase SQL Editor

For the existing project, run the complete contents of `supabase/security_hardening.sql` once. For a new project, first run `supabase/cloud_setup.sql`, then `supabase/security_hardening.sql`.

Authorize only the intended researcher accounts (replace the example email):

```sql
insert into public.study_researchers (user_id)
select id from auth.users where email in ('nils.ness@tum.de')
on conflict do nothing;
```

Confirm this selects the intended user, not zero rows. Do not allow participants to insert into this table. Anonymous users use the authenticated database role too; the policies deliberately check explicit ownership/researcher membership, not just whether someone is authenticated.

Review any additional policies not created by this repository: permissive PostgreSQL policies are ORed together. Do not retain unrelated permissive policies granting access to `public.revisit` or the `revisit` bucket.

## 4. Build and restart both services

```sh
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.supabase-cloud.yml up -d --build study haic-api
```

No new secret is required: signed API cookies derive their signing key from the server-only Supabase service key. Optionally configure a separate cryptographically random `STUDY_SESSION_SECRET` in `.env.docker` before recreating the API container. Never use a VITE-prefixed variable for this secret. No service key is sent to the browser.

Researchers sign in at `https://iivm11.cit.tum.de/login`, then use the existing analysis routes. Native analysis remains available to authorized researchers; public analysis and participant study navigation are disabled. The command-line combined export continues to use service-role credentials privately.

## 5. Verify before reopening recruitment

- Generate fresh debug links and finish all questionnaires in a supported and control condition. Debug sessions bypass the 24-hour delay, but not required questionnaire checks.
- A second browser must not open the first browser's bound participant data. Public-key-only requests must not read or modify participant records/files.
- An anonymous participant must be redirected to `/login` when opening analysis; a researcher account in `study_researchers` must retain access.
- Ordinary participants must wait 24 hours after credit before playing the next session, even when manually opening its URL. The migration backfills the timestamp from existing credit records where available.
- Do not switch questionnaire versions while participants are in progress: the API verifies the currently deployed required-item manifest. Use this deployment before launch, or first resolve in-progress participants with the researcher.
- Run `tests/verify_security_policies.mjs` against a disposable PostgreSQL test database (see the script) or independently audit the deployed policies before opening recruitment. Local mocked tests do not verify live project settings.

## Browser recovery

After verifying a participant's identity through the recruitment process, an administrator can release only the browser binding without resetting data:

```sh
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.supabase-cloud.yml exec -T haic-api python study_admin.py release-browser --participant-id PARTICIPANT_ID
```

Have the participant immediately reopen their original private SONA link in the intended browser. Do not use this command to reset completed games or bypass session timing. Previously issued API cookies lose participant access when the binding is released/reassigned.
