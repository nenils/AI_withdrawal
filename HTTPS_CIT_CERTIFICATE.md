# HTTPS Deployment With CIT/ITO Server Certificate

This project can serve the study at:

```text
https://iivm6.cit.tum.de/HAIC_part_1/
```

The repository contains the nginx and Docker configuration, but the certificate and private key must stay on the VM and must never be committed.

## 1. Firewall

Ask LRZ/IT to keep these inbound ports open for the VM:

```text
TCP 80
TCP 443
```

Port 80 is used for the HTTP-to-HTTPS redirect. Port 443 is used for HTTPS.

## 2. Create A Private Key And CSR On The VM

Run this on the VM:

```bash
cd ~/AI_withdrawal
mkdir -p certs
chmod 700 certs

openssl req -new -newkey rsa:3072 -nodes \
  -keyout certs/iivm6.cit.tum.de.key \
  -out certs/iivm6.cit.tum.de.csr \
  -subj "/CN=iivm6.cit.tum.de" \
  -addext "subjectAltName=DNS:iivm6.cit.tum.de"

chmod 600 certs/iivm6.cit.tum.de.key
```

Submit `certs/iivm6.cit.tum.de.csr` through the CIT/ITO server certificate process.

## 3. Install The Returned Certificate

After CIT/ITO returns the server certificate and intermediate chain, place them in `certs/`.

The nginx config expects:

```text
certs/iivm6.cit.tum.de.key
certs/iivm6.cit.tum.de.fullchain.pem
```

If CIT/ITO gives you separate files, create the full chain by concatenating the server certificate first, then intermediate certificates:

```bash
cat certs/iivm6.cit.tum.de.crt certs/intermediate-ca.pem > certs/iivm6.cit.tum.de.fullchain.pem
chmod 600 certs/iivm6.cit.tum.de.key
chmod 644 certs/iivm6.cit.tum.de.fullchain.pem
```

Adjust the file names in the command to match the files you receive.

## 4. Configure The Deployment Environment

In the VM-local `.env.docker`, use:

```env
STUDY_HTTP_PORT=80
STUDY_HTTPS_PORT=443
STUDY_PUBLIC_URL=https://iivm6.cit.tum.de
```

Keep your real `OPENROUTER_API_KEY` only in `.env.docker` on the VM.

## 5. Start HTTPS Deployment

Use the HTTPS and self-hosted Supabase Compose overrides:

```bash
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml down

sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.selfhosted-supabase.yml \
  -f docker-compose.https.yml up --build -d
```

## 6. Test

```bash
curl -I http://iivm6.cit.tum.de/HAIC_part_1/
curl -I https://iivm6.cit.tum.de/HAIC_part_1/
curl -I https://iivm6.cit.tum.de/api/health
```

Expected:

```text
HTTP on port 80 -> 301 redirect to HTTPS
HTTPS on port 443 -> 200 OK
```

Participant URL:

```text
https://iivm6.cit.tum.de/HAIC_part_1/?sona_id=%SURVEY_CODE%
```
