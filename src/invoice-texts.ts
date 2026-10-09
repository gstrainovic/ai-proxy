/**
 * Texte der Abo-Rechnung (PDF und Mails an den Kunden) je Sprache. Die Sprache steht an der Rechnungsadresse
 * (`BillingAddress.language`, aus der Bestellung in der App) und gilt damit auch für Verlängerungen und Stornos;
 * fehlt sie, ist die Rechnung deutsch. Anrede wie in der App: du-Form (fr tutoiement, it «tu»), en neutral.
 * Interne Mails an den Betreiber (invoice-request.ts) bleiben deutsch.
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
  terms: (email: string) => `Zahlbar innert 30 Tagen mit dem QR-Zahlteil unten, am einfachsten im E-Banking oder mit der Banking-App. Das Abo verlängert sich jeweils um ein Jahr und ist bis zum Ablauf ohne Frist kündbar, in der App unter Einstellungen oder per Mail an ${email}.`,
  mailSubject: (number: string, brand: string) => `Rechnung ${number}, ${brand} Jahresabo`,
  voidedSubject: (brand: string) => `${brand}: Rechnung storniert`,
  greeting: (contact: string) => `Guten Tag ${contact}`,
  mailIntro: (number: string, title: string, vehicles: string) => `im Anhang die Rechnung ${number}: ${title}, ${vehicles}.`,
  mailAmount: (amount: string, due: string) => `Betrag: ${amount}, zahlbar bis ${due} mit dem QR-Zahlteil im PDF — am einfachsten im E-Banking oder mit der Banking-App.`,
  mailRenewal: (url: string) => `Das Abo verlängert sich jeweils um ein Jahr. Kündigen geht bis zum Ablauf ohne Frist, in der App unter Einstellungen (${url}) oder mit einer Antwort auf diese Mail.`,
  voidedIntro: 'die Kündigung ist eingegangen. Diese Rechnungen sind storniert, bitte nicht bezahlen:',
  voidedLine: (number: string, amount: string) => `- ${number} über ${amount}`,
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
    terms: email => `Payable dans les 30 jours avec la section paiement QR ci-dessous, le plus simple dans l’e-banking ou avec l’app de ta banque. L’abonnement se renouvelle d’un an à chaque fois et peut être résilié sans préavis jusqu’à l’échéance, dans l’app sous Réglages ou par e-mail à ${email}.`,
    mailSubject: (number, brand) => `Facture ${number}, abonnement annuel ${brand}`,
    voidedSubject: brand => `${brand} : facture annulée`,
    greeting: contact => `Bonjour ${contact},`,
    mailIntro: (number, title, vehicles) => `Tu trouveras en annexe la facture ${number} : ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Montant : ${amount}, payable jusqu’au ${due} avec la section paiement QR du PDF — le plus simple dans l’e-banking ou avec l’app de ta banque.`,
    mailRenewal: url => `L’abonnement se renouvelle d’un an à chaque fois. Tu peux le résilier sans préavis jusqu’à l’échéance, dans l’app sous Réglages (${url}) ou en répondant à cet e-mail.`,
    voidedIntro: 'Ta résiliation nous est bien parvenue. Ces factures sont annulées, merci de ne pas les payer :',
    voidedLine: (number, amount) => `- ${number} de ${amount}`,
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
    terms: email => `Pagabile entro 30 giorni con la sezione di pagamento QR qui sotto, il modo più semplice è l'e-banking o l'app della tua banca. L'abbonamento si rinnova ogni volta di un anno e può essere disdetto senza preavviso fino alla scadenza, nell'app sotto Impostazioni o per e-mail a ${email}.`,
    mailSubject: (number, brand) => `Fattura ${number}, abbonamento annuale ${brand}`,
    voidedSubject: brand => `${brand}: fattura annullata`,
    greeting: contact => `Buongiorno ${contact},`,
    mailIntro: (number, title, vehicles) => `in allegato trovi la fattura ${number}: ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Importo: ${amount}, pagabile entro il ${due} con la sezione di pagamento QR nel PDF — il modo più semplice è l'e-banking o l'app della tua banca.`,
    mailRenewal: url => `L'abbonamento si rinnova ogni volta di un anno. Puoi disdirlo senza preavviso fino alla scadenza, nell'app sotto Impostazioni (${url}) o rispondendo a questa e-mail.`,
    voidedIntro: 'abbiamo ricevuto la tua disdetta. Queste fatture sono annullate, per favore non pagarle:',
    voidedLine: (number, amount) => `- ${number} di ${amount}`,
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
    terms: email => `Payable within 30 days using the QR payment part below, easiest via e-banking or your banking app. The subscription renews for one year at a time and can be cancelled without notice until it expires, in the app under Settings or by email to ${email}.`,
    mailSubject: (number, brand) => `Invoice ${number}, ${brand} annual subscription`,
    voidedSubject: brand => `${brand}: invoice cancelled`,
    greeting: contact => `Hello ${contact},`,
    mailIntro: (number, title, vehicles) => `Please find attached invoice ${number}: ${title}, ${vehicles}.`,
    mailAmount: (amount, due) => `Amount: ${amount}, payable by ${due} using the QR payment part in the PDF — easiest via e-banking or your banking app.`,
    mailRenewal: url => `The subscription renews for one year at a time. You can cancel without notice until it expires, in the app under Settings (${url}) or by replying to this email.`,
    voidedIntro: 'We have received your cancellation. These invoices are cancelled, please do not pay them:',
    voidedLine: (number, amount) => `- ${number} for ${amount}`,
    regards: 'Kind regards',
  },
}

export function invoiceTexts(language: unknown): InvoiceTexts {
  return TEXTS[invoiceLanguage(language)]
}
