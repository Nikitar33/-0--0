# WireGuard VPN

This folder contains a minimal WireGuard VPN setup for a private server.

## 1. Prepare environment

Copy the example file:

```bash
cp .env.example .env
```

Fill in the values:

- `SERVERURL` = public IP or domain of the VPN server
- `SERVERPORT` = 51820
- `PEERS` = names for client profiles, for example `phone1,laptop1`
- `INTERNAL_SUBNET` = `10.8.0.0`
- `ALLOWEDIPS` = `0.0.0.0/0`

## 2. Start the VPN server

```bash
docker compose up -d
```

## 3. Generate client config

List generated profiles:

```bash
docker compose exec wireguard /app/show-peer phone1
```

This prints a ready-to-use client configuration. Save it as `phone1.conf` and import it into the WireGuard app.

## 4. Manual client config

Use the example file in `client-template.conf.example` and replace:

- `REPLACE_PRIVATE_KEY`
- `REPLACE_SERVER_PUBLIC_KEY`
- `your-public-domain-or-ip`

## 5. Notes

- Only UDP 51820 should be exposed publicly.
- This is a basic MVP and is intended for private access.
- For production, add proper firewall rules, secrets management, and monitoring.

## 6. Basic firewall rule

```bash
ufw allow 51820/udp
```

## 7. Troubleshooting

Check client connectivity:

```bash
docker compose logs -f wireguard
```

Check traffic on the server:

```bash
wg
```
