ARG VAULTIX_BACKEND_TEST_IMAGE=vaultix:verify-backend
FROM golang:1.27.3-trixie AS toolchain
FROM ${VAULTIX_BACKEND_TEST_IMAGE}
COPY --from=toolchain /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
WORKDIR /workspace
COPY core/backend/package-lock.json /expected-backend-lock.json
RUN cmp /app/package-lock.json /expected-backend-lock.json
COPY core/backend-go ./core/backend-go
RUN cd core/backend-go && go mod download && CGO_ENABLED=0 go build -o /tmp/transport ./cmd/vaultix-transport
COPY scripts/fixtures/quic-peer/package*.json ./scripts/fixtures/quic-peer/
RUN npm ci --prefix scripts/fixtures/quic-peer --ignore-scripts --no-audit --no-fund
COPY scripts/test-owned-quic.mjs ./scripts/
COPY scripts/lib/test-certificates.mjs ./scripts/lib/
COPY core/backend/src/lib/gateway/transport.ts /app/src/lib/gateway/transport.ts
RUN ln -s /app core/backend
CMD ["node", "--experimental-strip-types", "scripts/test-owned-quic.mjs"]
