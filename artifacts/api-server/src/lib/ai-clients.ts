import OpenAI from "openai";
import { logger } from "./logger";

// Replit-managed OpenAI proxy
if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error("AI_INTEGRATIONS_OPENAI_BASE_URL must be set.");
}
if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY must be set.");
}

export const openaiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// DashScope (Alibaba Cloud) — OpenAI-compatible endpoint
let dashscopeClient: OpenAI | null = null;

if (process.env.DASHSCOPE_API_KEY) {
  dashscopeClient = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });
  logger.info("DashScope client initialized");
} else {
  logger.warn("DASHSCOPE_API_KEY not set — Qwen models unavailable");
}

export { dashscopeClient };

export type ModelProvider = "openai" | "dashscope";

export const AVAILABLE_MODELS = [
  // OpenAI models (via Replit AI Integrations)
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" as ModelProvider, description: "高性能・汎用" },
  { id: "gpt-5.6-luna",  label: "GPT-5.6 Luna",  provider: "openai" as ModelProvider, description: "高速・低コスト" },
  { id: "o4-mini",       label: "o4-mini",        provider: "openai" as ModelProvider, description: "高度な推論" },
  // Qwen models (via DashScope)
  { id: "qwen-max",      label: "Qwen Max",       provider: "dashscope" as ModelProvider, description: "Alibaba最高性能" },
  { id: "qwen-plus",     label: "Qwen Plus",      provider: "dashscope" as ModelProvider, description: "Alibaba高速・バランス" },
  { id: "qwen-turbo",    label: "Qwen Turbo",     provider: "dashscope" as ModelProvider, description: "Alibaba最速" },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]["id"];

export function getClientForModel(modelId: string): { client: OpenAI; provider: ModelProvider } {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!model) {
    // Default to OpenAI
    return { client: openaiClient, provider: "openai" };
  }
  if (model.provider === "dashscope") {
    if (!dashscopeClient) {
      throw new Error("DashScope APIキーが設定されていません。DASHSCOPE_API_KEY を確認してください。");
    }
    return { client: dashscopeClient, provider: "dashscope" };
  }
  return { client: openaiClient, provider: "openai" };
}
