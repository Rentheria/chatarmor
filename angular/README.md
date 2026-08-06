# ChatArmor — Angular widget (copy-paste)

The Angular side ships as **copy-paste source**, not a compiled entry point.
Angular and NestJS have incompatible dependency trees, so bundling both in one
npm package would force the wrong peers on you. Instead, drop these standalone
components into your app and wire them to your armored ChatArmor endpoint.

Why source and not a library build: it's ~4 small files, you'll want to restyle
them anyway, and this way there's no `ng-packagr` version lock-in. (shadcn/ui
ships UI the same way, for the same reason.)

## What's here

| File                                       | What it is                                                   |
| ------------------------------------------ | ------------------------------------------------------------ |
| `chat.model.ts`                            | Request/response + message types (mirror your backend DTOs). |
| `chat-conversation/*`                      | Presentational transcript + composer (dumb, reusable).       |
| `chat-widget/*`                            | Floating launcher + panel, wired to your endpoint.           |
| `chat-widget/chat-armor-client.service.ts` | Thin `HttpClient` producer.                                  |

## The two bugs these components exist to avoid

1. **`(ngSubmit)` doesn't fire.** A template `<form (ngSubmit)="...">` needs
   `FormsModule` imported in the component — even when the controls are
   reactive. Import only `ReactiveFormsModule` and the composer silently does
   nothing on Enter/submit. Both are imported in `chat-conversation.component.ts`
   on purpose.
2. **Mobile keyboard covers the input.** The panel is sized with `dvh`, not
   `vh` (`chat-widget.component.css`), so it shrinks to the _visible_ viewport
   when the on-screen keyboard opens instead of hiding the input behind it.

Plus: sends go through an `exhaustMap` so a double-tap can't fire two in-flight
requests (and double-bill your LLM), and every browser API is `isPlatformBrowser`
/ SSR-guarded.

## Install

Copy the `angular/` folder into your app (e.g. `src/app/shared/chatarmor/`),
then use the widget anywhere:

```html
<app-chat-widget
  endpoint="/api/public/chat"
  title="Assistant"
  greeting="Hi! Ask me anything about our product."
/>
```

Requirements: Angular 17+ (standalone + signals + native control flow),
`provideHttpClient()` in your app config. Render the widget behind a feature
flag if you want to ship it dark and flip it on later.

The endpoint you point at should be a ChatArmor backend route (see the root
README) — the key, spend cap and anti-injection all live there, server-side.
