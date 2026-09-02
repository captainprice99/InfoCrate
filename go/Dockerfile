# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git make protobuf protobuf-dev

COPY go.mod ./
RUN go mod download || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/bin/infocrate-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/bin/infocrate-cli ./cmd/cli
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/bin/infocrate-bench ./cmd/benchmark

# Production stage
FROM alpine:3.19

WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /app/bin/infocrate-server /usr/local/bin/
COPY --from=builder /app/bin/infocrate-cli /usr/local/bin/
COPY --from=builder /app/bin/infocrate-bench /usr/local/bin/

EXPOSE 50051 9091
ENTRYPOINT ["infocrate-server"]
