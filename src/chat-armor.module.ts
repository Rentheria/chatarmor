import {
  Module,
  type DynamicModule,
  type InjectionToken,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';

import {
  CHAT_ARMOR_OPTIONS,
  LLM_PROVIDER,
  getChatArmorToken,
} from './chat-armor.constants';
import { ChatArmorService, resolveConfig } from './chat-armor.service';
import type {
  ChatArmorFeatureOptions,
  ChatArmorModuleAsyncOptions,
  ChatArmorModuleOptions,
  LlmProvider,
} from './chat-armor.types';
import { buildBudgetCap } from './budget';
import { createProvider } from './provider-factory';

/**
 * ChatArmor — a reusable NestJS module for a production-ready AI chat endpoint.
 *
 * - `forRoot` / `forRootAsync`: configure the provider (Gemini/OpenAI/custom),
 *   the transport (timeout, temperature…), the guardrail and an optional root
 *   spend cap once for the app. Registers a default {@link ChatArmorService}.
 * - `forFeature`: register a named bot (its own system prompt / fallback /
 *   spend cap), injected via `getChatArmorToken(name)`. This is how the three
 *   real chatbots this was extracted from coexist (e.g. a public "landing" bot
 *   with a global cap and an authenticated "organizer" bot with a per-user cap).
 *
 * `forRoot` registers globally by default so `forFeature` in any module can
 * resolve the shared provider/options.
 */
@Module({})
export class ChatArmorModule {
  static forRoot(options: ChatArmorModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: CHAT_ARMOR_OPTIONS,
      useValue: options,
    };
    return this.assemble(options.global ?? true, [optionsProvider]);
  }

  static forRootAsync(options: ChatArmorModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: CHAT_ARMOR_OPTIONS,
      useFactory: options.useFactory,
      inject: (options.inject ?? []) as Array<
        InjectionToken | OptionalFactoryDependency
      >,
    };
    const module = this.assemble(options.global ?? true, [optionsProvider]);
    return { ...module, imports: (options.imports ?? []) as DynamicModule[] };
  }

  /**
   * Register a named chat bot. Requires `forRoot`/`forRootAsync` to have run
   * (it reuses the shared provider + root options). Inject the instance with
   * `@Inject(getChatArmorToken(name))`.
   */
  static forFeature(feature: ChatArmorFeatureOptions): DynamicModule {
    const token = getChatArmorToken(feature.name);
    const featureProvider: Provider = {
      provide: token,
      useFactory: (
        rootOptions: ChatArmorModuleOptions,
        provider: LlmProvider,
      ): ChatArmorService =>
        new ChatArmorService(
          provider,
          resolveConfig({
            guardrail: feature.guardrail ?? rootOptions.guardrail,
            fallbackReply: feature.fallbackReply ?? rootOptions.fallbackReply,
            maxMessageLength: rootOptions.maxMessageLength,
            defaultSystemPrompt: feature.systemPrompt,
          }),
          buildBudgetCap(feature.budget ?? rootOptions.budget),
        ),
      inject: [CHAT_ARMOR_OPTIONS, LLM_PROVIDER],
    };
    return {
      module: ChatArmorModule,
      providers: [featureProvider],
      exports: [featureProvider],
    };
  }

  /** Shared wiring for `forRoot` / `forRootAsync`. */
  private static assemble(
    global: boolean,
    optionsProviders: Provider[],
  ): DynamicModule {
    const providerProvider: Provider = {
      provide: LLM_PROVIDER,
      useFactory: (options: ChatArmorModuleOptions): LlmProvider =>
        createProvider(options),
      inject: [CHAT_ARMOR_OPTIONS],
    };
    const rootService: Provider = {
      provide: ChatArmorService,
      useFactory: (
        options: ChatArmorModuleOptions,
        provider: LlmProvider,
      ): ChatArmorService =>
        new ChatArmorService(
          provider,
          resolveConfig({
            guardrail: options.guardrail,
            fallbackReply: options.fallbackReply,
            maxMessageLength: options.maxMessageLength,
          }),
          buildBudgetCap(options.budget),
        ),
      inject: [CHAT_ARMOR_OPTIONS, LLM_PROVIDER],
    };
    return {
      module: ChatArmorModule,
      global,
      providers: [...optionsProviders, providerProvider, rootService],
      exports: [ChatArmorService, LLM_PROVIDER, CHAT_ARMOR_OPTIONS],
    };
  }
}
