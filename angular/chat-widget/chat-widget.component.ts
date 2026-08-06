import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, exhaustMap } from 'rxjs/operators';

import { ChatMessage } from '../chat.model';
import { ChatConversationComponent } from '../chat-conversation/chat-conversation.component';
import { ChatArmorClientService } from './chat-armor-client.service';

const ERROR_REPLY =
  "Sorry, I couldn't send your message. Please try again in a moment.";

/**
 * Floating chat assistant — a launcher bubble bottom-right that opens a panel
 * wired to your armored ChatArmor endpoint. Standalone + OnPush + signals;
 * SSR-safe (browser APIs guarded).
 *
 * Two bugs this component is built to avoid:
 *  - DOUBLE-SUBMIT: sends go through an `exhaustMap` pipeline, so a fast
 *    double-tap can't fire two in-flight requests (and double-bill your LLM).
 *  - MOBILE KEYBOARD covering the input: the panel is sized with `dvh`, not
 *    `vh` (see the .css) so it shrinks to the *visible* viewport when the
 *    on-screen keyboard opens.
 *
 * Configure via inputs: `endpoint` (your route) and `greeting`.
 */
@Component({
  selector: 'app-chat-widget',
  imports: [ChatConversationComponent],
  templateUrl: './chat-widget.component.html',
  styleUrl: './chat-widget.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatWidgetComponent {
  private readonly chat = inject(ChatArmorClientService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Your backend chat route, e.g. `/api/public/chat`. */
  readonly endpoint = input.required<string>();
  readonly title = input<string>('Assistant');
  readonly placeholder = input<string>('Ask me anything…');
  readonly greeting = input<string>('Hi! How can I help you today?');

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly messages = signal<ChatMessage[]>([]);

  private nextId = 1;
  private clientTraceId: string | null = null;
  private greeted = false;
  private readonly send$ = new Subject<string>();

  constructor() {
    this.send$
      .pipe(
        // exhaustMap: ignore new sends while one request is in flight.
        exhaustMap((text) =>
          this.chat
            .send(this.endpoint(), {
              message: text,
              clientTraceId: this.ensureClientTraceId(),
              // Mirrored under the 0.1.x name so an endpoint that still reads
              // `body.sessionId` keeps correlating. Dropped in 1.0.0.
              sessionId: this.ensureClientTraceId(),
            })
            .pipe(catchError(() => of({ reply: ERROR_REPLY }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.push('assistant', response.reply);
        this.loading.set(false);
      });
  }

  toggle(): void {
    const opening = !this.open();
    this.open.set(opening);
    if (opening && !this.greeted) {
      this.greeted = true;
      this.push('assistant', this.greeting());
    }
  }

  onSend(text: string): void {
    if (this.loading()) {
      return;
    }
    this.push('user', text);
    this.loading.set(true);
    this.send$.next(text);
  }

  private push(role: 'user' | 'assistant', text: string): void {
    this.messages.update((list) => [
      ...list,
      { id: this.nextId++, role, text },
    ]);
  }

  /**
   * A per-widget opaque id for correlating client-side logs ONLY. It is not
   * trusted server-side and must never gate the spend cap (see `chat.model.ts`).
   */
  private ensureClientTraceId(): string {
    if (this.clientTraceId === null) {
      this.clientTraceId =
        this.isBrowser && typeof crypto?.randomUUID === 'function'
          ? crypto.randomUUID()
          : `s-${this.nextId}`;
    }
    return this.clientTraceId;
  }
}
