# AI Support Withdrawal Study

This repository contains the four-part longitudinal Mastermind experiment for studying the introduction and withdrawal of AI support. It is built on reVISit and deployed with Docker Compose, a Python API, nginx, and self-hosted Supabase.

## Study structure

- Four SONA parts separated by 24 hours.
- Four complete Mastermind games per part, with up to ten attempts per game.
- Three retained conditions: control, AI Advisor, and AI Judge.
- AI support introduced in Session 1 game 4 and withdrawn after Session 4 game 1.
- Server-authoritative random codes, scoring, condition assignment, event tracking, and SONA credit granting.

See [AI_WITHDRAWAL_STUDY.md](AI_WITHDRAWAL_STUDY.md) for the experimental and SONA configuration.

## Local development

Install dependencies and start reVISit:

```bash
corepack enable
yarn install --frozen-lockfile
VITE_STORAGE_ENGINE=localStorage yarn serve
```

The frontend is then available at:

```text
http://127.0.0.1:8080/HAIC_part_1/?sona_id=local-test
```

Run the API separately from `services/haic_api`, or use Docker Compose for an integrated environment.

## Docker deployment

Production deployment retains the previous project's split Compose setup: start Supabase first, then start the study/API stack on the shared private network.

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml up -d

docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  up --build -d
```

Before deploying, run `python3 scripts/prepare_deployment_env.py`, add the
OpenRouter and SONA values to the generated `.env.docker`, and install the TLS
certificate files. Full instructions are in
[DEPLOY_LRZ_DOCKER.md](DEPLOY_LRZ_DOCKER.md).

Never commit `.env.docker`, production Supabase secrets, private keys, participant exports, or database backups.

## Combined longitudinal export

The export is deliberately unavailable through the participant-facing website.
An administrator with Docker access to the VM can create one ZIP containing
combined responses from all four parts, participant completeness flags, games,
guesses, interaction events, and raw JSON data:

```bash
docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.supabase-cloud.yml \
  exec -T haic-api python study_export.py

API_CONTAINER=$(docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.supabase-cloud.yml \
  ps -q haic-api)

docker cp \
  "$API_CONTAINER:/tmp/ai-withdrawal-study-export.zip" \
  ./ai-withdrawal-study-export.zip
```

Keep the ZIP outside the repository and treat the SONA IDs it contains as
pseudonymous research data.

## Verification

```bash
(cd services/haic_api && python3 -m unittest test_withdrawal_store.py)
yarn build
yarn playwright test tests/withdrawal-mastermind.spec.ts tests/withdrawal-sona-parts.spec.ts --project=chromium
```
