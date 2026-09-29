# Public HTTPS on iivm11.cit.tum.de

The production study is served at:

```text
https://iivm11.cit.tum.de/HAIC_part_1/
```

nginx runs inside the `study` container, terminates TLS, redirects HTTP to HTTPS, serves reVISit, and proxies `/api/` and `/supabase/` to their private Docker services.

## 1. DNS and firewall

Confirm that `iivm11.cit.tum.de` resolves to the VM's public address and that inbound TCP ports `80` and `443` are permitted. No Supabase, PostgreSQL, MinIO, or Python API port should be publicly exposed.

```bash
getent hosts iivm11.cit.tum.de
sudo ss -ltnp | grep -E ':(80|443)\b'
```

Port 80 is retained only for the HTTPS redirect and certificate-related reachability. Participant traffic uses port 443.

## 2. Obtain the CIT certificate with rbg-cert

For CIT Ubuntu VMs, follow the ITO server-certificate procedure and use the centrally maintained `rbg-cert` installation. Do not use `mkcert`; its local CA is suitable only for local development. Manual CSR issuance is an exception when neither `rbg-cert` nor Let's Encrypt is possible.

First confirm that the VM and all required aliases are correctly registered in the StrukturDB. Then run:

```bash
sudo rbg-cert --show
sudo rbg-cert --force-request
sudo rbg-cert
sudo ls -la /var/lib/rbg-cert/live
```

The Docker configuration expects these automatically renewed files:

```text
/var/lib/rbg-cert/live/iivm11.cit.tum.de.fullchain.pem
/var/lib/rbg-cert/live/iivm11.cit.tum.de.privkey.pem
```

If `rbg-cert --show` reports a different canonical filename, update the two `ssl_certificate` paths in `docker/nginx/https.conf` to match it. Do not copy the private key into Git or relax its permissions.

The ITO timer renews certificates automatically before expiry. The directory is mounted read-only into nginx using `TLS_CERT_DIR=/var/lib/rbg-cert/live`.

## 3. Reload nginx after renewal

Create a renewal hook so the running container starts using a renewed certificate:

```bash
sudo install -d -m 755 /usr/local/cert.d
sudo nano /usr/local/cert.d/ai-withdrawal
```

Put this in the file:

```sh
#!/bin/sh
docker kill --signal=HUP ai-withdrawal-study >/dev/null 2>&1 || true
```

Then enable it:

```bash
sudo chmod 755 /usr/local/cert.d/ai-withdrawal
```

This uses the supported `/usr/local/cert.d/` renewal-hook mechanism without modifying `rbg-cert` itself.

## 4. Configure the deployment

In `.env.docker`, set:

```env
STUDY_HTTP_PORT=80
STUDY_HTTPS_PORT=443
STUDY_PUBLIC_URL=https://iivm11.cit.tum.de
VITE_SUPABASE_URL=https://iivm11.cit.tum.de/supabase
TLS_CERT_DIR=/var/lib/rbg-cert/live
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
- The certificate subject or SAN includes `iivm11.cit.tum.de`, and certificate verification succeeds.

The four SONA URLs are listed in `AI_WITHDRAWAL_STUDY.md`.
