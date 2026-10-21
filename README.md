# omp-orcarouter

OrcaRouter provider plugin for omp (Oh My Pi). It registers the provider id `orcarouter` against OrcaRouter's OpenAI-compatible API, discovers the live model catalog, and maps context limits, output caps, image input, prices, and reasoning levels into omp model metadata.

## Install

For development, link the checkout and restart omp:

```bash
omp plugin link ~/src/omp-orcarouter
```

`omp plugin install ~/src/omp-orcarouter` also works and routes a local path to a link.

The plugin has no build step. omp loads `src/extension.ts` with its embedded Bun.

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

Install the dev-only toolchain once, then run the gates from the repository root:

```bash
BUN_BE_BUN=1 omp install          # devDependencies only; the plugin still ships as source
BUN_BE_BUN=1 omp test
BUN_BE_BUN=1 omp run typecheck    # tsc --noEmit against the host's own declarations
BUN_BE_BUN=1 omp run lint         # biome check
```

`BUN_BE_BUN=1 omp run check` runs the typecheck and lint together.

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