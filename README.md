# omp-orcarouter

OrcaRouter provider plugin for omp (Oh My Pi). It registers the provider id `orcarouter` against OrcaRouter's OpenAI-compatible API, discovers the live model catalog, and maps context limits, output caps, image input, prices, and reasoning levels into omp model metadata.

## Install

The repository is a one-plugin omp marketplace, so a user needs only `omp`:

```bash
omp plugin marketplace add littlecedar/omp-orcarouter
omp plugin install omp-orcarouter@omp-orcarouter
```

Installing straight from Git skips the marketplace layer (that path also needs `git` on `PATH`):

```bash
omp plugin install github:littlecedar/omp-orcarouter
```

Neither path builds anything: omp imports `src/extension.ts` with its embedded Bun. Restart omp after installing, then authenticate (below).

To pick up later changes, refresh the catalog and reinstall:

```bash
omp plugin marketplace update omp-orcarouter   # marketplace installs
omp plugin upgrade omp-orcarouter@omp-orcarouter
omp plugin upgrade omp-orcarouter              # Git installs
```

For development, link the checkout instead, then restart omp:

```bash
omp plugin link ~/src/omp-orcarouter
```

## Authentication

Use `/login`, select OrcaRouter, and paste the key into the masked prompt. Alternatively, export a key before starting omp:

```bash
export ORCAROUTER_API_KEY=sk-orca-...
```

`ORCA_KEY` is accepted as a fallback. Do not paste keys into chat. A key stored by `/login` outranks an environment variable.

If `~/.omp/agent/models.yml` already defines a `providers.orcarouter` block with `authHeader: true`, remove that block before using `/login`; its fixed `apiKey` can shadow the key the plugin stores. Keeping the old block works only if you keep supplying `ORCA_KEY` and skip `/login`.

For a self-hosted OrcaRouter, set the host only:

```bash
export ORCAROUTER_API_BASE=https://orca.example.com
```

The plugin appends `/v1` unless the value already ends with it. Changing this variable requires an omp restart.

## Select a model

Run `/model` and choose OrcaRouter, or pass a selector:

```bash
omp --model orcarouter/orcarouter/auto
omp -p --model orcarouter/openai/gpt-4o "Reply with OK"
```

OrcaRouter model ids already contain a provider prefix, so selectors double the prefix: `orcarouter/openai/gpt-5.5` selects model `openai/gpt-5.5` from provider `orcarouter`.

## Catalog behavior

The plugin calls `GET /v1/models`. omp caches the result in its SQLite model cache for 24 hours. `/orcarouter-refresh` forces `refreshProvider("orcarouter", "online")` and reports success. Session startup and `omp models` both run discovery, so a fresh cache fills on first use.

Only chat models that expose the `openai` endpoint are registered. TTS, speech, transcription, embedding, image, video, and moderation rows are excluded. `orcarouter/auto` is absent from `/v1/models`; `orcarouter/free` is present with the `openai` endpoint but is skipped because it is already a static alias. The fusion aliases are registered dynamically.

## Costs and reasoning

Costs are USD per million tokens. The plugin converts OrcaRouter's per-token prices, includes cache reads, sets cache writes to 0, and uses the base price tier when OrcaRouter publishes tiers. Router aliases report 0 because OrcaRouter publishes no per-token price for them.

OrcaRouter publishes no reasoning capability flag, so the plugin infers reasoning from the model id. A wrong guess changes the thinking dial and may send `reasoning_effort`. Override it in `models.yml`:

```yaml
providers:
  orcarouter:
    modelOverrides:
      qwen/qwen3-coder-plus:
        reasoning: true
```

## Verification

The dev-time gates run in a dev container, so the host needs no Bun, node, or npm install. The container pins Bun 1.4.3 (matching `packageManager` and CI), and `node_modules` lives in a named Docker volume (`omp-orcarouter-node_modules`), so no dependencies land in the checkout — Docker creates only an empty, gitignored `node_modules/` mountpoint there when the container starts; the workspace itself is bind-mounted, so edits made on the host appear live in the container (`./scripts/dc` runs as the container's uid 1000, which may deny in-container writes to the checkout when the host uid differs).

Build the container once from the repository root; `updateContentCommand` installs the dev-only toolchain into the volume before `up` returns:

```bash
./scripts/dc up
```

Then run the gates:

```bash
./scripts/dc exec bun test
./scripts/dc exec bun run typecheck    # tsc --noEmit against the host's own declarations
./scripts/dc exec bun run lint         # biome check
./scripts/dc exec bun run check        # typecheck + lint together
```

`scripts/dc` runs the official `@devcontainers/cli` in a cached helper image (`.devcontainer/cli.Dockerfile`), so `devcontainer.json` stays the single source of truth and the host needs no node install. VS Code or Cursor users can instead pick "Reopen in Container" and run the same `bun …` commands in the container terminal; it also maps the container user to your UID, so in-container edits and commits work there. After changing `devDependencies`, run `./scripts/dc exec bun install` to refresh `bun.lock` and the volume, then commit `bun.lock`; `updateContentCommand` only runs when the container is created.

Exercise the live public catalog without touching user plugin state or the user model cache:

```bash
ORCAROUTER_API_KEY=sk-orca-verification-dummy \
PI_CODING_AGENT_DIR="$(mktemp -d)" \
omp models orcarouter --json -e ./src/extension.ts --no-extensions
```

The dummy key only satisfies omp's availability check. The public `/v1/models` request carries no credentials, so a stale key cannot break discovery. Live inference needs a real key, for example after `/login`:

```bash
omp -p --model orcarouter/openai/gpt-4o "Reply with OK"
```