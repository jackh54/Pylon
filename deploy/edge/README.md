# Custom-domain edge (VPS + Caddy)

Serve customer status pages on their own domains for free, using a server you already have.

```
visitor ──https://status.customer.com──▶ your VPS (Caddy, on-demand TLS)
                                            │  asks Pylon: may I get a cert for status.customer.com?
                                            │  then proxies with X-Pylon-Host + shared secret
                                            ▼
                                      Pylon Worker (Cloudflare) ──▶ renders that page at "/"
```

- Customers add one DNS record: `CNAME status.customer.com → edge.yourdomain.com` (DNS only / grey cloud on Cloudflare), or an `A` record to the VPS for bare domains.
- Pylon checks DNS every few minutes and marks the domain **connected**. Only connected domains on a plan with custom domains get certificates, so nobody can make your server request certificates for arbitrary names.
- Certificates come from Let's Encrypt via the TLS-ALPN-01 challenge on port 443, so port 80 can stay with nginx or anything else.
- Unverified claims are released after 7 days; domains whose DNS moves away are deactivated by the daily job.

The alternative with no server at all is Cloudflare for SaaS (100 hostnames included with any Cloudflare zone); this folder is for running it on your own box.

## Setup

1. **DNS for the edge itself.** Create `edge.yourdomain.com` as an `A` (and `AAAA`) record pointing at the VPS, DNS only.
2. **Shared secret.** Generate one and give it to the Worker:
   ```bash
   openssl rand -hex 32
   npx wrangler secret put EDGE_SECRET
   ```
3. **Worker config** (`wrangler.jsonc` → `vars`), then `pnpm deploy`:
   ```jsonc
   "CUSTOM_DOMAIN_TARGET": "edge.yourdomain.com",
   "CUSTOM_DOMAIN_IPS": "203.0.113.10"
   ```
4. **Install Caddy on the VPS** (port 443 must be free):
   ```bash
   scp deploy/edge/{install.sh,Caddyfile.template} you@vps:/tmp/pylon-edge/
   ssh you@vps 'sudo PYLON_URL=https://status.yourdomain.com EDGE_HOSTNAME=edge.yourdomain.com \
     ACME_EMAIL=you@yourdomain.com EDGE_SECRET=<secret> bash /tmp/pylon-edge/install.sh'
   ```
   The script installs Caddy from the official repository, validates the config before switching, and restores the previous config if Caddy fails to start.
5. **Check it:** `curl https://edge.yourdomain.com/healthz` → `ok`. Add a custom domain to a status page and press *Check DNS now*.

## Operations

| Task | Command |
|---|---|
| Logs | `journalctl -u caddy -f` and `/var/log/caddy/pylon-edge.log` |
| Certificates on disk | `/var/lib/caddy/.local/share/caddy/certificates/` |
| Reload after editing | `sudo systemctl reload caddy` |
| Rotate the secret | new `wrangler secret put EDGE_SECRET`, then re-run `install.sh` with the new value |
| Remove | `sudo systemctl disable --now caddy && sudo apt remove caddy` |

Monitor the edge with Pylon itself: an HTTP monitor on `https://edge.yourdomain.com/healthz`.

## Notes

- The proxy drops the `Referer` header on its way to Pylon. Without that, Cloudflare **Hotlink Protection** on the Pylon zone returns 403 for images (logos, OG images) requested from a customer's domain, because the referring site is a different domain. Disabling Hotlink Protection on the Pylon zone, or adding a configuration rule for the Pylon hostname, works too.

## Security notes

- The Worker trusts `X-Pylon-Host` **only** when `X-Pylon-Edge-Secret` matches `EDGE_SECRET`. Anyone else sending those headers is treated as a normal visitor.
- On a customer domain only status-page paths are served; `/app`, sign-in, docs and the API redirect to your main host, so cookies for the dashboard never live on customer domains.
- The secret is stored in `/etc/caddy/pylon-edge.env` (root:caddy, 0640).
