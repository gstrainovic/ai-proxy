# ai-proxy

Kleiner Server zwischen App und Mistral-API. Er hält den Mistral-Key, zählt den Verbrauch pro Nutzer und Monat, setzt Plan-Limits durch und wickelt Abos über Stripe ab. Genutzt von [auto-service](https://github.com/gstrainovic/auto-service) und [dms](https://github.com/gstrainovic/dms), je mit eigener Instanz.

## Endpunkte

| Route | Zweck |
|---|---|
| `POST /v1/chat/completions` | Durchleitung an Mistral, zählt `chatTokens`, nur erlaubte Modelle |
| `POST /v1/ocr` | Durchleitung an Mistral OCR, zählt `ocrPages` |
| `POST /v1/embeddings` | Durchleitung an Mistral Embed, zählt `total_tokens` als `chatTokens`, nur `mistral-embed` |
| `GET /me/usage` | Plan, Monat, Verbrauch, Limits des Nutzers und der ganze Plan-Katalog (`plans`) |
| `POST /billing/checkout` | Stripe Checkout für einen bezahlten Plan |
| `POST /billing/portal` | Stripe Kundenportal |
| `POST /stripe/webhook` | Setzt den Plan nach Zahlung, Änderung oder Kündigung |
| `GET /health` | Healthcheck |

Bei erreichtem Limit antwortet der Proxy mit 402 im Mistral-Fehlerformat, sodass das AI SDK die Meldung durchreicht.

## Aufbau

- `src/app.ts` erzeugt die Hono-App. Store, Token-Prüfung, `fetch` und Stripe werden injiziert, deshalb ist die Logik ohne Netz testbar.
- `src/plans.ts` definiert den Standard-Katalog (auto-service) und den Typ `PlanCatalog`. Jede App kann ihren eigenen Katalog per `createApp(deps.plans)` bzw. `createEdgeApp(env, { plans })` injizieren; unbekannte Pläne fallen auf `defaultPlan` zurück. Stripe-Preise kommen aus `STRIPE_PRICE_<PLAN>`.
- **Interner Aufruf:** Mit `AI_PROXY_INTERNAL_TOKEN` (Node) bzw. dem Service-Role-Key (Edge) als Bearer plus Header `x-user-id` dürfen eigene Server-Prozesse im Namen eines Nutzers zählen und aufrufen, etwa eine OCR-Pipeline ohne Nutzer-Session.
- `src/stores/` Persistenz: `memory` für Tests, `instant` für InstantDB, `supabase` für Postgres (Tabellen `ai_usage`, `ai_subscriptions`, RPC `ai_add_usage`; Schema in dms `supabase/migrations/00007_ai_proxy.sql`).
- `src/auth/` Token-Prüfung: `instant` für InstantDB-Refresh-Tokens, `supabase` für Supabase-Access-Tokens (JWT der Session).
- `src/node.ts` Einstieg für Node. Wählt das Backend nach Umgebung: `INSTANT_APP_ID` + `INSTANT_ADMIN_TOKEN` oder `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- `src/edge.ts` Einstieg für Supabase Edge Functions (Deno), immer mit Supabase-Backend. Routen liegen unter `/<Funktionsname>/...`, Default `ai-proxy`. `deno.json` liefert die Import-Map (hono, stripe, supabase-js als npm-Specifier).

## Lokal

```bash
npm install
cp .env.example .env    # Werte eintragen
npm start               # http://localhost:8787
npm test
npm run typecheck
```

Node 24 oder neuer, läuft ohne Build-Schritt über natives Type-Stripping. Relative Imports deshalb mit `.ts`-Endung.

Die Integrationstests für Supabase laufen gegen ein lokales Supabase (Standard `http://127.0.0.1:54321`, dms-Stack) und werden übersprungen, wenn es nicht läuft. Gleiches gilt für InstantDB (`http://localhost:8888`).

```bash
npm run test:deno    # deno check src/edge.ts
```

## Als Paket nutzen

```bash
npm install github:gstrainovic/ai-proxy   # oder file:../ai-proxy für lokale Entwicklung
```

Start aus einer App heraus: `node --env-file-if-exists=.env node_modules/@strainovic/ai-proxy/src/node.ts`

## In Supabase Edge Functions

Eine Function anlegen, die `createEdgeApp` aus `src/edge.ts` importiert (gepinnt auf einen Tag, z. B. `https://raw.githubusercontent.com/gstrainovic/ai-proxy/v0.2.0/src/edge.ts`) und mit `Deno.serve(app.fetch)` startet; die `deno.json`-Imports übernehmen. `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase selbst, `MISTRAL_API_KEY` kommt als Secret dazu. Wie dms das einbindet, steht dort in `AGENTS.md`.

## Docker

```bash
docker build -t ai-proxy .
docker run --env-file .env -p 8787:8787 ai-proxy
```

## Lizenz

AGPL-3.0-only, siehe `LICENSE`.
