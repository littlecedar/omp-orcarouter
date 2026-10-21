import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@oh-my-pi/pi-coding-agent";
import {
	API_BASE_ENV,
	API_KEY_ENV,
	assembleModels,
	discoverModels,
	fetchModelCatalog,
	LEGACY_API_KEY_ENV,
	type OrcaRouterModel,
} from "../src/catalog.ts";
import orcarouterExtension from "../src/extension.ts";

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(
	payload: unknown,
	calls: FetchCall[] = [],
	status = 200,
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

function row(
	overrides: Partial<OrcaRouterModel> & { id: string },
): OrcaRouterModel {
	return {
		supported_endpoint_types: ["openai"],
		...overrides,
	};
}

// compat is the whole host union and cannot be indexed by a dynamic key, so
// guard presence with `in` and read through Reflect.get (no cast).
function compatValue(model: ProviderModelConfig, key: string): unknown {
	const compat = model.compat;
	if (!compat || !(key in compat)) return undefined;
	return Reflect.get(compat, key);
}

describe("catalog", () => {
	test("maps rich metadata, per-token pricing, image input, and thinking", () => {
		const [model] = assembleModels([
			row({
				id: "anthropic/claude-sonnet-5",
				name: "Claude Sonnet 5",
				supported_endpoint_types: ["openai", "anthropic"],
				context_length: 1_000_000,
				max_completion_tokens: 128_000,
				architecture: { input_modalities: ["text", "image"] },
				pricing: {
					prompt: "0.000002",
					completion: "0.00001",
					input_cache_read: "0.0000002",
				},
			}),
		]);

		expect(model.cost).toEqual({
			input: 2,
			output: 10,
			cacheRead: 0.2,
			cacheWrite: 0,
		});
		expect(model.input).toEqual(["text", "image"]);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(128_000);
	});

	test("drops non-chat ids even when they expose the openai endpoint", () => {
		const models = assembleModels([
			row({ id: "openai/tts-1" }),
			row({
				id: "openai/gpt-image-1",
				supported_endpoint_types: ["image-generation"],
			}),
			row({ id: "openai/gpt-image-2.5-flare" }),
			row({
				id: "google/gemini-2.5-flash-image",
				supported_endpoint_types: ["gemini"],
			}),
			row({ id: "kling/kling-v3", supported_endpoint_types: ["openai-video"] }),
		]);

		expect(models).toEqual([]);
	});

	test("falls back to default limits and zero costs, and clamps output to context", () => {
		const [basic, clamped, providerLimits] = assembleModels([
			row({ id: "vendor/basic-chat" }),
			row({
				id: "vendor/small-context",
				context_length: 8_000,
				max_completion_tokens: 32_000,
			}),
			row({
				id: "vendor/provider-limits",
				top_provider: {
					context_length: 64_000,
					max_completion_tokens: 16_000,
				},
			}),
		]);

		expect(basic.name).toBe("vendor/basic-chat");
		expect(basic.contextWindow).toBe(128_000);
		expect(basic.maxTokens).toBe(32_768);
		expect(basic.cost).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(basic.input).toEqual(["text"]);
		expect(basic.reasoning).toBe(false);
		expect(basic.thinking).toBeUndefined();
		expect(clamped.maxTokens).toBe(8_000);
		expect(providerLimits.contextWindow).toBe(64_000);
		expect(providerLimits.maxTokens).toBe(16_000);
	});

	test("derives reasoning and compat from model ids", () => {
		const [plain, openaiReasoning, claude] = assembleModels([
			row({ id: "openai/gpt-4o" }),
			row({ id: "openai/gpt-5.5" }),
			row({ id: "anthropic/claude-sonnet-5" }),
		]);

		expect(plain.reasoning).toBe(false);
		expect(plain.thinking).toBeUndefined();
		expect(compatValue(plain, "supportsReasoningEffort")).toBe(false);

		expect(openaiReasoning.reasoning).toBe(true);
		expect(openaiReasoning.thinking?.requiresEffort).toBe(true);
		expect(openaiReasoning.thinking?.efforts.join(",")).toBe(
			"minimal,low,medium,high",
		);
		expect(compatValue(openaiReasoning, "supportsSamplingParams")).toBe(false);
		expect(compatValue(openaiReasoning, "supportsPenaltyAndStopParams")).toBe(
			false,
		);

		expect(claude.thinking?.efforts.join(",")).toBe("low,medium,high,xhigh");
		expect(claude.thinking?.effortMap?.xhigh).toBe("max");
	});

	test("does not duplicate static router ids", () => {
		expect(
			assembleModels([
				row({ id: "orcarouter/auto" }),
				row({ id: "orcarouter/free" }),
			]),
		).toEqual([]);
	});

	test("prefers published per-million prices over per-token prices", () => {
		const [model] = assembleModels([
			row({
				id: "vendor/tiered-chat",
				pricing: {
					prompt: "0.000001",
					completion: "0.000002",
					prompt_per_million: "1.25",
					completion_per_million: "3.5",
					input_cache_read: "0.0000001",
				},
			}),
		]);

		expect(model.cost).toEqual({
			input: 1.25,
			output: 3.5,
			cacheRead: 0.1,
			cacheWrite: 0,
		});
	});

	test("gives gpt-oss its own effort ladder and openai reasoning compat", () => {
		const [model] = assembleModels([row({ id: "openai/gpt-oss-120b" })]);

		expect(model.reasoning).toBe(true);
		expect({
			mode: model.thinking?.mode,
			efforts: model.thinking?.efforts.join(","),
			requiresEffort: model.thinking?.requiresEffort,
		}).toEqual({
			mode: "effort",
			efforts: "low,medium,high",
			requiresEffort: true,
		});
		expect(compatValue(model, "supportsSamplingParams")).toBe(false);
		expect(compatValue(model, "supportsPenaltyAndStopParams")).toBe(false);
	});

	test("keeps qwen3 instruct ids non-reasoning", () => {
		const [base, instruct, coder] = assembleModels([
			row({ id: "qwen/qwen3.6-max" }),
			row({ id: "qwen/qwen3.6-instruct" }),
			row({ id: "qwen/qwen3-coder-plus" }),
		]);

		expect(base.reasoning).toBe(true);
		expect(instruct.reasoning).toBe(false);
		expect(coder.reasoning).toBe(false);
	});

	test("requires the openai endpoint type even for chat-looking ids", () => {
		expect(
			assembleModels([
				row({
					id: "vendor/chat-only",
					supported_endpoint_types: ["anthropic"],
				}),
				row({ id: "vendor/no-endpoints", supported_endpoint_types: null }),
			]),
		).toEqual([]);
	});

	test("bounds the catalog request with an abort signal", async () => {
		const calls: FetchCall[] = [];
		await fetchModelCatalog(undefined, fakeFetch({ data: [] }, calls));

		expect(calls).toHaveLength(1);
		expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
	});

	test("fetch keeps the public catalog request credential-free", async () => {
		const calls: FetchCall[] = [];
		await fetchModelCatalog(
			"test-key",
			fakeFetch({ data: [row({ id: "openai/gpt-4o" })] }, calls),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].url.endsWith("/v1/models")).toBe(true);
		expect(new Headers(calls[0].init.headers).get("authorization")).toBeNull();

		const anonymousCalls: FetchCall[] = [];
		await fetchModelCatalog(
			undefined,
			fakeFetch({ data: [row({ id: "openai/gpt-4o" })] }, anonymousCalls),
		);
		expect(
			new Headers(anonymousCalls[0].init.headers).get("authorization"),
		).toBeNull();
	});

	test("fetch rejects non-2xx and drops malformed rows", async () => {
		await expect(
			fetchModelCatalog(undefined, fakeFetch({ data: [] }, [], 503)),
		).rejects.toThrow("HTTP 503");

		const models = await fetchModelCatalog(
			undefined,
			fakeFetch({
				data: [
					{ id: "openai/gpt-4o" },
					{ id: "" },
					{ id: 42 },
					{ name: "missing id" },
				],
			}),
		);
		expect(models.map((model) => model.id)).toEqual(["openai/gpt-4o"]);
	});

	test("discovery fails instead of returning an empty catalog", async () => {
		await expect(
			discoverModels(
				undefined,
				fakeFetch({ data: [row({ id: "openai/tts-1" })] }),
			),
		).rejects.toThrow("no chat-capable models");
	});
});

type ProviderRegistration = {
	name: string;
	config: Parameters<ExtensionAPI["registerProvider"]>[1];
};

type CommandRegistration = {
	name: string;
	definition: Parameters<ExtensionAPI["registerCommand"]>[1];
};

function loadExtension(): {
	provider: ProviderRegistration;
	command: CommandRegistration;
} {
	let provider: ProviderRegistration | undefined;
	let command: CommandRegistration | undefined;
	const pi = {
		registerProvider(name: string, config: ProviderRegistration["config"]) {
			provider = { name, config };
		},
		registerCommand(
			name: string,
			definition: CommandRegistration["definition"],
		) {
			command = { name, definition };
		},
	} as unknown as ExtensionAPI;

	orcarouterExtension(pi);
	if (!provider || !command) throw new Error("extension did not register");
	return { provider, command };
}

describe("extension", () => {
	const envKeys = [API_BASE_ENV, API_KEY_ENV, LEGACY_API_KEY_ENV] as const;
	const original = new Map(envKeys.map((key) => [key, process.env[key]]));

	beforeEach(() => {
		for (const key of envKeys) delete process.env[key];
	});

	afterEach(() => {
		for (const key of envKeys) {
			const value = original.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	test("registers the provider, static models, discovery, and refresh command", () => {
		const { provider, command } = loadExtension();

		expect(provider.name).toBe("orcarouter");
		expect(provider.config.baseUrl).toBe("https://api.orcarouter.ai/v1");
		expect(provider.config.api).toBe("openai-completions");
		expect(provider.config.models?.map((model) => model.id)).toEqual([
			"orcarouter/auto",
			"orcarouter/free",
		]);
		expect(typeof provider.config.fetchDynamicModels).toBe("function");
		expect(command.name).toBe("orcarouter-refresh");
	});

	test("honors ORCAROUTER_API_BASE without doubling /v1", () => {
		process.env[API_BASE_ENV] = "https://orca.example.test/";
		expect(loadExtension().provider.config.baseUrl).toBe(
			"https://orca.example.test/v1",
		);

		process.env[API_BASE_ENV] = "https://orca.example.test/v1/";
		expect(loadExtension().provider.config.baseUrl).toBe(
			"https://orca.example.test/v1",
		);
	});

	test("passes the env key or legacy fallback and omits apiKey when unset", () => {
		expect(loadExtension().provider.config.apiKey).toBeUndefined();

		process.env[API_KEY_ENV] = "primary-key";
		expect(loadExtension().provider.config.apiKey).toBe("primary-key");

		delete process.env[API_KEY_ENV];
		process.env[LEGACY_API_KEY_ENV] = "legacy-key";
		expect(loadExtension().provider.config.apiKey).toBe("legacy-key");
	});

	test("login prompts secretly and trims the returned key", async () => {
		const { provider } = loadExtension();
		const prompts: Array<Record<string, unknown>> = [];
		const login = provider.config.oauth?.login;
		expect(login).toBeDefined();

		const key = await login?.({
			onPrompt: async (prompt: Record<string, unknown>) => {
				prompts.push(prompt);
				return "  sk-live-key  ";
			},
		} as never);

		expect(key).toBe("sk-live-key");
		expect(prompts).toHaveLength(1);
		expect(prompts[0].secret).toBe(true);

		await expect(
			login?.({
				onPrompt: async () => "   ",
			} as never),
		).rejects.toThrow("cannot be empty");
	});

	test("refresh command forces an online provider refresh and notifies", async () => {
		const { command } = loadExtension();
		const refreshes: unknown[][] = [];
		const notifications: unknown[][] = [];

		await command.definition.handler("", {
			modelRegistry: {
				refreshProvider: async (...args: unknown[]) => {
					refreshes.push(args);
				},
			},
			ui: {
				notify: (...args: unknown[]) => {
					notifications.push(args);
				},
			},
		} as never);

		expect(refreshes).toEqual([["orcarouter", "online"]]);
		expect(notifications).toHaveLength(1);
	});
});
