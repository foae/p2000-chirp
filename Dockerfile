FROM oven/bun:1.3-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Persist dedupe state across restarts: mount a volume at /app/state
# (the default state_file is state/state.json). Mount your own
# config.toml at /app/config.toml and pass secrets via env.
RUN mkdir -p /app/state && chown -R bun:bun /app/state
VOLUME ["/app/state"]
USER bun

CMD ["bun", "run", "src/index.ts"]
