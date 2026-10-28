# Bun 1.4.3 matches packageManager and CI; the base image ships the non-root
# `bun` user (uid/gid 1000) that devcontainer.json runs as.
FROM oven/bun:1.4.3

# In-container git for the editor Source Control view and git commands in the
# gates' shell. Nothing here needs sudo, so none is installed.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

# Docker seeds an empty named volume from the image, ownership included. Creating
# node_modules at the default workspace mountpoint as bun avoids a runtime chown.
# The basename comes from devcontainer.json build.args and matches the CLI's
# default mount path (/workspaces/<workspace folder basename>).
ARG WORKSPACE_BASENAME=omp-orcarouter
RUN mkdir -p "/workspaces/${WORKSPACE_BASENAME}/node_modules" \
	&& chown -R bun:bun /workspaces

WORKDIR /workspaces/${WORKSPACE_BASENAME}
USER bun
