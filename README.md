# ai-proxy

Kleiner Server zwischen App und Mistral-API. Er hält den Mistral-Key, zählt den Verbrauch pro Nutzer und Monat, setzt Plan-Limits durch und wickelt Abos über Stripe ab. Genutzt von [wartungsheft](https://github.com/gstrainovic/wartungsheft) und [dms](https://github.com/gstrainovic/dms), je mit eigener Instanz.

## Endpunkte

| Route | Zweck |
|---|---|
| `POST /v1/chat/completions` | Durchleitung an Mistral, zählt `chatTokens`, nur erlaubte Modelle |
| `POST /v1/ocr` | Durchleitung an Mistral OCR, zählt `ocrPages` |
| `POST /v1/embeddings` | Durchleitung an Mistral Embed, zählt `total_tokens` als `chatTokens`, nur `mistral-embed` |
| `GET /me/usage` | Plan, Monat, Verbrauch, Limits des Nutzers und der ganze Plan-Katalog (`plans`) |
| `POST /me/transcribe` | Diktat: Audio (`multipart/form-data`, Feld `audio`, max. 5 MB) an Voxtral, Antwort `{ text }`; Fair-Use-Bremse, 402 nach der Testzeit, zählt geschätzte Sekunden als `chatTokens` |
| `POST /feedback` | Rückmeldung aus der App: Text und/oder Sprachnachricht, wird transkribiert und per Mail zugestellt |
| `POST /billing/checkout` | Stripe Checkout für einen bezahlten Plan |
| `POST /billing/portal` | Stripe Kundenportal |
| `POST /stripe/webhook` | Setzt den Plan nach Zahlung, Änderung oder Kündigung |
| `POST /billing/order` | Jahresabo auf Rechnung bestellen (Rechnungsadresse, Fahrzeuge, Zustimmung); legt Abo und QR-Rechnung an und verschickt sie |
| `POST /billing/cancel` | Rechnungs-Abo auf Ende der Laufzeit kündigen; offene Verlängerungen vor ihrem Beginn werden storniert |
| `POST /billing/resume` | Kündigung zurücknehmen, solange das Abo läuft |
| `GET /health` | Healthcheck |

Bei erreichtem Limit antwortet der Proxy mit 402 im Mistral-Fehlerformat, sodass das AI SDK die Meldung durchreicht.

## Aufbau

- `src/app.ts` erzeugt die Hono-App. Store, Token-Prüfung, `fetch` und Stripe werden injiziert, deshalb ist die Logik ohne Netz testbar.
- `src/plans.ts` definiert den Standard-Katalog (auto-service) und den Typ `PlanCatalog`. Jede App kann ihren eigenen Katalog per `createApp(deps.plans)` bzw. `createEdgeApp(env, { plans })` injizieren; unbekannte Pläne fallen auf `defaultPlan` zurück. Stripe-Preise kommen aus `STRIPE_PRICE_<PLAN>` (auto-service: `privat` 25 CHF im Jahr bis 5 Fahrzeuge, `betrieb` 36 CHF pro Fahrzeug und Jahr, `perVehicle`).
- **Interner Aufruf:** Mit `AI_PROXY_INTERNAL_TOKEN` (Node) bzw. dem Service-Role-Key (Edge) als Bearer plus Header `x-user-id` dürfen eigene Server-Prozesse im Namen eines Nutzers zählen und aufrufen, etwa eine OCR-Pipeline ohne Nutzer-Session.
- **Konto statt Person:** Optional `accountOf(user)` (`createApp` bzw. `createEdgeApp(env, { accountOf })`) bildet
  eine Person auf ihr Konto ab, etwa die Organisation in dms. Verbrauch, Testzeit, Abo und Fair-Use-Bremse laufen
  dann pro Konto; `null` heisst kein Konto (401). Interne Aufrufe geben das Konto direkt in `x-user-id` an.
- **Jahresrechnung** (Store: InstantDB und Supabase; Versand und PDF nur im Node-Einstieg): `src/invoice.ts` prüft die Bestellung und bildet Nummer
  und Zahlungsreferenz (QR-Referenz bei QR-IBAN, sonst SCOR), `src/invoice-subscription.ts` den Ablauf (Zugang ab
  Bestellung, bezahltes Jahr nach der Testzeit, Verlängerung 30 Tage vor Ablauf, kündbar bis zum Ablauf),
  `src/invoice-pdf.ts` das PDF mit QR-Zahlteil (pdfkit + swissqrbill), `src/invoice-mail.ts` den Versand über Resend.
  Aktiv mit `INVOICE_IBAN`, dazu `INVOICE_CREDITOR_NAME`, `INVOICE_STREET`, `INVOICE_ZIP`, `INVOICE_CITY`,
  `INVOICE_EMAIL`, optional `INVOICE_TRADE_NAME`, `INVOICE_BRAND`, `INVOICE_WEBSITE`, `INVOICE_FROM`, `INVOICE_BCC`.
  Ohne `RESEND_TOKEN` wird die Rechnung nur protokolliert.
- **Rechnung von Hand** (ohne `INVOICE_IBAN`): Bestellungen gehen trotzdem, sobald `INVOICE_EMAIL` oder
  `FEEDBACK_TO` gesetzt ist. Das Abo entsteht wie oben mit SCOR-Referenz; statt des PDF an den Kunden schickt
  `src/invoice-request.ts` dem Betreiber den Auftrag, die Rechnung zu schreiben (Nummer, Referenz, Betrag,
  Fälligkeit, Rechnungsadresse), bei Kündigung die zu stornierenden Rechnungen. `/billing/order` meldet `manual: true`.
- **Rückmeldungen** aus der App (`/feedback`): Ziel ist `FEEDBACK_TO`, ersatzweise `INVOICE_EMAIL`, Absender
  `FEEDBACK_FROM`. Bewusst unabhängig von der IBAN, damit eine Instanz ohne Rechnungsstellung Fehler und Wünsche
  trotzdem annimmt. Ohne Ziel antwortet `/feedback` mit 501, ohne `RESEND_TOKEN` landet alles im Log. Die Verlängerung läuft als Job in der App (auto-service
  `scripts/renewals.ts`), der Proxy verlängert nicht selbst.
- `src/stores/` Persistenz: `memory` für Tests, `instant` für InstantDB, `supabase` für Postgres (Tabellen `ai_usage`, `ai_subscriptions`, RPC `ai_add_usage`; Schema in dms `supabase/migrations/`, ab `00007_ai_proxy.sql`).
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

## Geplant: Payrexx als zweiter Zahlungsanbieter

Beide Apps wechseln auf Payrexx (CH, günstiger, Daten in der Schweiz; Entscheidung und Preise in dms/AGENTS.md). Dafür wird `billing.ts` hinter eine Schnittstelle gezogen: Stripe bleibt, Payrexx kommt dazu (Gateway mit `subscriptionState`, Webhook `X-Webhook-Signature` HMAC-SHA256 hex über den Raw-Body, Status active/overdue/failed/cancelled/in_notice, Kundenportal `POST /AuthToken`, Kündigen `DELETE /Subscription/{id}`, Auth `X-API-KEY`). Start, sobald das Payrexx-Konto freigegeben ist.

## Lizenz

AGPL-3.0-only, siehe `LICENSE`.
