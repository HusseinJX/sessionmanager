# How to Deploy SessionManager

Droplet: `sessionmanager` — `64.23.191.7`

## Steps

1. **Build server and web locally**

```bash
cd server && npm run build && cd ..
cd web && npm run build && cd ..
```

2. **Deploy built files to droplet**

```bash
rsync -avz --delete server/dist/ root@64.23.191.7:/opt/sessionmanager/server/dist/
rsync -avz --delete web/dist/ root@64.23.191.7:/opt/sessionmanager/web/dist/
```

3. **Restart the service**

```bash
ssh root@64.23.191.7 "systemctl restart sessionmanager"
```

4. **Verify**

```bash
ssh root@64.23.191.7 "systemctl status sessionmanager --no-pager | head -10"
ssh root@64.23.191.7 "curl -s http://localhost:8080/ | grep 'index-'"
```

## Notes

- The app runs as a systemd service (`sessionmanager.service`) at `/opt/sessionmanager/server`
- Caddy reverse proxies port 80 → 8080 (system Caddy, not Docker)
- Static web files are served from `/opt/sessionmanager/web/dist/`
- There is no git repo on the droplet — files are copied via rsync
- If `server/web-ui/` exists on the droplet, it takes priority over `web/dist/` — delete it if stale
