# Prolific: Three Projects, Four Waves Each

Create **three longitudinal projects**, each containing four waves (12 studies in total).
Set estimated duration and fair payment separately for each condition and wave using pilot timings.
Create all four waves in each project **before publishing Wave 1**.
Use neutral public study names/descriptions, without Advisor/Judge labels or advance disclosure of withdrawal.

Researcher-only cohort mapping: A = control, B = advisor, C = judge.
Participants are assigned by the project they enter, not randomized again by this application.
Separate recruitment can introduce selection differences between conditions; do not describe it as random assignment.
Use mutually exclusive recruitment groups/exclusions across the three projects. The application also rejects a
participant who attempts to switch condition after enrollment.

## Configure and Deploy

1. In the existing Supabase project's SQL Editor, run `supabase/prolific_setup.sql`.
   This adds one metadata column; it does not delete or reset any records.
   The existing `submission_integrity.sql` migration must already be installed.
2. Append the settings from `prolific.env.example` to the VM's existing `.env.docker`.
   Keep all current Supabase, OpenRouter and HTTPS settings. Do not duplicate environment keys.
3. For each of the 12 waves, enter its **Study ID** (not project ID) and full completion URL.
   Example URL format: `https://app.prolific.com/submissions/complete?cc=YOUR_CODE`.
   The old single `PROLIFIC_COMPLETION_CODE` is not used for these waves.
4. Rebuild/recreate both services:

```sh
cd ~/study
git pull --ff-only origin main
docker compose --env-file .env.docker \
  -f docker-compose.yml -f docker-compose.supabase-cloud.yml \
  up -d --build --force-recreate study haic-api
```

5. In Prolific, choose URL-parameter capture for `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID`.
   Paste the corresponding entry link printed below. Preserve the placeholder syntax exactly.
   An unsubstituted preview placeholder is intentionally rejected: use Prolific's real test identifiers or
   the existing SONA debug CLI for gameplay-only testing. Do not put real payment redirects in a mock test.

## All 12 Entry Links

The complete ready-to-paste URLs are also in `PROLIFIC_LINKS.txt`.

Print the four links per condition with one command on the VM:

```sh
docker compose --env-file .env.docker \
  -f docker-compose.yml -f docker-compose.supabase-cloud.yml \
  exec -T haic-api python prolific_links.py
```

Each link has this exact query string:

```text
?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

| Condition (Internal) | Session 1 Base URL | Session 2 Base URL | Session 3 Base URL | Session 4 Base URL |
| --- | --- | --- | --- | --- |
| Control | https://iivm11.cit.tum.de/api/prolific/start/a/1 | https://iivm11.cit.tum.de/api/prolific/start/a/2 | https://iivm11.cit.tum.de/api/prolific/start/a/3 | https://iivm11.cit.tum.de/api/prolific/start/a/4 |
| Advisor | https://iivm11.cit.tum.de/api/prolific/start/b/1 | https://iivm11.cit.tum.de/api/prolific/start/b/2 | https://iivm11.cit.tum.de/api/prolific/start/b/3 | https://iivm11.cit.tum.de/api/prolific/start/b/4 |
| Judge | https://iivm11.cit.tum.de/api/prolific/start/c/1 | https://iivm11.cit.tum.de/api/prolific/start/c/2 | https://iivm11.cit.tum.de/api/prolific/start/c/3 | https://iivm11.cit.tum.de/api/prolific/start/c/4 |

Append the query string above to each base URL, or use the CLI to avoid manual assembly.
Do not give Prolific the bare `/HAIC_part_N/` pages as recruitment links.

## Identity, Access and Completion

- The same Prolific participant ID joins all four waves. Study ID and submission/session IDs are stored per wave.
- A neutral entry endpoint validates all three identifiers and the configured wave ID, fixes the condition,
  then opens the existing session page. `sona_id` in the redirected internal URL is a compatibility alias,
  not a SONA requirement. Do not use reVISit's reserved `participantId` URL parameter; that means analysis mode.
- The next session opens **at least 24 hours after the original saved questionnaire submission**.
  It is not timed from payment approval, the last guess, or a later revisit.
- Prolific's longitudinal feature separately requires the preceding wave to be **approved**.
  Review/approve promptly (or configure the appropriate automatic approval action in Prolific);
  the application cannot override Prolific's eligibility rules. Schedule follow-up waves accordingly.
- Participants must enter each follow-up through its Prolific wave so its new submission ID is captured.
  No direct next-session shortcut is shown to Prolific participants.
- Completion requires four server-recorded finished games, the participant's own game confirmation code,
  and every required questionnaire item. Losing a game after 10 guesses is valid completion.
- Original questionnaire answers are preserved before completion. Only after upload verification on the
  final page is the Prolific return button shown, followed by an automatic redirect after five seconds.
  Reopening a completed session does not overwrite answers and offers the same return URL again.
- Prolific completion does not call SONA or mark SONA credit as granted. Returning to Prolific is not proof
  of payment approval; manage actual payment status in Prolific.
- The old unguarded `/api/prolific/complete` route is replaced with a guarded participant/session route.
  Plain URL identifiers are not cryptographic identity verification; this integration does not call the
  Prolific API to authenticate submissions or implement Prolific Secure External URL signatures.

## Measures and Gameplay

The experimental schedule is unchanged: support begins in Session 1 Game 4; it ends after Session 4 Game 1.
Control never has AI support. Four games, max 10 guesses each, six colors, four positions, repetitions allowed.

- S1: CR, Raw NASA-TLX, demographics.
- S2/S3: CR, Raw NASA-TLX.
- S4: CR, Raw NASA-TLX, willingness to depend for AI groups, **all seven ownership items for every group**.
- One attention check per session; scale item order remains randomized.

Ownership answers retain their existing IDs and 1-7 response values in analysis/export.
The item `ownership-outcome-mine-reversed` is reverse-worded; reverse-score as `8 - response` if constructing
a composite. The attention check is not an ownership item. No claim of scale validation is implied.

The completion requirement verifies actual recorded gameplay, not attentive reasoning: it does not force
AI chat, a minimum duration, or winning. Use recorded guesses, timing, attention checks and interaction
events for transparent, prespecified quality assessment rather than changing the manipulation.

## Data and Launch Check

Existing SONA data and links remain supported; the same combined export includes both recruitment sources.
`participant_status.csv` now includes `recruitment_platform` and `recruitment_json` (cohort and per-wave IDs).
Keep SONA and Prolific samples distinguishable in analysis.

Before launch, update the consent/recruitment materials for Prolific payment and longitudinal participation,
and review the necessity/disclosure of existing IP/device metadata and mouse/keyboard/chat tracking.
Remove Prolific identifiers before publicly sharing any research dataset.

Before recruitment, test every condition through all four waves, check ownership in Wave 4, check the
wave-specific return codes, and verify records in Supabase. Test early access, reload/resume and completed-session
reopening. Do not deploy against an unrelated/empty Supabase project.

Official setup references (checked 2026-11-06):
- https://researcher-help.prolific.com/en/articles/634040-how-to-run-longitudinal-studies
- https://researcher-help.prolific.com/en/articles/445178-what-survey-experimental-software-is-compatible-with-prolific
