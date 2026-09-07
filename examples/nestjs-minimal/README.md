# ChatArmor + NestJS — Minimal Example

A minimal NestJS app showing ChatArmor with Redis fail-fast configuration and a single controller returning `{ reply }`.

## Try in 60 seconds

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
export GEMINI_API_KEY="your-key-here"
export REDIS_URL="redis://localhost:6379"

# 3. Run the server
npm start

# 4. Test it
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## What's inside

- **Redis fail-fast**: `enableOfflineQueue: false`, `maxRetriesPerRequest: 2` — a dead Redis errors instead of hanging the request path.
- **Single endpoint** (`POST /chat`) that accepts `{ message }` and returns `{ reply }`.
- **Budget cap**: 500 calls/24h across all visitors (adjust `limit` in `app.module.ts`).

## Files

- `src/main.ts` — Bootstrap the NestJS app
- `src/app.module.ts` — ChatArmorModule.forRoot with Redis config
- `src/chat.controller.ts` — Single `/chat` endpoint
- `src/chat.dto.ts` — Validated DTO for the request body

---

See [../../README.md](../../README.md) for the full ChatArmor documentation.
