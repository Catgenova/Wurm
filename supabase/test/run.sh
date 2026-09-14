#!/bin/bash
# Rebuild the island database from the migrations and run the suite over it.
#
# From scratch every time, deliberately: the thing being tested is as much the
# migrations as the rules, and a migration that only works against a database
# that already had the last version of it is a migration that will not run on
# the project.
#
# Talks to whatever Postgres the environment points at — a socket locally, a
# service container in CI — so the same script is the same test in both.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PGHOST=${PGHOST:-/var/run/postgresql}
PGPORT=${PGPORT:-5433}
PGUSER=${PGUSER:-wurm}
PGDATABASE=${PGDATABASE:-postgres}
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -c "set client_min_messages = warning; drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" > /dev/null 2>&1
$PSQL -f "$HERE/../local/00_shim.sql" > /dev/null
for m in "$HERE"/../migrations/*.sql; do $PSQL -f "$m" > /dev/null 2>&1 || { echo "FAILED: $m"; $PSQL -f "$m"; exit 1; }; done
psql -v ON_ERROR_STOP=1 -X -q -f "$HERE/island.sql"
