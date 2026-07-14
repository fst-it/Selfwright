#!/bin/bash
# Creates the dedicated Metabase application database inside the selfwright Postgres instance.
# Metabase must use a SEPARATE database (not the selfwright db) per the AGPL arm's-length rule
# (anchor §8, ADR D18): Metabase is never linked into core; its state lives in isolation here.
#
# NOTE: /docker-entrypoint-initdb.d/ scripts only run on FIRST volume initialisation.
# If your postgres_data volume already exists, create the database manually:
#   docker exec -it selfwright-postgres-1 createdb -U selfwright metabase
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE metabase' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metabase')\gexec
EOSQL
