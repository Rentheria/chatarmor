import { DEFAULT_GUARDRAIL } from './chat-armor.constants';

/**
 * Compose the final system instruction from the caller's trusted grounding
 * prompt and the anti-prompt-injection guardrail.
 *
 * This function NEVER receives or touches the user message — that is the whole
 * point. The untrusted user text is delivered to the model in a separate `user`
 * turn (see the providers), so it can never be mistaken for a system
 * instruction. The guardrail below is defense-in-depth for the case where the
 * model still tries to follow an in-message "ignore your rules" attack.
 *
 * @param systemPrompt Trusted grounding written by the app author.
 * @param guardrail `true` → append the built-in guardrail; a string → append
 *   that custom guardrail; `false` → append nothing.
 */
export function composeSystemPrompt(
  systemPrompt: string,
  guardrail: boolean | string,
): string {
  if (guardrail === false) {
    return systemPrompt;
  }
  const guard = typeof guardrail === 'string' ? guardrail : DEFAULT_GUARDRAIL;
  return `${systemPrompt}\n\n${guard}`;
}
