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

export function ollamaProvider(): ModelProvider {
  // Ollama serves an OpenAI-compatible API. Default to the local daemon; the
  // key is unused by Ollama but the OpenAI client requires a non-empty value.
  const ollama = createOpenAI({
    baseURL: env("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1",
    apiKey: env("OLLAMA_API_KEY") ?? "ollama",
  });
  return {
    name: "ollama",
    model(modelId: string): LanguageModel {
      // .chat() forces the Chat Completions API; Ollama does not implement
      // OpenAI's Responses API, which createOpenAI() would otherwise default to.
      return ollama.chat(modelId);
    },
  };
}

export function llamacppProvider(): ModelProvider {
  // llama.cpp's llama-server exposes an OpenAI-compatible API at
  // /v1/chat/completions. It serves whichever model was loaded with `-m`, so
  // the model id is a free-form label. The OpenAI client requires a non-empty
  // key even though llama-server ignores it unless started with --api-key.
  const llamacpp = createOpenAI({
    baseURL: env("LLAMACPP_BASE_URL") ?? "http://localhost:8080/v1",
    apiKey: env("LLAMACPP_API_KEY") ?? "llama.cpp",
  });
  return {
    name: "llamacpp",
    model(modelId: string): LanguageModel {
      // .chat() forces the Chat Completions API; llama-server does not
      // implement OpenAI's Responses API, which createOpenAI() would default to.
      return llamacpp.chat(modelId);
    },
  };
}

/**
 * Register providers whose configuration is present: openai/anthropic/google
 * when their API keys are set, and local ollama/llamacpp always (no API key).
 */
export function registerBuiltinProviders(registry: {
  register(p: ModelProvider): unknown;
}): void {
  const tryRegister = (fn: () => ModelProvider) => {
    try {
      registry.register(fn());
    } catch {
      /* provider not configured */
    }
  };
  tryRegister(openaiProvider);
  tryRegister(anthropicProvider);
  tryRegister(googleProvider);
  tryRegister(ollamaProvider);
  tryRegister(llamacppProvider);
}
