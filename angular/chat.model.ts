/**
 * Shared contracts for the ChatArmor Angular widget. Mirrors the backend
 * `ChatArmorReplyInput` / `ChatArmorResult`. There is deliberately NO tenant/id
 * field on the request: the backend derives the tenant from the JWT, never from
 * the body.
 */

/** Request body posted to your ChatArmor endpoint. */
export interface ChatRequest {
  /** The user's question. Length-bounded client-side too. */
  message: string;
  /**
   * Opaque client-generated id for correlating client logs only (optional).
   *
   * ⚠️ It is NOT trusted and NOT used for the spend cap. A client-generated id
   * can be rotated per request, so it can never gate spending. The server meters
   * with a `budgetSubKey` derived from an authenticated identity (JWT `user.id`,
   * hashed IP), NEVER from this field. Do not wire `clientTraceId` into
   * `budgetSubKey`.
   */
  clientTraceId?: string;
  /**
   * Former name of {@link ChatRequest.clientTraceId}, kept so a 0.1.x endpoint
   * that reads `body.sessionId` keeps working. The widget posts both fields with
   * the same value.
   *
   * @deprecated Since 0.2.0, removed in 1.0.0. Read `clientTraceId` instead. The
   * old name suggested a trusted session; this value is client-generated and
   * must never gate spending.
   */
  sessionId?: string;
}

/** Response from your ChatArmor endpoint. Rendered as TEXT, never HTML. */
export interface ChatResponse {
  reply: string;
}

/** Max characters accepted client-side (mirror your server DTO bound). */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

export type ChatRole = 'user' | 'assistant';

/** A single rendered line in the transcript. */
export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
}
