# Nightly copies of the live island

One folder a day, the newest five kept, written by `.github/workflows/backup.yml`
on `main`. This branch is rewritten every night to a single commit, so an older
copy is not in its history.

Each folder holds one encrypted archive in pieces (`island.tar.zst.gpg.000`, `.001`,
...) and their checksums. Inside are `roles.sql`, `schema.sql` and `data.sql`, as
`supabase db dump` writes them.

## Opening a copy

The password is the database password (`SUPABASE_DB_PASSWORD`) as it was on the night
the copy was taken.

    cd 2026-10-09                       # the day wanted
    sha256sum -c SHA256SUMS
    cat island.tar.zst.gpg.* | gpg -d | zstd -d | tar -xf -

## Restoring it into a project

Into an empty project, with its connection string in `$DB_URL`:

    psql --single-transaction --variable ON_ERROR_STOP=1 \
         --file roles.sql --file schema.sql \
         --command 'SET session_replication_role = replica' \
         --file data.sql --dbname "$DB_URL"

`session_replication_role = replica` keeps triggers from firing while the rows go
back in.
