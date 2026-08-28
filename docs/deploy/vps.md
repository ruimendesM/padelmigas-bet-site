# Deploying `apps/web` to the VPS

The site runs on the maintainer's VPS as a systemd unit behind nginx, at
**`padelmigas.ruimendesdev.eu`** — see
[ADR-010 § Amendment](../adr/ADR-010-hosting-vercel-supabase.md#amendment--2026-08-28-appsweb-runs-on-the-maintainers-vps-not-vercel).
Same idiom as the two services already on that host: build in Actions, rsync the artifact, restart a
unit. No container runtime.

| | |
| - | - |
| Host | Third service on the box that already runs the static site and the JVM service |
| Port | **3100** on loopback. 3000 is Hermes, 8080 the JVM service, 8090 the WhatsApp gateway |
| Releases | `/opt/padelmigas/releases/<sha>`, with `/opt/padelmigas/current` a symlink to one of them |
| Secrets | `/etc/padelmigas/env`, root-owned, mode `0600` |
| Unit | `padelmigas.service`, plus `padelmigas-rankings.timer` weekly |

---

## One-time host setup

Everything here is done once, as a human, before the first deploy. The workflow assumes all of it.

### 1. A Node 22 runtime that a system service can reach

The runtime at `/home/admin/.local/bin/node` is **not usable**: the unit runs as its own user with
`ProtectHome=true`, so `/home` is not visible to it, and a runtime inside one user's home disappears
the moment that install is re-managed. Install it system-wide:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

```bash
/usr/bin/node -v   # must print v22.x — the unit's ExecStart is this exact path
```

### 2. The service user and the release directories

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin padelmigas
sudo mkdir -p /opt/padelmigas/releases
sudo chown -R padelmigas:padelmigas /opt/padelmigas
```

The deploying SSH user needs to write there and to restart the unit:

```bash
sudo usermod -aG padelmigas "$USER"
sudo chmod -R g+w /opt/padelmigas
```

```bash
echo "$USER ALL=(root) NOPASSWD: /bin/systemctl restart padelmigas.service" \
  | sudo tee /etc/sudoers.d/padelmigas-deploy && sudo chmod 440 /etc/sudoers.d/padelmigas-deploy
```

Scoped to that one unit on purpose: the deploy key is held by GitHub, so whatever it can run is
what an attacker with that key can run.

### 3. The environment file

Six variables, all server-only. `apps/web/src/env.ts` validates them and **throws at startup** if any
is missing or malformed, so a half-written file fails loudly here rather than serving a degraded
site. See [`.env.example`](../../.env.example).

```bash
sudo mkdir -p /etc/padelmigas && sudo touch /etc/padelmigas/env
sudo chmod 600 /etc/padelmigas/env && sudo chown root:root /etc/padelmigas/env
sudo editor /etc/padelmigas/env
```

| Variable | Notes |
| -------- | ----- |
| `DATABASE_URL` | Supabase **transaction pooler, port 6543** — never the direct 5432 endpoint |
| `VOTER_COOKIE_SECRET` | ≥32 chars. `openssl rand -base64 48` |
| `ADMIN_PASSWORD_HASH` | argon2id PHC string. `pnpm tsx scripts/hash-admin-password.ts 'the password'` |
| `RANKINGS_CSV_URL` | The club sheet's CSV export. Not committed anywhere — this repo is public |
| `CRON_SECRET` | ≥32 chars. `openssl rand -hex 32`. The timer presents this as a bearer token |
| `RATE_LIMIT_SALT` | ≥16 chars. Salts the in-memory IP hash |

The pooler requirement has two independent reasons: burst connections when a tournament opens
(Risk R8), and the fact that Supabase's direct endpoint resolves to **IPv6 only**, which neither
GitHub Actions runners nor many VPS hosts can reach. Write no quotes around the values — systemd
takes the line literally.

### 4. DNS, then the certificate, then nginx

Order matters. Certbot cannot issue for a name that does not resolve, and nginx will not start while
a vhost references a certificate that does not exist yet.

1. Add an `A` record for `padelmigas.ruimendesdev.eu` pointing at this host. Confirm it:
   ```bash
   dig +short padelmigas.ruimendesdev.eu
   ```
2. Issue the certificate:
   ```bash
   sudo certbot --nginx -d padelmigas.ruimendesdev.eu
   ```
3. Install the vhost from this repository — do not hand-edit it on the host, or the test in
   `tests/architecture/nginx-forwarded-for.test.ts` stops describing what is deployed:
   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/padelmigas.ruimendesdev.eu
   sudo ln -sfn /etc/nginx/sites-available/padelmigas.ruimendesdev.eu /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

> **The `X-Forwarded-For` line differs from the other vhosts on this host, and that is not a
> mistake.** This one **replaces** the header (`$remote_addr`) where the others append to it. The
> ballot rate limiter keys on the first hop of that header, so the appending form would let any
> caller supply their own first hop and rotate their rate-limit key at will — the limit would not
> weaken, it would stop existing (Risk R2). CI fails if this is changed back.

### 5. The units

```bash
sudo cp deploy/padelmigas.service deploy/padelmigas-rankings.service \
        deploy/padelmigas-rankings-alert.service deploy/padelmigas-rankings.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now padelmigas-rankings.timer
```

`padelmigas.service` is **not** started yet — there is no release for it to run. The first deploy
creates one. Enable it so it survives a reboot:

```bash
sudo systemctl enable padelmigas.service
```

### 6. GitHub secrets

This repository starts with none. All three are required by
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml):

| Secret | Value |
| ------ | ----- |
| `DEPLOY_HOST` | The host's address. **A secret and not a literal because this repository is public** |
| `DEPLOY_USER` | The SSH user that owns the sudoers rule above |
| `DEPLOY_KEY` | Private half of a keypair whose public half is in that user's `authorized_keys` |

Prefer a **fresh keypair for this repository** over reusing the one the other services share: one
compromised key then cannot move all three.

---

## Deploying

Nothing to run by hand. Merge to `main`; CI runs its four jobs; on green, `Deploy` builds the
standalone bundle, rsyncs it to `releases/<sha>`, swaps the `current` symlink, restarts the unit, and
checks that it serves.

To redeploy the current `main` without a new commit, run the **Deploy** workflow manually
(`workflow_dispatch`).

The nothing-is-switched-until-it-is-on-disk ordering is deliberate: a failure during build or upload
leaves the running site untouched.

## Rolling back

The workflow rolls back on its own when a release fails its liveness check — that means the release
cannot run at all, typically a bad `/etc/padelmigas/env` or an `@node-rs/argon2` binding that will
not load. It deliberately does **not** roll back on a database outage, because the previous release
would fail identically and flapping between two broken versions hides the cause.

By hand, on the host:

```bash
ls -1t /opt/padelmigas/releases   # newest first; the current one is in /opt/padelmigas/current
```

```bash
sudo -u padelmigas ln -sfn /opt/padelmigas/releases/<sha> /opt/padelmigas/current.new \
  && sudo -u padelmigas mv -T /opt/padelmigas/current.new /opt/padelmigas/current \
  && sudo systemctl restart padelmigas.service
```

The swap is `ln` into a temporary name followed by `mv -T` rather than `ln -sfn` over the live link,
so the symlink is never momentarily absent.

The last five releases are kept. Roll forward the same way, or re-run the workflow.

## When the weekly sync fails

The timer runs Mondays at 04:00 with a randomised delay, and `Persistent=true` catches up a run
missed while the box was down.

```bash
systemctl list-timers padelmigas-rankings.timer
journalctl -u padelmigas-rankings.service -n 50
```

Run one immediately:

```bash
sudo systemctl start padelmigas-rankings.service
```

A failure triggers `padelmigas-rankings-alert.service`, which logs at `emerg` — broadcast to every
logged-in terminal — and mails root when an MTA exists.

### Alerting is the weak point here

ADR-010 § Amendment accepted the timer as a moving part **on the condition that its failures reach a
person**, and this is the thinnest part of that promise: with no MTA and nobody logged in, a failed
sync is visible only in the journal. If real alerting ever exists on this host, point
`padelmigas-rankings-alert.service` at it — that unit is the single place to change.

Note that a failed sync degrades gracefully: `ranking_snapshots` is the documented fallback for an
unreachable sheet (Risk R3, data-model.md), so the site keeps serving the last known ratings rather
than breaking. It is not an outage, but it does go unnoticed,
which is the whole reason for the alert unit.

## When the site is down

```bash
systemctl status padelmigas.service
journalctl -u padelmigas.service -n 100 --no-pager
```

| Symptom | Cause to check first |
| ------- | -------------------- |
| Unit restarts in a loop, `Invalid server environment` in the journal | `/etc/padelmigas/env` — a missing or malformed variable. The message names the variable |
| Unit dies immediately, error mentioning a `.node` file | `@node-rs/argon2` — the bundle's binding does not match this box. It was built for x86_64/glibc |
| `502` from nginx, unit running | Port mismatch. The unit must be on 3100 and `proxy_pass` must agree |
| `curl 127.0.0.1:3100/admin` works, the domain does not | nginx or the certificate: `sudo nginx -t`, then `sudo certbot certificates` |
| Everything up, pages error | The database. Check the pooler endpoint is reachable and Supabase is not paused |

## References

- [ADR-010 § Amendment](../adr/ADR-010-hosting-vercel-supabase.md) — why a VPS, why a subdomain, what it costs
- [`deploy/`](../../deploy) — the units and the vhost, which are the source of truth for what is installed
- [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) — the pipeline
- `apps/web/src/server/rate-limit.ts` — why the `X-Forwarded-For` rule exists
