# Multi-stage build for a minimal production image.
#
# Stage 1: Build the Rust binary (full Rust toolchain)
# Stage 2: Copy just the binary into a slim debian runtime
#
# Final image: ~95 MB. The previous ~230 MB image carried `ffmpeg` +
# `python3` + `python3-pip` + `yt-dlp` for the video processing
# pipeline (EAC → equirectangular conversion, URL ingestion). Those
# features are paused; the tools are removed to slim the image and
# speed up cold pulls. To restore them, re-add this block to the
# runtime stage:
#
#     RUN apt-get update && apt-get install -y --no-install-recommends \
#         ffmpeg && rm -rf /var/lib/apt/lists/*
#     ARG YT_DLP_VERSION=2024.12.13
#     RUN curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
#         -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp
#
# Note: the standalone `yt-dlp_linux` PyInstaller binary embeds its
# own Python interpreter, so we no longer need to install
# `python3 + python3-pip` separately when video is reintroduced.

# ── Build stage ─────────────────────────────────────────────────────

FROM rust:1.85-slim AS builder

WORKDIR /app

# Copy manifests first — Docker caches this layer if deps don't change.
COPY Cargo.toml Cargo.lock* ./

# Build dependencies against a dummy main.rs so the deps layer caches
# independently of source changes.
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Real source code; only app code recompiles from here on.
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ───────────────────────────────────────────────────

FROM debian:bookworm-slim AS runtime

# Runtime deps:
#   ca-certificates — outbound HTTPS from the Rust process (e.g.
#                     hitting external APIs once multiplayer comes up)
#   curl            — HEALTHCHECK probe (~2 MB; cheap and useful)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security.
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

WORKDIR /home/appuser

# Bind-mount target. deploy.yml mounts the host's
# `/home/ubuntu/videos` here. The Rust app no longer reads from this
# directory (video features paused) but the dir + env var are kept so
# the bind mount in the existing deploy script doesn't fail and the
# path is ready when video comes back.
RUN mkdir -p /home/appuser/videos

COPY --from=builder /app/target/release/portfolio-world-server ./server

ENV VIDEOS_DIR=/home/appuser/videos
ENV PORT=8080
ENV RUST_LOG=info

EXPOSE 8080

# Health check — useful for ECS / ALB target groups if they ever land,
# and provides a cheap "is the binary alive" signal under
# `docker ps --filter health=healthy` for ad-hoc checks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["./server"]
