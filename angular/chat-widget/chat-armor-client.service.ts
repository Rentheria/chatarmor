import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ChatRequest, ChatResponse } from '../chat.model';

/**
 * Thin producer for your ChatArmor backend endpoint. The endpoint is grounded +
 * armored server-side (key never here, spend cap + anti-injection on the
 * server), so the client only posts `{ message, clientTraceId }`. The
 * `clientTraceId` is an untrusted correlation id — the server derives the
 * spend-cap subKey from an authenticated identity, never from the body. Point
 * `endpoint` at your route (e.g. `/api/public/chat`).
 */
@Injectable({ providedIn: 'root' })
export class ChatArmorClientService {
  private readonly http = inject(HttpClient);

  send(endpoint: string, payload: ChatRequest): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(endpoint, payload);
  }
}
