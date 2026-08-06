import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
// NOTE: FormsModule is imported ALONGSIDE ReactiveFormsModule ON PURPOSE.
// Bug we hit twice: with a `<form (ngSubmit)="...">` and only ReactiveFormsModule
// imported, `(ngSubmit)` DOES NOT FIRE — pressing Enter / clicking submit does
// nothing. `ngSubmit` is provided by FormsModule's `NgForm`/`ngNoForm` machinery,
// so a template `<form>` needs FormsModule even when the controls are reactive.
// Drop FormsModule here and the composer silently breaks.
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { CHAT_MESSAGE_MAX_LENGTH, ChatMessage } from '../chat.model';

/**
 * Presentational chat transcript + composer. It OWNS no data: the parent passes
 * `messages` / `loading` and receives a `send` event with the trimmed text.
 * Kept dumb so any chat surface (a floating widget, a panel) reuses the exact
 * same conversation UX.
 *
 * Standalone + OnPush + signals. SSR-safe: the only browser touch is the
 * auto-scroll effect, guarded by `isPlatformBrowser`. Assistant text is rendered
 * via interpolation (never `innerHTML`), so a model reply can't inject markup.
 */
@Component({
  selector: 'app-chat-conversation',
  imports: [ReactiveFormsModule, FormsModule],
  templateUrl: './chat-conversation.component.html',
  styleUrl: './chat-conversation.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatConversationComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly messages = input.required<ChatMessage[]>();
  readonly loading = input<boolean>(false);
  readonly placeholder = input<string>('Type your message…');

  readonly send = output<string>();

  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');

  readonly draft = new FormControl<string>('', { nonNullable: true });
  readonly maxLength = CHAT_MESSAGE_MAX_LENGTH;

  constructor() {
    // External DOM side effect only (auto-scroll to the latest line) — the
    // legitimate use of effect(). Never touches the DOM on the server.
    effect(() => {
      this.messages().length;
      this.loading();
      if (!this.isBrowser) {
        return;
      }
      queueMicrotask(() => {
        const el = this.logEl()?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }

  onSubmit(): void {
    const text = this.draft.value.trim();
    if (text === '' || this.loading()) {
      return;
    }
    this.draft.setValue('');
    this.send.emit(text);
  }
}
