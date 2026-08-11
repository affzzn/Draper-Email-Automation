#!/usr/bin/env bash
# Local dev Postgres for the Draper shadow service.
# A dedicated cluster on port 5544 that you own — no password, no cloud, and it
# won't collide with any other Postgres already running on 5432.
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
[ -d "$PG_BIN" ] || PG_BIN="/usr/local/opt/postgresql@16/bin"
PGDATA="${DRAPER_PGDATA:-$HOME/.draper-shadow-pg}"
PORT=5544
DB=draper_shadow

export PATH="$PG_BIN:$PATH"
export LC_ALL=C LANG=C

case "${1:-}" in
  init)
    if [ -f "$PGDATA/PG_VERSION" ]; then
      echo "Cluster already exists at $PGDATA"
    else
      initdb -D "$PGDATA" -U postgres --auth=trust --locale=C >/dev/null
      echo "Initialised cluster at $PGDATA"
    fi
    ;;
  start)
    [ -f "$PGDATA/PG_VERSION" ] || { echo "No cluster yet — run: npm run db:init"; exit 1; }
    if pg_isready -h localhost -p $PORT -U postgres >/dev/null 2>&1; then
      echo "Already running on port $PORT"
    else
      pg_ctl -D "$PGDATA" -o "-p $PORT" -l "$PGDATA/server.log" start >/dev/null
      for i in $(seq 1 20); do
        pg_isready -h localhost -p $PORT -U postgres >/dev/null 2>&1 && break; sleep 1
      done
      echo "Started on port $PORT"
    fi
    createdb -h localhost -p $PORT -U postgres "$DB" 2>/dev/null && echo "Created database $DB" || true
    ;;
  stop)
    pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 && echo "Stopped" || echo "Not running"
    ;;
  status)
    pg_isready -h localhost -p $PORT -U postgres && echo "data dir: $PGDATA"
    ;;
  *)
    echo "usage: localdb.sh {init|start|stop|status}"; exit 1;;
esac
