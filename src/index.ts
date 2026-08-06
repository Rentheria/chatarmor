export { ChatArmorModule } from './chat-armor.module';
export {
  ChatArmorService,
  resolveConfig,
  type ResolvedChatArmorConfig,
} from './chat-armor.service';
export {
  CHAT_ARMOR_OPTIONS,
  LLM_PROVIDER,
  getChatArmorToken,
  DEFAULT_GUARDRAIL,
  DEFAULT_FALLBACK_REPLY,
} from './chat-armor.constants';
export { composeSystemPrompt } from './prompt-guard';
export { createProvider } from './provider-factory';
export { buildBudgetCap } from './budget';
export { GeminiProvider } from './providers/gemini.provider';
export type { GeminiProviderConfig } from './providers/gemini.provider';
export { OpenAiProvider } from './providers/openai.provider';
export type { OpenAiProviderConfig } from './providers/openai.provider';
export type {
  ChatArmorModuleOptions,
  ChatArmorModuleAsyncOptions,
  ChatArmorFeatureOptions,
  ChatArmorBudgetOptions,
  ChatArmorReplyInput,
  ChatArmorReplyOptions,
  ChatArmorResult,
  ChatArmorReason,
  LlmProvider,
  LlmProviderName,
} from './chat-armor.types';
