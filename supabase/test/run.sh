#!/bin/bash
# Rebuild the island database from the migrations and run the suite over it.
#
# From scratch every time, deliberately: the thing being tested is as much the
# migrations as the rules, and a migration that only works against a database
# that already had the last version of it is a migration that will not run on
# the project.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PGH=${PGH:-/var/run/postgresql}
PSQL="psql -h $PGH -p 5433 -U wurm -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "set client_min_messages = warning; drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" > /dev/null 2>&1
$PSQL -f "$HERE/../local/00_shim.sql" > /dev/null
for m in "$HERE"/../migrations/*.sql; do $PSQL -f "$m" > /dev/null 2>&1 || { echo "FAILED: $m"; $PSQL -f "$m"; exit 1; }; done
psql -h $PGH -p 5433 -U wurm -d postgres -v ON_ERROR_STOP=1 -X -q -f "$HERE/island.sql"
