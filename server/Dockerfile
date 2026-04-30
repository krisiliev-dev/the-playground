# Multi-stage build for a minimal production image.
#
# Stage 1: Build the Rust binary (uses full toolchain)
# Stage 2: Copy just the binary into a tiny distroless image
#
# Final image is ~15-20 MB compared to ~1.5 GB for a full Rust image.

# ── Build stage ─────────────────────────────────────────────────────

FROM rust:1.85-slim AS builder

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

# Install runtime dependencies:
#   ca-certificates  — HTTPS requests
#   curl             — used by HEALTHCHECK and yt-dlp updater
#   ffmpeg           — EAC → equirectangular conversion
#   python3 + pip    — yt-dlp is a Python tool
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp (newer than the apt package; breaks often if stale)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

WORKDIR /home/appuser

# Videos directory — bind-mounted from the host in production
RUN mkdir -p /home/appuser/videos

# Copy the compiled binary from the builder
COPY --from=builder /app/target/release/portfolio-world-server ./server

# Default environment variables
ENV VIDEOS_DIR=/home/appuser/videos
ENV PORT=8080
ENV RUST_LOG=info

EXPOSE 8080

# Health check for ECS/load balancer
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["./server"]
