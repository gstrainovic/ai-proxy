# ai-proxy

Kleiner Server zwischen App und Mistral-API. Er hält den Mistral-Key, zählt den Verbrauch pro Nutzer und Monat, setzt Plan-Limits durch und wickelt Abos über Stripe ab. Genutzt von [auto-service](https://github.com/gstrainovic/auto-service) und [dms](https://github.com/gstrainovic/dms), je mit eigener Instanz.

## Endpunkte

| Route | Zweck |
|---|---|
| `POST /v1/chat/completions` | Durchleitung an Mistral, zählt `chatTokens`, nur erlaubte Modelle |
| `POST /v1/ocr` | Durchleitung an Mistral OCR, zählt `ocrPages` |
| `GET /me/usage` | Plan, Monat, Verbrauch und Limits des Nutzers |
| `POST /billing/checkout` | Stripe Checkout für einen bezahlten Plan |
| `POST /billing/portal` | Stripe Kundenportal |
| `POST /stripe/webhook` | Setzt den Plan nach Zahlung, Änderung oder Kündigung |
| `GET /health` | Healthcheck |

Bei erreichtem Limit antwortet der Proxy mit 402 im Mistral-Fehlerformat, sodass das AI SDK die Meldung durchreicht.

## Aufbau

- `src/app.ts` erzeugt die Hono-App. Store, Token-Prüfung, `fetch` und Stripe werden injiziert, deshalb ist die Logik ohne Netz testbar.
- `src/plans.ts` definiert Pläne und Limits, wird auch vom Frontend importiert (`@strainovic/ai-proxy/plans`).
- `src/stores/` Persistenz: `memory` für Tests, `instant` für InstantDB. Ein Supabase-Store folgt.
- `src/auth/` Token-Prüfung: `instant` für InstantDB-Refresh-Tokens. Supabase-JWT folgt.
- `src/node.ts` Einstieg für Node, liest die Konfiguration aus Umgebungsvariablen.

## Lokal

```bash
npm install
cp .env.example .env    # Werte eintragen
npm start               # http://localhost:8787
npm test
npm run typecheck
```

Node 24 oder neuer, läuft ohne Build-Schritt über natives Type-Stripping. Relative Imports deshalb mit `.ts`-Endung.

## Als Paket nutzen

```bash
npm install github:gstrainovic/ai-proxy   # oder file:../ai-proxy für lokale Entwicklung
```

Start aus einer App heraus: `node --env-file-if-exists=.env node_modules/@strainovic/ai-proxy/src/node.ts`

## Docker

```bash
docker build -t ai-proxy .
docker run --env-file .env -p 8787:8787 ai-proxy
```

## Lizenz

AGPL-3.0-only, siehe `LICENSE`.
