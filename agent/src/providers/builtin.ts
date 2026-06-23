import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import type { ModelProvider } from "./registry.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function openaiProvider(): ModelProvider {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the openai provider");
  }
  const openai = createOpenAI({ apiKey });
  return {
    name: "openai",
    model(modelId: string): LanguageModel {
      return openai(modelId);
    },
  };
}

export function anthropicProvider(): ModelProvider {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
  }
  const anthropic = createAnthropic({ apiKey });
  return {
    name: "anthropic",
    model(modelId: string): LanguageModel {
      return anthropic(modelId);
    },
  };
}

export function googleProvider(): ModelProvider {
  const apiKey = env("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is required for the google provider",
    );
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    name: "google",
    model(modelId: string): LanguageModel {
      return google(modelId);
    },
  };
}

/** Register openai, anthropic, and google when their API keys are set. */
export function registerBuiltinProviders(registry: {
  register(p: ModelProvider): unknown;
}): void {
  const tryRegister = (fn: () => ModelProvider) => {
    try {
      registry.register(fn());
    } catch {
      /* key not configured */
    }
  };
  tryRegister(openaiProvider);
  tryRegister(anthropicProvider);
  tryRegister(googleProvider);
}
