# Helper image for scripts/dc: the official devcontainer CLI, pinned to the
# version the repo's gates were verified against. Not used by devcontainer.json.
FROM node:22-bookworm-slim
RUN npm install -g @devcontainers/cli@0.89.0