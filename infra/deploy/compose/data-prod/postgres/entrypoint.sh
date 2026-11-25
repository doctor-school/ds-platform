#!/bin/sh
# DS Platform data-prod — postgres container entrypoint (#3670). archive_command runs
# pgbackrest in this container, so the offsite include it reads is derived here from
# the container env before the image's own entrypoint starts the server. A failure
# stops the start: a server must not archive under an include that did not follow env.
set -eu
"${0%/*}/pgbackrest-offsite.sh"
exec docker-entrypoint.sh "$@"
