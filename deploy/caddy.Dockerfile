# Caddy с модулем DuckDNS — сертификат выпускается и продлевается через DNS-01,
# поэтому для Let's Encrypt не нужен открытый порт 80.
FROM caddy:2.10-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2.10-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
