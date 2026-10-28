FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vaultix .

FROM alpine:3.20
RUN apk add --no-cache wget ca-certificates && adduser -D -H vaultix
USER vaultix
COPY --from=build /out/vaultix /usr/local/bin/vaultix

ARG VAULTIX_SOURCE_REVISION=uncommitted
LABEL org.opencontainers.image.title="Vaultix panel"
LABEL org.opencontainers.image.description="Shippin overlay: PIN, lessons, Clyffy, manager. Not the vault."
LABEL org.opencontainers.image.url="https://vaultix.cloud"
LABEL org.opencontainers.image.source="https://github.com/shippinAI/vaultix"
LABEL org.opencontainers.image.vendor="AngryVibes LLC"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.revision="${VAULTIX_SOURCE_REVISION}"

ENV VAULTIX_PANEL_LISTEN=":8201"
EXPOSE 8201
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8201/api/v1/vaultix/trust || exit 1
ENTRYPOINT ["vaultix"]
