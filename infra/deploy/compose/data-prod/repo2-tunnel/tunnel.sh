#!/bin/sh
# DS Platform data-prod — repo2's way to IDrive e2 (#4287). IDrive drops RU source
# addresses and ds-data-prod egresses through the VPC router's RU NAT, so repo2's
# traffic leaves through an SSH local forward to the relay host (hermes, outside RU),
# whose key line allows this key one forward only, to the IDrive endpoint by NAME.
#
# The compose service `repo2-tunnel` runs this as PID 1's child (init: true) and carries
# the network alias s3.ap-southeast-2.idrivee2.com on the compose network it shares with
# the pgbackrest sidecar alone, the one container that talks to an offsite repo (#4298:
# PostgreSQL archives to repo1 only; the sidecar's WAL pusher and offsite backups run
# under pgbackrest-repo.sh 2). Its pgBackRest resolves the endpoint to this container,
# connects to 443 here, and the TLS session (SNI, certificate, verify-tls) runs end to
# end with IDrive through the forward. The service publishes no port and is on no host
# network: the forward is open to the sidecar only.
#
# The loop keeps the container (and so the alias) up while ssh reconnects: a client
# connecting between sessions is refused at once by this container instead of
# resolving the name past the alias to IDrive's own address and waiting for a dropped
# SYN. A crash of the container itself is Docker's restart policy's.
set -u
key=/run/repo2-tunnel/id_ed25519
conf=/etc/repo2-tunnel
target=s3.ap-southeast-2.idrivee2.com:443
relay=deploy@94.198.221.20
while :; do
  # -F /dev/null: no ssh_config; the relay's host key is the committed known_hosts
  # only (never trust on first use). ExitOnForwardFailure: no session without the
  # listener; ServerAlive: a dead relay ends the session within 45 s.
  ssh -N -F /dev/null -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$conf/known_hosts" -o GlobalKnownHostsFile=/dev/null \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=20 \
    -o GatewayPorts=yes -L "0.0.0.0:443:$target" "$relay"
  echo "repo2-tunnel: ssh exited $?; reconnecting in 10 s" >&2
  sleep 10
done
