# Public HTTPS on iivm11.cit.tum.de

The production study is served at:

```text
https://iivm11.cit.tum.de/HAIC_part_1/
```

nginx runs inside the `study` container, terminates TLS, redirects HTTP to
HTTPS, serves reVISit, and proxies `/api/` and `/supabase/` to their private
Docker services.

## 1. DNS and firewall

Confirm that `iivm11.cit.tum.de` resolves to the VM and that inbound TCP ports
`80` and `443` are permitted. No Supabase, PostgreSQL, MinIO, or Python API port
should be publicly exposed.

```bash
getent hosts iivm11.cit.tum.de
sudo ss -ltnp | grep -E ':(80|443)\b' || true
```

Port 80 is required for the Let's Encrypt HTTP challenge and remains available
afterward only to redirect participant traffic to HTTPS.

## 2. Obtain the certificate

This VM does not have the centrally managed CIT `rbg-cert` client or `/etc/uqn`
configuration. The CIT guidance permits Let's Encrypt for machines that are not
provisioned with that client. Install Certbot and request the certificate while
ports 80 and 443 are still unused:

```bash
sudo apt update
sudo apt install -y certbot
sudo certbot certonly --standalone -d iivm11.cit.tum.de
sudo certbot certificates
```

Certbot asks for an email address and acceptance of the subscriber agreement.
The resulting files must exist at:

```text
/etc/letsencrypt/live/iivm11.cit.tum.de/fullchain.pem
/etc/letsencrypt/live/iivm11.cit.tum.de/privkey.pem
```

The Docker configuration mounts the complete `/etc/letsencrypt` directory
read-only because the files under `live/` are symlinks into `archive/`.

## 3. Reload nginx after renewal

Create a Certbot deploy hook:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo nano /etc/letsencrypt/renewal-hooks/deploy/reload-ai-withdrawal
```

Put this in the file:

```sh
#!/bin/sh
docker kill --signal=HUP ai-withdrawal-study >/dev/null 2>&1 || true
```

Then enable and test the renewal configuration:

```bash
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-ai-withdrawal
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

The deploy hook only runs after a successful renewal.

## 4. Configure the deployment

In `.env.docker`, set:

```env
STUDY_HTTP_PORT=80
STUDY_HTTPS_PORT=443
STUDY_PUBLIC_URL=https://iivm11.cit.tum.de
VITE_SUPABASE_URL=https://iivm11.cit.tum.de/supabase
TLS_CERT_ROOT=/etc/letsencrypt
```

The certificate directory and all secrets stay on the VM.

## 5. Start the public deployment

Start Supabase first:

```bash
docker compose \
  --env-file supabase/.env \
  -f supabase/docker-compose.yml \
  up -d
```

Then build and start the public study:

```bash
docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  up --build -d
```

## 6. Verify

```bash
docker compose \
  --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml \
  ps

curl -I http://iivm11.cit.tum.de/HAIC_part_1/
curl -I https://iivm11.cit.tum.de/HAIC_part_1/
curl https://iivm11.cit.tum.de/api/health
openssl s_client -connect iivm11.cit.tum.de:443 -servername iivm11.cit.tum.de </dev/null
```

Expected results:

- HTTP returns a `301` redirect to HTTPS.
- HTTPS Part 1 returns `200`.
- `/api/health` returns JSON with status `ok` and Supabase storage.
- The certificate SAN includes `iivm11.cit.tum.de`, and verification succeeds.

The four SONA URLs are listed in `AI_WITHDRAWAL_STUDY.md`.
