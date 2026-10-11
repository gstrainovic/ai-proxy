/**
 * Texte der Abo-Rechnung (PDF und Mails an den Kunden) je Sprache. Die Sprache steht an der Rechnungsadresse
 * (`BillingAddress.language`, aus der Bestellung in der App) und gilt damit auch für Verlängerungen und Stornos;
 * fehlt sie, ist die Rechnung deutsch. Anrede wie in der App: du-Form (fr tutoiement, it «tu»), en neutral.
 * Interne Mails an den Betreiber (invoice-request.ts) bleiben deutsch. Abo-Regeln (find-jobs/akquise/abo-regeln.md,
 * Test invoice-texts.test.ts): verbindlich erst mit der Zahlung, ohne Zahlung nichts tun, Verlängerung als Angebot,
 * kein Kündigen, keine Mahnung.
 */

export const INVOICE_LANGUAGES = ['de', 'fr', 'it', 'en'] as const
export type InvoiceLanguage = typeof INVOICE_LANGUAGES[number]

export function invoiceLanguage(value: unknown): InvoiceLanguage {
  return (INVOICE_LANGUAGES as readonly unknown[]).includes(value) ? value as InvoiceLanguage : 'de'
}

const de = {
  invoice: 'Rechnung',
  privat: 'Privat',
  betrieb: 'Betrieb',
  /** Titel der Position: Marke, Zielgruppe, Laufzeit */
  title: (brand: string, label: string, from: string, to: string) => `${brand} Jahresabo ${label}, ${from} bis ${to}`,
  vehicles: (n: number) => `${n} ${n === 1 ? 'Fahrzeug' : 'Fahrzeuge'}`,
  perVehicle: (vehicles: string, price: string) => `${vehicles} × ${price} pro Jahr`,
  flat: (vehicles: string, max: number, price: string) => `${vehicles}, bis ${max} Fahrzeuge ${price} im Jahr`,
  issuedAt: 'Rechnungsdatum',
  dueAt: 'Zahlbar bis',
  reference: 'Referenz',
  customerReference: 'Kundenreferenz',
  description: 'Beschreibung',
  amount: 'Betrag',
  total: 'Total',
  noVat: 'Ohne MWST: nicht mehrwertsteuerpflichtig.',
  terms: (email: string) => `Zahlbar innert 30 Tagen mit dem QR-Zahlteil unten, am einfachsten im E-Banking oder mit der Banking-App. Verbindlich wird das Abo erst mit der Zahlung, für ein Jahr. Zahlst du nicht, musst du nichts tun: Es entstehen keine Kosten, KI-Scan und Chat enden. Nichts verlängert sich von selbst, die Rechnung fürs nächste Jahr kommt 30 Tage vor Ablauf als Angebot. Fragen an ${email}.`,
  mailSubject: (number: string, brand: string) => `Rechnung ${number}, ${brand} Jahresabo`,
  voidedSubject: (brand: string) => `${brand}: Rechnung storniert`,
  greeting: (contact: string) => `Guten Tag ${contact}`,
  mailIntro: (number: string, title: string, vehicles: string) => `im Anhang die Rechnung ${number}: ${title}, ${vehicles}.`,
  mailAmount: (amount: string, due: string) => `Betrag: ${amount}, zahlbar bis ${due} mit dem QR-Zahlteil im PDF — am einfachsten im E-Banking oder mit der Banking-App.`,
  mailRenewal: (url: string) => `Verbindlich wird das Abo erst mit der Zahlung, für ein Jahr. Zahlst du nicht, musst du nichts tun: Es entstehen keine Kosten, KI-Scan und Chat enden. Nichts verlängert sich von selbst, die Rechnung fürs nächste Jahr kommt 30 Tage vor Ablauf als Angebot. Willst du keine weiteren Rechnungen, antworte kurz auf diese Mail. Dein Abo siehst du in der App unter Einstellungen (${url}).`,
  voidedIntro: 'du willst keine weiteren Rechnungen, das ist erledigt. Diese Rechnungen sind storniert, bitte nicht bezahlen:',
  voidedLine: (number: string, amount: string) => `- ${number} über ${amount}`,
  reminderSubject: (number: string, brand: string) => `Erinnerung: Rechnung ${number}, ${brand} Jahresabo`,
  reminderIntro: (number: string, due: string) => `die Rechnung ${number} im Anhang ist heute, am ${due}, fällig.`,
  reminderAction: (amount: string) => `Möchtest du weitermachen, zahle ${amount} heute mit dem QR-Zahlteil im PDF, am einfachsten im E-Banking oder mit der Banking-App. Sonst musst du nichts tun: Es entstehen keine Kosten, KI-Scan und Chat enden morgen, deine Daten bleiben. Kommt die Zahlung später, schaltet sie KI-Scan und Chat wieder frei.`,
  regards: 'Freundliche Grüsse',
}

type InvoiceTexts = typeof de

const TEXTS: Record<InvoiceLanguage, InvoiceTexts> = {
  de,
  fr: {
    invoice: 'Facture',
    privat: 'Particulier',
    betrieb: 'Entreprise',
    title: (brand, label, from, to) => `Abonnement annuel ${brand} ${label}, du ${from} au ${to}`,
    vehicles: n => `${n} ${n === 1 ? 'véhicule' : 'véhicules'}`,
    perVehicle: (vehicles, price) => `${vehicles} × ${price} par an`,
    flat: (vehicles, max, price) => `${vehicles}, jusqu’à ${max} véhicules ${price} par an`,
    issuedAt: 'Date de facture',
    dueAt: 'Payable jusqu’au',
    reference: 'Référence',
    customerReference: 'Référence client',
    description: 'Description',
    amount: 'Montant',
    total: 'Total',
    noVat: 'Sans TVA : non assujetti à la TVA.',
    terms: email => `Payable dans les 30 jours avec la section paiement QR ci-dessous, le plus simple dans l’e-banking ou avec l’app de ta banque. L’abonnement ne devient ferme qu’avec le paiement, pour un an. Si tu ne paies pas, tu n’as rien à faire : aucun frais, le scan IA et le chat s’arrêtent. Rien ne se prolonge tout seul, la facture pour l’année suivante arrive 30 jours avant l’échéance, comme une offre. Questions à ${email}.`,
    mailSubject: (number, brand) => `Facture ${number}, abonnement annuel ${brand}`,
    voidedSubject: brand => `${brand} : facture annulée`,
    greeting: contact => `Bonjour ${contact},`,
    mailIntro: (number, title, vehicles) => `Tu trouveras en annexe la facture ${number} : ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Montant : ${amount}, payable jusqu’au ${due} avec la section paiement QR du PDF — le plus simple dans l’e-banking ou avec l’app de ta banque.`,
    mailRenewal: url => `L’abonnement ne devient ferme qu’avec le paiement, pour un an. Si tu ne paies pas, tu n’as rien à faire : aucun frais, le scan IA et le chat s’arrêtent. Rien ne se prolonge tout seul, la facture pour l’année suivante arrive 30 jours avant l’échéance, comme une offre. Si tu ne veux plus de factures, réponds brièvement à cet e-mail. Tu vois ton abonnement dans l’app sous Réglages (${url}).`,
    voidedIntro: 'Tu ne veux plus de factures, c’est noté. Ces factures sont annulées, merci de ne pas les payer :',
    voidedLine: (number, amount) => `- ${number} de ${amount}`,
    reminderSubject: (number, brand) => `Rappel : facture ${number}, abonnement annuel ${brand}`,
    reminderIntro: (number, due) => `La facture ${number} en annexe est due aujourd’hui, le ${due}.`,
    reminderAction: amount => `Si tu veux continuer, paie ${amount} aujourd’hui avec la section paiement QR du PDF, le plus simple dans l’e-banking ou avec l’app de ta banque. Sinon, tu n’as rien à faire : aucun frais, le scan IA et le chat s’arrêtent demain, tes données restent. Si le paiement arrive plus tard, il réactive le scan IA et le chat.`,
    regards: 'Meilleures salutations',
  },
  it: {
    invoice: 'Fattura',
    privat: 'Privato',
    betrieb: 'Azienda',
    title: (brand, label, from, to) => `Abbonamento annuale ${brand} ${label}, dal ${from} al ${to}`,
    vehicles: n => `${n} ${n === 1 ? 'veicolo' : 'veicoli'}`,
    perVehicle: (vehicles, price) => `${vehicles} × ${price} all'anno`,
    flat: (vehicles, max, price) => `${vehicles}, fino a ${max} veicoli ${price} all'anno`,
    issuedAt: 'Data della fattura',
    dueAt: 'Pagabile entro il',
    reference: 'Riferimento',
    customerReference: 'Riferimento cliente',
    description: 'Descrizione',
    amount: 'Importo',
    total: 'Totale',
    noVat: 'Senza IVA: non assoggettato all\'IVA.',
    terms: email => `Pagabile entro 30 giorni con la sezione di pagamento QR qui sotto, il modo più semplice è l'e-banking o l'app della tua banca. L'abbonamento diventa vincolante solo con il pagamento, per un anno. Se non paghi, non devi fare nulla: nessun costo, scansione IA e chat si fermano. Nulla si prolunga da sé, la fattura per l'anno successivo arriva 30 giorni prima della scadenza, come offerta. Domande a ${email}.`,
    mailSubject: (number, brand) => `Fattura ${number}, abbonamento annuale ${brand}`,
    voidedSubject: brand => `${brand}: fattura annullata`,
    greeting: contact => `Buongiorno ${contact},`,
    mailIntro: (number, title, vehicles) => `in allegato trovi la fattura ${number}: ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Importo: ${amount}, pagabile entro il ${due} con la sezione di pagamento QR nel PDF — il modo più semplice è l'e-banking o l'app della tua banca.`,
    mailRenewal: url => `L'abbonamento diventa vincolante solo con il pagamento, per un anno. Se non paghi, non devi fare nulla: nessun costo, scansione IA e chat si fermano. Nulla si prolunga da sé, la fattura per l'anno successivo arriva 30 giorni prima della scadenza, come offerta. Se non vuoi altre fatture, rispondi brevemente a questa e-mail. Vedi il tuo abbonamento nell'app sotto Impostazioni (${url}).`,
    voidedIntro: 'non vuoi altre fatture, è fatto. Queste fatture sono annullate, per favore non pagarle:',
    voidedLine: (number, amount) => `- ${number} di ${amount}`,
    reminderSubject: (number, brand) => `Promemoria: fattura ${number}, abbonamento annuale ${brand}`,
    reminderIntro: (number, due) => `la fattura ${number} in allegato scade oggi, il ${due}.`,
    reminderAction: amount => `Se vuoi continuare, paga ${amount} oggi con la sezione di pagamento QR nel PDF, il modo più semplice è l'e-banking o l'app della tua banca. Altrimenti non devi fare nulla: nessun costo, scansione IA e chat si fermano domani, i tuoi dati restano. Se il pagamento arriva più tardi, riattiva scansione IA e chat.`,
    regards: 'Cordiali saluti',
  },
  en: {
    invoice: 'Invoice',
    privat: 'Private',
    betrieb: 'Business',
    title: (brand, label, from, to) => `${brand} annual subscription ${label}, ${from} to ${to}`,
    vehicles: n => `${n} ${n === 1 ? 'vehicle' : 'vehicles'}`,
    perVehicle: (vehicles, price) => `${vehicles} × ${price} per year`,
    flat: (vehicles, max, price) => `${vehicles}, up to ${max} vehicles ${price} per year`,
    issuedAt: 'Invoice date',
    dueAt: 'Payable by',
    reference: 'Reference',
    customerReference: 'Customer reference',
    description: 'Description',
    amount: 'Amount',
    total: 'Total',
    noVat: 'No VAT: not registered for VAT.',
    terms: email => `Payable within 30 days using the QR payment part below, easiest via e-banking or your banking app. The subscription only becomes binding with payment, for one year. If you don't pay, you don't need to do anything: no costs, AI scan and chat stop. Nothing extends by itself; the invoice for the next year comes 30 days before expiry, as an offer. Questions to ${email}.`,
    mailSubject: (number, brand) => `Invoice ${number}, ${brand} annual subscription`,
    voidedSubject: brand => `${brand}: invoice cancelled`,
    greeting: contact => `Hello ${contact},`,
    mailIntro: (number, title, vehicles) => `Please find attached invoice ${number}: ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Amount: ${amount}, payable by ${due} using the QR payment part in the PDF — easiest via e-banking or your banking app.`,
    mailRenewal: url => `The subscription only becomes binding with payment, for one year. If you don't pay, you don't need to do anything: no costs, AI scan and chat stop. Nothing extends by itself; the invoice for the next year comes 30 days before expiry, as an offer. If you don't want any further invoices, just reply briefly to this email. You can see your subscription in the app under Settings (${url}).`,
    voidedIntro: 'You don\'t want any further invoices, done. These invoices are cancelled, please do not pay them:',
    voidedLine: (number, amount) => `- ${number} for ${amount}`,
    reminderSubject: (number, brand) => `Reminder: invoice ${number}, ${brand} annual subscription`,
    reminderIntro: (number, due) => `The attached invoice ${number} is due today, ${due}.`,
    reminderAction: amount => `To continue, pay ${amount} today using the QR payment part in the PDF, easiest via e-banking or your banking app. Otherwise you don't need to do anything: no costs, AI scan and chat stop tomorrow, your data stays. If payment arrives later, it unlocks AI scan and chat again.`,
    regards: 'Kind regards',
  },
}

export function invoiceTexts(language: unknown): InvoiceTexts {
  return TEXTS[invoiceLanguage(language)]
}
