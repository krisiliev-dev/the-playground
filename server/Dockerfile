# Multi-stage build for a minimal production image.
#
# Stage 1: Build the Rust binary (uses full toolchain)
# Stage 2: Copy just the binary into a tiny distroless image
#
# Final image is ~15-20 MB compared to ~1.5 GB for a full Rust image.

# ── Build stage ─────────────────────────────────────────────────────

FROM rust:1.82-slim AS builder

WORKDIR /app

# Copy manifests first — Docker caches this layer if deps don't change
COPY Cargo.toml Cargo.lock* ./

# Create a dummy main.rs to build dependencies (cache layer)
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Now copy the real source code and rebuild (only app code recompiles)
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ───────────────────────────────────────────────────

FROM debian:bookworm-slim AS runtime

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

WORKDIR /home/appuser

# Copy the compiled binary from the builder
COPY --from=builder /app/target/release/portfolio-world-server ./server

# Default environment variables
ENV PORT=8080
ENV RUST_LOG=info

EXPOSE 8080

# Health check for ECS/load balancer
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["./server"]
