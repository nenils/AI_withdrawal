# Deploying the AI Withdrawal Study on an LRZ VM

The deployment follows the previous study's Docker structure:

- `study`: builds reVISit and serves it through nginx.
- `haic-api`: runs the Mastermind, RL/LLM, event, and SONA-credit API.
- `supabase/*`: runs the persistent PostgreSQL, PostgREST, Storage, and supporting Supabase services.

The application and Supabase remain separate Compose projects. `docker-compose.selfhosted-supabase.yml` joins the frontend and API to Supabase's private Docker network.

## 1. Prepare the VM

Install Docker Engine and the Docker Compose plugin, then clone the deployment repository:

```bash
git clone https://github.com/nenils/AI_withdrawal.git
cd AI_withdrawal
```

Allow inbound TCP ports `80` and `443`. Supabase's Kong, Analytics, and MinIO ports bind only to `127.0.0.1` and should not be opened in the firewall.

## 2. Configure Supabase

Generate VM-local Supabase and study environment files before the first start:

```bash
python3 scripts/prepare_deployment_env.py
```

This creates `supabase/.env` and `.env.docker` with permissions `0600`, random
database/dashboard/logging secrets, and anon/service-role JWTs signed by the
same random JWT secret. The files are ignored by Git. Do not commit them.

For the bundled same-domain deployment, set:

```env
SITE_URL=https://iivm11.cit.tum.de
API_EXTERNAL_URL=https://iivm11.cit.tum.de/supabase
SUPABASE_PUBLIC_URL=https://iivm11.cit.tum.de/supabase
```

Start Supabase first so its `supabase_default` Docker network exists:

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml up -d
```

The withdrawal database migration is mounted into PostgreSQL and runs automatically when a new database volume is initialized. If the database volume already exists, apply it once:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < supabase/volumes/db/init/withdrawal_sessions.sql
```

## 3. Configure the study

Open the generated VM-local study environment file and fill in at least the
OpenRouter and SONA values:

```env
VITE_STORAGE_ENGINE=supabase
VITE_SUPABASE_URL=https://iivm11.cit.tum.de/supabase
VITE_SUPABASE_ANON_KEY=<same anon key as supabase/.env>

SUPABASE_URL=http://kong:8000
SUPABASE_SERVICE_ROLE_KEY=<same service-role key as supabase/.env>

STUDY_PUBLIC_URL=https://iivm11.cit.tum.de
TLS_CERT_ROOT=/etc/letsencrypt
OPENROUTER_API_KEY=<server-side key>

SONA_PART_1_COMPLETION_URL=<part-1 server-side completion URL>
SONA_PART_2_COMPLETION_URL=<part-2 server-side completion URL>
SONA_PART_3_COMPLETION_URL=<part-3 server-side completion URL>
SONA_PART_4_COMPLETION_URL=<part-4 server-side completion URL>
SONA_CREDIT_TEST_MODE=false
```

Keep all real credentials in `.env.docker` or `supabase/.env`; never add them to Git. Passing `--env-file .env.docker` is required because the frontend Supabase values are Docker build arguments.

## 4. Certificates

Install the Let's Encrypt certificate as documented in `HTTPS_CIT_CERTIFICATE.md`:

```text
/etc/letsencrypt/live/iivm11.cit.tum.de/fullchain.pem
/etc/letsencrypt/live/iivm11.cit.tum.de/privkey.pem
```

The complete `/etc/letsencrypt` tree is mounted read-only into nginx because the
files under `live/` are symlinks into `archive/`.

## 5. Build and start

```bash
docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  up --build -d
```

Check container health and logs:

```bash
docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  ps

docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  logs -f
```

## 6. Verify

```bash
curl -I http://iivm11.cit.tum.de/
curl -I https://iivm11.cit.tum.de/HAIC_part_1/
curl https://iivm11.cit.tum.de/api/health
curl -I https://iivm11.cit.tum.de/supabase/rest/v1/
```

HTTP should redirect to HTTPS. The study and API should return successful responses. Supabase may return `401` without an API key, which still confirms that nginx can reach Kong.

The four SONA Study URLs are:

```text
https://iivm11.cit.tum.de/HAIC_part_1/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_2/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_3/?sona_id=%SURVEY_CODE%
https://iivm11.cit.tum.de/HAIC_part_4/?sona_id=%SURVEY_CODE%
```

Test them with a fake SONA participant and invitation code before opening recruitment.

## 7. Persistence and backups

Application containers are disposable. PostgreSQL data remains under `supabase/volumes/db/data`, and MinIO data remains under `supabase/volumes/storage`. Back up the database to storage outside the VM on a schedule, for example:

```bash
mkdir -p backups
docker exec supabase-db pg_dump -U postgres -d postgres | gzip > "backups/supabase-$(date +%F-%H%M).sql.gz"
```

Do not use `docker compose down -v` in production; `-v` removes named volumes.
