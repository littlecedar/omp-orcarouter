import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	apiBaseV1,
	discoverModels,
	envApiKey,
	PROVIDER_ID,
	STATIC_MODELS,
} from "./catalog.ts";

export default function orcarouterExtension(pi: ExtensionAPI): void {
	const envKey = envApiKey();

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: apiBaseV1(),
		api: "openai-completions",
		...(envKey ? { apiKey: envKey } : {}),
		oauth: {
			name: "OrcaRouter",
			async login(callbacks) {
				const key = (
					await callbacks.onPrompt({
						message: "OrcaRouter API key",
						placeholder: "sk-orca-...",
						secret: true,
					})
				).trim();
				if (!key) throw new Error("OrcaRouter API key cannot be empty");
				return key;
			},
		},
		models: [...STATIC_MODELS],
		fetchDynamicModels: (apiKey) => discoverModels(apiKey),
	});

	pi.registerCommand("orcarouter-refresh", {
		description: "Refresh the OrcaRouter model catalog",
		handler: async (_args, ctx) => {
			await ctx.modelRegistry.refreshProvider(PROVIDER_ID, "online");
			ctx.ui.notify("OrcaRouter model catalog refreshed", "info");
		},
	});
}
