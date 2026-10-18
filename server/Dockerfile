# diurn-server — multi-stage build (rusqlite is bundled, no system libs needed)
FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
# HOME under the volume → DB at /data/.diurn/data.db, thumbs at /data/thumbs
ENV HOME=/data \
    DIURN_CACHE=/data/thumbs
VOLUME /data
EXPOSE 12321
COPY --from=build /src/target/release/diurn-server /usr/local/bin/diurn-server
ENTRYPOINT ["diurn-server"]
