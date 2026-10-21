import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

type ThinkingEfforts = NonNullable<ProviderModelConfig["thinking"]>["efforts"];
// omp declares Effort as an ambient const enum, which cannot be read as a value
// here; at runtime the host compares raw strings, so emit string ids through
// one bridge instead of scattering a cast across each ladder.
const EFFORT_IDS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
const efforts = (
	ids: readonly (typeof EFFORT_IDS)[number][],
): ThinkingEfforts => ids as ThinkingEfforts;

export const PROVIDER_ID = "orcarouter";
export const DEFAULT_API_BASE = "https://api.orcarouter.ai";
export const API_BASE_ENV = "ORCAROUTER_API_BASE";
export const API_KEY_ENV = "ORCAROUTER_API_KEY";
export const LEGACY_API_KEY_ENV = "ORCA_KEY";
export const FETCH_TIMEOUT_MS = 10_000;

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 32_768;

const NON_CHAT_ID =
	/(^|[/_-])(tts|audio|speech|transcri|whisper|embedding|image|imagen|imagine|video|kling|seedance|dub|rerank|moderation)([/_-]|$)/i;

export interface OrcaRouterModel {
	id?: string | null;
	name?: string | null;
	description?: string | null;
	supported_endpoint_types?: string[] | null;
	context_length?: number | null;
	max_completion_tokens?: number | null;
	architecture?: {
		input_modalities?: string[] | null;
	} | null;
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	} | null;
	pricing?: {
		prompt?: string | number | null;
		completion?: string | number | null;
		prompt_per_million?: string | number | null;
		completion_per_million?: string | number | null;
		input_cache_read?: string | number | null;
	} | null;
}

interface ModelsResponse {
	data?: OrcaRouterModel[] | null;
}

export function apiBaseV1(): string {
	const raw = process.env[API_BASE_ENV]?.trim() || DEFAULT_API_BASE;
	const base = raw.replace(/\/+$/, "");
	return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function envApiKey(): string | undefined {
	return (
		process.env[API_KEY_ENV]?.trim() ||
		process.env[LEGACY_API_KEY_ENV]?.trim() ||
		undefined
	);
}

export function isChatModel(
	model: OrcaRouterModel,
): model is OrcaRouterModel & { id: string } {
	const id = model.id?.trim();
	if (!id || model.supported_endpoint_types?.includes("openai") !== true) {
		return false;
	}
	return !NON_CHAT_ID.test(id);
}

export function isReasoningModel(id: string): boolean {
	const lower = id.toLowerCase();
	if (lower.includes("qwen3.") || lower.includes("qwen3-max")) {
		return !lower.includes("instruct");
	}
	return (
		lower.includes("claude") ||
		/(^|\/)o[1-9](-|$)/.test(lower) ||
		lower.includes("gpt-5") ||
		lower.includes("gpt-6") ||
		lower.includes("gpt-oss") ||
		lower.includes("gemini-2.5") ||
		lower.includes("gemini-3") ||
		lower.includes("gemini-4") ||
		lower.includes("gemini-5") ||
		lower.includes("grok-3") ||
		lower.includes("grok-4") ||
		lower.includes("deepseek-r") ||
		lower.includes("deepseek-v3") ||
		lower.includes("deepseek-v4") ||
		lower.includes("qwq") ||
		lower.includes("thinking") ||
		lower.includes("reasoner") ||
		lower.includes("minimax") ||
		lower.includes("glm-4.5") ||
		lower.includes("glm-4.6") ||
		lower.includes("glm-4.7") ||
		lower.includes("glm-5") ||
		lower.includes("kimi") ||
		lower.includes("fusion") ||
		lower.includes("muse-spark")
	);
}

export function isOpenAIReasoningId(id: string): boolean {
	const lower = id.toLowerCase();
	return /(^|\/)(o[1-9]|gpt-5|gpt-6)/.test(lower) || lower.includes("gpt-oss");
}

export function thinkingFor(
	id: string,
	reasoning: boolean,
): NonNullable<ProviderModelConfig["thinking"]> | undefined {
	if (!reasoning) return undefined;
	const lower = id.toLowerCase();
	if (lower.includes("gpt-oss")) {
		return {
			mode: "effort",
			efforts: efforts(["low", "medium", "high"]),
			requiresEffort: true,
		};
	}
	if (isOpenAIReasoningId(id)) {
		return {
			mode: "effort",
			efforts: efforts(["minimal", "low", "medium", "high"]),
			effortMap: { minimal: "low" },
			requiresEffort: true,
		};
	}
	return {
		mode: "effort",
		efforts: efforts(["low", "medium", "high", "xhigh"]),
		effortMap: { xhigh: "max" },
	};
}

function toRate(
	value: string | number | null | undefined,
	multiplier = 1,
): number {
	if (value === null || value === undefined) return 0;
	const parsed = typeof value === "number" ? value : Number.parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	// Multiply first, then drop binary-float dust (0.0000002 * 1e6 === 0.19999999999999998).
	return Math.round(parsed * multiplier * 1e12) / 1e12;
}

export function buildCost(
	pricing: OrcaRouterModel["pricing"],
): ProviderModelConfig["cost"] {
	const input =
		pricing?.prompt_per_million !== null &&
		pricing?.prompt_per_million !== undefined
			? toRate(pricing.prompt_per_million)
			: toRate(pricing?.prompt, 1_000_000);
	const output =
		pricing?.completion_per_million !== null &&
		pricing?.completion_per_million !== undefined
			? toRate(pricing.completion_per_million)
			: toRate(pricing?.completion, 1_000_000);
	return {
		input,
		output,
		cacheRead: toRate(pricing?.input_cache_read, 1_000_000),
		cacheWrite: 0,
	};
}

function firstPositive(
	...values: Array<number | null | undefined>
): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return undefined;
}

function inputModalities(model: OrcaRouterModel): Array<"text" | "image"> {
	const input: Array<"text" | "image"> = ["text"];
	if (model.architecture?.input_modalities?.includes("image")) {
		input.push("image");
	}
	return input;
}

export const STATIC_MODELS: readonly ProviderModelConfig[] = [
	{
		id: "orcarouter/auto",
		name: "OrcaRouter Auto",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_768,
		compat: { supportsStrictMode: false },
	},
	{
		id: "orcarouter/free",
		name: "OrcaRouter Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_768,
		compat: { supportsStrictMode: false },
	},
];

export function assembleModels(
	raw: readonly OrcaRouterModel[],
): ProviderModelConfig[] {
	const staticIds = new Set(STATIC_MODELS.map((model) => model.id));
	return raw
		.filter(isChatModel)
		.filter((model) => !staticIds.has(model.id))
		.map((model) => {
			const id = model.id;
			const reasoning = isReasoningModel(id);
			const thinking = thinkingFor(id, reasoning);
			const contextWindow =
				firstPositive(
					model.context_length,
					model.top_provider?.context_length,
				) ?? DEFAULT_CONTEXT_WINDOW;
			const maxTokens = Math.min(
				firstPositive(
					model.max_completion_tokens,
					model.top_provider?.max_completion_tokens,
				) ?? DEFAULT_MAX_TOKENS,
				contextWindow,
			);
			return {
				id,
				name: model.name?.trim() || id,
				reasoning,
				...(thinking ? { thinking } : {}),
				input: inputModalities(model),
				cost: buildCost(model.pricing),
				contextWindow,
				maxTokens,
				compat: {
					supportsStrictMode: false,
					supportsReasoningEffort: reasoning,
					...(isOpenAIReasoningId(id)
						? {
								supportsSamplingParams: false,
								supportsPenaltyAndStopParams: false,
							}
						: {}),
				},
			};
		});
}

export async function fetchModelCatalog(
	_apiKey: string | undefined,
	fetchImpl: typeof fetch = fetch,
): Promise<OrcaRouterModel[]> {
	// /v1/models is public, and OrcaRouter rejects a stale bearer with HTTP 401.
	const response = await fetchImpl(`${apiBaseV1()}/models`, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`OrcaRouter model discovery failed: HTTP ${response.status}`,
		);
	}
	const body = (await response.json()) as ModelsResponse | null;
	const rows = Array.isArray(body?.data) ? body.data : [];
	return rows.filter(
		(model): model is OrcaRouterModel & { id: string } =>
			typeof model?.id === "string" && model.id.trim().length > 0,
	);
}

export async function discoverModels(
	apiKey: string | undefined,
	fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelConfig[]> {
	const models = assembleModels(await fetchModelCatalog(apiKey, fetchImpl));
	if (models.length === 0) {
		throw new Error("OrcaRouter returned no chat-capable models");
	}
	return models;
}
