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
https://iivm11.cit.tum.de/HAIC_part_1/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_2/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_3/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_4/?sona_id=%SURVEY_CODE%
```

Set one timeslot for each part according to the SONA multi-part study instructions. SONA controls availability and sends its standard confirmation, availability, and daily reminder messages. Its built-in reminder cadence does not implement the previously discussed exact `+24h` and `+52h` custom schedule. The application does not send recruitment or scheduling mail; an exact second reminder would require a later approved mail integration.

For each part, copy SONA's **server-side** External Credit Granting URL into the matching `SONA_PART_N_COMPLETION_URL` variable in `.env.docker`. Replace SONA's participant placeholder (`XXXX`) with `{survey_code}`. The URL and any private key in it must remain server-side.

At the end of a part, the final reVISit component asks the API to grant SONA credit. The API advances the longitudinal record only after SONA accepts the request. Retrying is idempotent: a part already recorded as credited is not granted twice.

Do not enable `SONA_CREDIT_TEST_MODE` on the production VM. Use a fake SONA participant account and invitation code to test credit integration before launch.

### Administrator Debug Links

From the VM's `~/study` directory, create a fresh test participant directly in any session:

```sh
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.supabase-cloud.yml exec haic-api python debug_participant.py --session 4 --condition advisor
```

The command prints a participant URL that starts at game 1 of the requested session without prior SONA participation or waiting. Use sessions 1-4 and conditions `control`, `advisor`, or `judge`. Repeat to get a fresh ID and restart a test. The command requires administrator shell access; there is no public unlock endpoint or participant-facing debug control. Test records use unique `debug-` IDs, never call SONA for credit, and still save game, interaction, and questionnaire data. Exclude these IDs from research analyses. These links test the experiment itself, not SONA timing or real credit integration.

## Measurement schedule

- Part 1: study introduction, tutorial, Session 1, cognitive responsibility, NASA-TLX, and demographics.
- Parts 2-3: the current Mastermind session, cognitive responsibility, and NASA-TLX.
- Part 4: Session 4, cognitive responsibility, NASA-TLX, willingness to depend (Advisor/Judge only), ownership, final SONA credit, and study completion.

Cognitive responsibility uses the same four items and a seven-point agreement
scale in all sessions. Items within cognitive responsibility, NASA-TLX,
willingness to depend, and ownership are independently randomized for each
participant and session using reVISit's stored form order. Reloading a session
preserves its assigned order. Demographics and questionnaire block order remain
fixed; scale endpoints and answer options are not shuffled.
NASA-TLX displays the six questions without dimension headings,
rated from 0 to 100 in steps of five. This is Raw TLX without
pairwise weighting: the overall score is the mean of the six ratings.
Performance is anchored at 0 = Perfect and 100 = Failure; it is already oriented
toward higher workload and must not be reversed before averaging.
All repeated instructions refer to the four games of the session just completed.
Ownership uses the existing seven items with an AI-neutral instruction.
Willingness to depend retains the existing four AI-specific items, referring to
support experienced during the study, and is omitted for the control condition.
The previous short state battery, SUS, prior AI/game experience, Klepsch cognitive
load scales, and color marker items are no longer scheduled.

The separate Mastermind-familiarity screener and recruitment workflow remain outside this application.

### Participant Interface and Checks

The AI system prompts are adapted from `nenils/revisit_study` commit `b9476ed8a15c1e88083ad4c45120895bf7d0e9b4`, specifically `HAIC_role_Advisor_increasing_complexity.html` and `HAIC_role_Judge_increasing complexity.html`. Both generated suggestions/reviews and free-text chat use the same role-specific system-message builder. High autonomy permits solving, full predictions and refinements after user feedback; valid predictions from chat are prefilled as in the original. Low autonomy provides feedback only, never requests a full replacement guess, and never exposes a model recommendation through an Apply button or error fallback. Its RL recommendation is included in the system context for feedback calibration only. Both request one short explanatory sentence; high autonomy additionally requires the `PREDICTION` marker. Current four-game rules, six colors, random secrets, support schedule, neutral visible AI naming and server-configured model are retained instead of importing the legacy five-round difficulty schedule or hard-coded model. Interaction events carry prompt version `upstream-autonomy-v1`; deployed LLM instruction compliance still needs live testing.

Session 1 instructions include `withdrawal_tutorial.mp4`, converted from the supplied October 13 recording. Both supported conditions expose an AI chat with game history and current-guess context, labelled only `AI`. The internal condition assignment and support schedule are unchanged. Both chats allow strategy discussion before a complete guess or review; only the explicit Judge review button requires a complete proposed guess. Low-autonomy strategy chat remains feedback-only and does not supply full guesses. Advisor chat supports next-guess reasoning. Chats reset between games and their messages/responses are recorded as interaction events. Free-text chat contents are therefore research data, unlike the privacy-preserving keyboard activity categories.

Demographics include the lowercase weekday bot check (expected answer `tuesday`) and euro income ranges. This is a screening indicator, not reliable proof of human identity, and it does not automatically exclude respondents.

Exactly one additional attention check is embedded per session: Session 1 in demographics (code positions, answer `4`), Session 2 in cognitive responsibility (select `1`), Session 3 in NASA-TLX (available colors, answer `6`), and Session 4 in ownership (select `7`). All use a numeric 1-7 Likert response, with distinct `attention-check-session-N` IDs. Sessions 2-4 randomize the check among the scale items; demographics remain fixed. Each containing component defines reVISit's native `correctAnswer` using string values, matching Likert answer storage, and explicitly disables participant feedback. Wrong answers are visible through native correctness indicators in analysis, not automatic exclusion or credit denial. Exclude attention-check IDs from construct scores, including the six-dimension Raw TLX average. The linked `interruptions` feature inserts separate pages, so it is not used for these embedded items.

SONA credit confirmation is automatic, hidden and required: participants do not enter a value. The end page warns not to close the tab before upload confirmation, checks completion sequentially and retries errors. Supabase participant-data reads bypass browser cache, writes use zero cache duration, and completion no longer downloads and re-uploads participant data merely to set a year-long cache header. Actual production upload timing still needs measurement.

## Data and enforcement

The lightweight update preserves SONA-code participant links and the existing debug CLI, without browser/device binding or a new researcher login. Participant pages do not mount the Study Browser. Ordinary sessions unlock 24 hours after credit; debug IDs bypass that delay. Pending questionnaire uploads are flushed before the credit page starts, and the API verifies saved required responses before granting credit. Wrong attention-check responses remain accepted and flagged for analysis. AI controls stay locked while automatic advice is pending.

**Before recruitment:** the existing reVISit Supabase policies allow shared anonymous access, and researcher routes are not securely isolated. This development/pilot setup is not a production security release. Resolve those access controls before collecting real participant data. No database migration is needed for the lightweight update if the removed security migration was never applied. If it was applied, do not deploy this update until database policy compatibility has been reviewed; do not blindly reopen permissions.

The API owns random codes, scores guesses, enforces attempt limits, fixes the condition assignment, and validates part order. `withdrawal_participants` stores longitudinal state, credited parts, and completed game histories. `withdrawal_events` stores timestamped interaction, support, mouse, click, keyboard, and visibility events. Standard reVISit/Supabase response collection stores questionnaire data separately for each `HAIC_part_N` study ID.

Game completion does not advance the participant. The participant first completes the part's questionnaires; the SONA completion component then grants credit and advances the API record to the next part.

After four games, the API generates a random, participant-and-session-specific confirmation code such as `MM-S1-A4B82C09E13F`, saved in that session's `confirmationCode`. It is displayed and recorded as `played-game`, remains stable on reload, and is checked against the participant's own completed session before SONA credit is granted. Existing completed test sessions receive a code when reopened; no schema migration is needed. These are completion receipts, not access passwords or a replacement for the pre-recruitment access controls above.

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
