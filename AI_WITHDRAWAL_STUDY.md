# AI Support Withdrawal Study

## Experimental schedule

SONA hosts this experiment as a four-part Online External Study. Participants are assigned once, with equal simple-random probability, to `control`, `advisor`, or `judge`. The API retains that assignment under the participant's SONA survey code for all four parts.

| Session and game | Control | Advisor | Judge |
| --- | --- | --- | --- |
| Session 1, games 1-3 | No support | No support | No support |
| Session 1, game 4 | No support | Advisor introduced | Judge introduced |
| Sessions 2-3, all games | No support | Advisor available | Judge available |
| Session 4, game 1 | No support | Advisor available | Judge available |
| Session 4, games 2-4 | No support | Explicitly withdrawn | Explicitly withdrawn |

Each session has four independent games. Every game uses four positions and six colors, permits repeated colors, generates a fresh cryptographically random code, and ends after a correct guess or 10 attempts. An unsuccessful game advances to the next game instead of terminating the session.

## SONA configuration

Create one SONA multi-part study with four parts. For Parts 2-4, set **Available After** to `24` hours. A practical default for **Available For** is `72` hours; this remains a study-policy choice. Use these unique Study URLs, replacing the host with the deployed domain:

```text
https://iivm6.cit.tum.de/HAIC_part_1/?sona_id=%SURVEY_CODE%
https://iivm6.cit.tum.de/HAIC_part_2/?sona_id=%SURVEY_CODE%
https://iivm6.cit.tum.de/HAIC_part_3/?sona_id=%SURVEY_CODE%
https://iivm6.cit.tum.de/HAIC_part_4/?sona_id=%SURVEY_CODE%
```

Set one timeslot for each part according to the SONA multi-part study instructions. SONA controls availability and sends its standard confirmation, availability, and daily reminder messages. Its built-in reminder cadence does not implement the previously discussed exact `+24h` and `+52h` custom schedule. The application does not send recruitment or scheduling mail; an exact second reminder would require a later approved mail integration.

For each part, copy SONA's **server-side** External Credit Granting URL into the matching `SONA_PART_N_COMPLETION_URL` variable in `.env.docker`. Replace SONA's participant placeholder (`XXXX`) with `{survey_code}`. The URL and any private key in it must remain server-side.

At the end of a part, the final reVISit component asks the API to grant SONA credit. The API advances the longitudinal record only after SONA accepts the request. Retrying is idempotent: a part already recorded as credited is not granted twice.

Do not enable `SONA_CREDIT_TEST_MODE` on the production VM. Use a fake SONA participant account and invitation code to test all four URLs and credit events before launch.

## Measurement schedule

- Part 1: study introduction, tutorial, Session 1, short repeated state measures, prior AI/game experience, and demographics.
- Parts 2-3: the current Mastermind session and short repeated state measures.
- Part 4: Session 4, short repeated state measures, the established full outcome scales, final SONA credit, and study completion.

The separate Mastermind-familiarity screener and recruitment workflow remain outside this application.

## Data and enforcement

The API owns random codes, scores guesses, enforces attempt limits, fixes the condition assignment, and validates part order. `withdrawal_participants` stores longitudinal state, credited parts, and completed game histories. `withdrawal_events` stores timestamped interaction, support, mouse, click, keyboard, and visibility events. Standard reVISit/Supabase response collection stores questionnaire data separately for each `HAIC_part_N` study ID.

Game completion does not advance the participant. The participant first completes the part's questionnaires; the SONA completion component then grants credit and advances the API record to the next part.

## Generated study configs

The shared components are generated from `public/HAIC_study/assets/config.json` into `public/libraries/haic-withdrawal/config.json`. Four small study configs are generated under `public/HAIC_part_1` through `public/HAIC_part_4`.

After editing the source questionnaire definitions, regenerate them with:

```bash
node scripts/generate_sona_study_configs.mjs
```

## Supabase migration

New Supabase installations automatically apply `supabase/volumes/db/init/withdrawal_sessions.sql`. For an existing database volume, apply it once from the repository root:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < supabase/volumes/db/init/withdrawal_sessions.sql
```

The tables deny browser roles and are accessed only by the API using `SUPABASE_SERVICE_ROLE_KEY`.

## Required environment

Set the Supabase values and all four SONA completion URLs in the VM-local `.env.docker`; use `.env.docker.example` as the template. When either Supabase server value is absent, the API uses volatile in-memory state for local tests only. `/api/health` reports `withdrawalStorage` as either `supabase` or `memory`.
