# Deployment

## Architektura

```
Vercel (apps/web)          Hetzner VPS (apps/worker)
  Next.js frontend    ←→     Processing Worker
  API routes               polling Neon DB každé 3s
       │                        │
       └────── Neon PostgreSQL ──┘
               Cloudflare R2 (obrázky)
```

## Vercel (web)

Deploy automaticky z `main` větve přes Git push.

```bash
vercel --prod              # manuální deploy
vercel env ls              # env proměnné
```

## Hetzner VPS (worker)

- **Server:** CAX11 (ARM, 2 vCPU, 4 GB RAM), Helsinki (hel1)
- **IP:** 204.168.176.128
- **OS:** Ubuntu 24.04
- **Firewall:** pouze SSH (port 22)
- **Služba:** systemd `ai-sedlacek-worker`

### SSH

```bash
ssh root@204.168.176.128
```

### Logy

```bash
journalctl -u ai-sedlacek-worker -f          # živé logy
journalctl -u ai-sedlacek-worker --since "1h ago"  # poslední hodina
```

### Deploy nové verze

```bash
ssh root@204.168.176.128
cd /opt/AiSedlacek
git pull
npm install
npx prisma generate --schema=packages/db/prisma/schema.prisma
systemctl restart ai-sedlacek-worker
```

### Restart / stop / status

```bash
systemctl restart ai-sedlacek-worker
systemctl stop ai-sedlacek-worker
systemctl status ai-sedlacek-worker
```

### Env proměnné

Uložené v `/opt/AiSedlacek/.env`:

| Proměnná | Popis |
|----------|-------|
| DATABASE_URL | Neon PostgreSQL connection string |
| ANTHROPIC_API_KEY | Claude API klíč |
| R2_ACCOUNT_ID | Cloudflare R2 account |
| R2_ACCESS_KEY_ID | R2 přístupový klíč |
| R2_SECRET_ACCESS_KEY | R2 tajný klíč |
| R2_BUCKET_NAME | R2 bucket |
| R2_PUBLIC_URL | Veřejná URL R2 bucketu |

### Systemd service

Konfigurace: `/etc/systemd/system/ai-sedlacek-worker.service`

Po úpravě service souboru:
```bash
systemctl daemon-reload
systemctl restart ai-sedlacek-worker
```

## Hetzner CLI (hcloud)

```bash
hcloud server list                     # seznam serverů
hcloud server ssh ai-sedlacek-worker   # SSH přes hcloud
hcloud server rebuild ai-sedlacek-worker --image ubuntu-24.04  # reinstall
hcloud server delete ai-sedlacek-worker  # smazání serveru
```

## Prisma migrace

Migrace se spouští z packages/db:

```bash
npx prisma migrate dev --schema=packages/db/prisma/schema.prisma    # lokální dev
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma # produkce
```

Po migraci je potřeba restartovat worker na Hetzner i redeploy na Vercel.
