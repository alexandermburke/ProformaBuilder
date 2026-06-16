/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
} from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Inbox,
  Search,
  Send,
  Tag,
  Trash2,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import {
  deriveRoutedEmail,
  type InvoiceRoutingRecord,
  type InvoiceRoutingRule,
} from '@/types/invoiceRouting';
import {
  parseInvoiceEmail,
  type InvoiceType,
  type ParsedInvoice,
  type TicketPrefix,
} from '@/lib/invoiceRouting/parseInvoiceEmail';

const overlayTopLight = 'bg-[radial-gradient(circle_at_16%_10%,rgba(245,158,11,0.18),transparent_58%)]';
const overlayTopDark = 'bg-[radial-gradient(circle_at_16%_10%,rgba(245,158,11,0.26),transparent_56%)]';
const overlayBottomLight = 'bg-[radial-gradient(circle_at_86%_86%,rgba(168,85,247,0.14),transparent_62%)]';
const overlayBottomDark = 'bg-[radial-gradient(circle_at_86%_86%,rgba(168,85,247,0.2),transparent_60%)]';

const LANDING_INBOX = 'billing@storestorage.com';

const TICKET_TYPES: { prefix: TicketPrefix; type: InvoiceType; note: string }[] = [
  { prefix: 'OBR', type: 'CapEx', note: 'Capital expenditure work.' },
  { prefix: 'RNM', type: 'R&M', note: 'Repairs and maintenance.' },
];

const PIPELINE_STEPS: { icon: typeof Inbox; title: string; body: string }[] = [
  {
    icon: CheckCircle2,
    title: 'Ashley approves',
    body: 'An invoice is approved in FacilIQ and released for billing.',
  },
  {
    icon: Inbox,
    title: 'Lands at billing@',
    body: 'FacilIQ emails the approved invoice to billing@storestorage.com.',
  },
  {
    icon: Search,
    title: 'We parse it',
    body: 'Pull site, service date, GL code, work details, amount, ticket number, and the invoice file.',
  },
  {
    icon: Tag,
    title: 'Classify the type',
    body: 'Ticket prefix sets the type. OBR is CapEx, RNM is R&M.',
  },
  {
    icon: Send,
    title: 'Forward to property',
    body: 'Send to the property inbox, e.g. L001 routes to l001billing@storestorage.com.',
  },
];

// Thin wrapper over the canonical helper that keeps the null-on-empty contract the
// preview/parse callers depend on for their fallback text.
const deriveDestinationInbox = (code: string): string | null => deriveRoutedEmail(code) || null;

const SAMPLE_EMAIL = `Subject: Approved Invoice - L001 - RNM-48217

Site: L001 - STORE at the Grove
Service date: 06/02/2026
GL code: 5120-100
Work details: Replaced two roll-up door springs and serviced gate motor.
Amount: $1,840.00
Ticket: RNM-48217

Invoice attached.`;

const fieldCardClass =
  'rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 px-4 py-3 shadow-inner';

type RuleFormState = {
  id?: string;
  propertyCode: string;
  name: string;
  routedEmail: string;
  enabled: boolean;
};

const createEmptyRuleForm = (): RuleFormState => ({
  propertyCode: '',
  name: '',
  routedEmail: '',
  enabled: true,
});

const toggleButtonClass = (active: boolean): string =>
  [
    'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-[rgba(148,163,255,0.28)] p-1 transition-all duration-300',
    active
      ? 'justify-end bg-[rgba(37,99,235,0.8)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]'
      : 'justify-start bg-[rgba(148,163,255,0.25)]',
  ].join(' ');

const togglePillClass =
  'inline-block h-5 w-5 rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300';

const recordStatusMeta: Record<InvoiceRoutingRecord['outcome'], { label: string; dotClass: string }> = {
  forwarded: { label: 'Forwarded', dotClass: 'bg-emerald-400 dark:bg-emerald-300' },
  forwarding: { label: 'Forwarding', dotClass: 'bg-amber-400 dark:bg-amber-300' },
  error: { label: 'Error', dotClass: 'bg-rose-400 dark:bg-rose-300' },
};

const formatReceived = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function InvoiceRoutingPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  const [siteCodeInput, setSiteCodeInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null);

  const previewInbox = useMemo(() => deriveDestinationInbox(siteCodeInput), [siteCodeInput]);

  const [rules, setRules] = useState<InvoiceRoutingRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(createEmptyRuleForm());
  const [savingRule, setSavingRule] = useState(false);
  const [deletingRule, setDeletingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);

  const [records, setRecords] = useState<InvoiceRoutingRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const refreshRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await fetch('/api/invoice-routing/records', { cache: 'no-store' });
      if (!res.ok) throw new Error('Unable to load routed invoices');
      const data = (await res.json()) as InvoiceRoutingRecord[];
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRecords();
  }, [refreshRecords]);

  const refreshRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await fetch('/api/invoice-routing/rules', { cache: 'no-store' });
      if (!res.ok) throw new Error('Unable to load routing rules');
      const data = (await res.json()) as InvoiceRoutingRule[];
      setRules(data);
    } catch (err) {
      console.error(err);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRules();
  }, [refreshRules]);

  const openModal = (rule?: InvoiceRoutingRule) => {
    setRuleForm(
      rule
        ? {
            id: rule.id,
            propertyCode: rule.propertyCode,
            name: rule.name,
            routedEmail: rule.routedEmail,
            enabled: rule.enabled,
          }
        : createEmptyRuleForm(),
    );
    setRuleMessage(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setRuleForm(createEmptyRuleForm());
    setRuleMessage(null);
  };

  const handleRuleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setRuleForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveRule = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!ruleForm.propertyCode.trim()) {
      setRuleMessage('Property code is required.');
      return;
    }
    setSavingRule(true);
    setRuleMessage(null);
    try {
      const res = await fetch('/api/invoice-routing/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ruleForm.id,
          propertyCode: ruleForm.propertyCode.trim(),
          name: ruleForm.name.trim(),
          routedEmail: ruleForm.routedEmail.trim(),
          enabled: ruleForm.enabled,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || 'Unable to save routing rule');
      }
      await refreshRules();
      closeModal();
    } catch (err) {
      setRuleMessage(err instanceof Error ? err.message : 'Unable to save routing rule');
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async () => {
    if (!ruleForm.id) return;
    const confirmed = window.confirm('Delete this routing rule? This cannot be undone.');
    if (!confirmed) return;
    setDeletingRule(true);
    setRuleMessage(null);
    try {
      const res = await fetch('/api/invoice-routing/rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ruleForm.id }),
      });
      if (!res.ok) throw new Error('Unable to delete routing rule');
      await refreshRules();
      closeModal();
    } catch (err) {
      setRuleMessage(err instanceof Error ? err.message : 'Unable to delete routing rule');
    } finally {
      setDeletingRule(false);
    }
  };

  const toggleRuleEnabled = async (rule: InvoiceRoutingRule) => {
    try {
      const res = await fetch('/api/invoice-routing/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error('Unable to update routing rule');
      await refreshRules();
    } catch (err) {
      setRuleMessage(err instanceof Error ? err.message : 'Unable to update routing rule');
    }
  };

  const parsedFields = parsed
    ? [
        { label: 'Ticket number', value: parsed.ticketNumber },
        { label: 'Invoice type', value: parsed.invoiceType },
        { label: 'Site', value: parsed.siteCode },
        { label: 'Service date', value: parsed.serviceDate },
        { label: 'GL code', value: parsed.glCode },
        { label: 'Work details', value: parsed.workDetails },
        { label: 'Amount', value: parsed.amount },
        { label: 'Destination inbox', value: parsed.destinationInbox },
      ]
    : [];

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">Automation tools</span>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Invoice Routing</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                Approved FacilIQ invoices land at {LANDING_INBOX}. This automation parses each one, tags it CapEx or
                R&amp;M from the ticket prefix, and forwards it to the matching property billing inbox.
              </p>
            </div>
            <Link href="/automations" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">
                &larr;
              </span>
              Back to automations
            </Link>
          </div>
        </header>

        {/* How it works pipeline */}
        <section className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg">
          <div className="mb-5 space-y-1">
            <h2 className="text-lg font-semibold">How it works</h2>
            <p className="text-sm text-[color:var(--text-secondary)]">
              One landing inbox, parsed and split out to each property. Same idea as the daily flash resend.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {PIPELINE_STEPS.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <Fragment key={step.title}>
                  <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 p-4 shadow-inner">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.14)] text-[#B45309] dark:text-[#FCD34D]">
                        <StepIcon className="h-4 w-4" />
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                        Step {index + 1}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{step.title}</h3>
                      <p className="text-xs leading-snug text-[color:var(--text-secondary)]">{step.body}</p>
                    </div>
                  </div>
                  {index < PIPELINE_STEPS.length - 1 && (
                    <div className="flex flex-none items-center justify-center text-[color:var(--text-muted)]" aria-hidden>
                      <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
            {TICKET_TYPES.map((ticket) => (
              <div
                key={ticket.prefix}
                className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 px-4 py-2 shadow-inner"
              >
                <span className="flex h-7 w-12 flex-none items-center justify-center rounded-lg bg-[rgba(37,99,235,0.12)] font-mono text-xs font-semibold text-[color:var(--accent-strong)]">
                  {ticket.prefix}
                </span>
                <ArrowRight className="h-3.5 w-3.5 flex-none text-[color:var(--text-muted)]" aria-hidden />
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">{ticket.type}</div>
                  <div className="text-[11px] text-[color:var(--text-secondary)]">{ticket.note}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Property routing registry */}
        <section className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 48%,transparent))] p-6 shadow-lg">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Property routing</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Save each property code and the inbox its invoices route to. Leave the email blank to auto-route to the
                derived address.
              </p>
            </div>
            <button
              type="button"
              className="ios-button px-4 py-2 text-sm font-semibold"
              data-variant="primary"
              onClick={() => openModal()}
            >
              Add property
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 shadow-inner">
            <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
              <thead className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted) 92%,transparent),color-mix(in_srgb,var(--tint-blue) 36%,transparent))] text-[color:var(--text-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Property code</th>
                  <th className="px-4 py-3 text-left font-semibold">Site name</th>
                  <th className="px-4 py-3 text-left font-semibold">Routed email</th>
                  <th className="px-4 py-3 text-left font-semibold">Enabled</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-soft)]">
                {rulesLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                      Loading routing rules...
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                      No routing rules yet. Add a property to map its code to a billing inbox.
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => {
                    const derived = deriveDestinationInbox(rule.propertyCode);
                    const effectiveEmail = rule.routedEmail || derived || '—';
                    const isDerived = !rule.routedEmail;
                    return (
                      <tr key={rule.id} className="transition-colors hover:bg-[color:var(--surface-subtle)]/70">
                        <td className="px-4 py-3 font-semibold uppercase text-[color:var(--text-primary)]">
                          {rule.propertyCode}
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-secondary)]">{rule.name || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] text-[color:var(--text-primary)]">{effectiveEmail}</span>
                            {isDerived && (
                              <span className="rounded-full bg-[rgba(37,99,235,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent-strong)]">
                                Auto
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-pressed={rule.enabled}
                            aria-label={`Toggle routing for ${rule.propertyCode}`}
                            className={toggleButtonClass(rule.enabled)}
                            onClick={() => void toggleRuleEnabled(rule)}
                          >
                            <span className={togglePillClass} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="ios-button text-sm"
                            data-variant="secondary"
                            onClick={() => openModal(rule)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {ruleMessage && !modalOpen && (
            <p className="pt-3 text-xs text-[color:var(--text-secondary)]">{ruleMessage}</p>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {/* Routing preview */}
          <div className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 48%,transparent))] p-6 shadow-lg">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Routing preview</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Destination inboxes are derived from the site code. Type one to see where its invoices go.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                Site / property code
              </label>
              <input
                value={siteCodeInput}
                onChange={(event) => setSiteCodeInput(event.target.value)}
                className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                placeholder="e.g. L001"
              />
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className={fieldCardClass}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                  Landing inbox
                </div>
                <div className="mt-1 font-mono text-sm text-[color:var(--text-primary)]">{LANDING_INBOX}</div>
              </div>
              <div className="flex items-center justify-center text-[color:var(--text-muted)]">
                <ArrowRight className="h-4 w-4 rotate-90" aria-hidden />
              </div>
              <div className={fieldCardClass}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                  Property inbox
                </div>
                <div className="mt-1 font-mono text-sm text-[color:var(--accent-strong)]">
                  {previewInbox ?? 'Enter a site code'}
                </div>
              </div>
            </div>
          </div>

          {/* Parse a test email */}
          <div className="ios-card ios-animate-up ios-animate-delay-sm rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 48%,transparent))] p-6 shadow-lg">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Parse a test email</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Paste an approved-invoice email to see the fields the router would pull. This is a local preview, nothing
                is forwarded.
              </p>
            </div>

            <textarea
              rows={6}
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              className="owner-field-input w-full rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 font-mono text-xs text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
              placeholder="Paste the invoice email subject and body here..."
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm font-semibold"
                data-variant="primary"
                onClick={() => setParsed(parseInvoiceEmail(emailInput))}
                disabled={!emailInput.trim()}
              >
                Parse fields
              </button>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                data-variant="secondary"
                onClick={() => {
                  setEmailInput(SAMPLE_EMAIL);
                  setParsed(parseInvoiceEmail(SAMPLE_EMAIL));
                }}
              >
                Load sample
              </button>
              {parsed && (
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="ghost"
                  onClick={() => {
                    setParsed(null);
                    setEmailInput('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {parsed && (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {parsedFields.map((field) => (
                  <div key={field.label} className={fieldCardClass}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                      {field.label}
                    </div>
                    <div
                      className={`mt-1 text-sm ${
                        field.value ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'
                      }`}
                    >
                      {field.value ?? 'Not found'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recent routed invoices */}
        <section className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Recent routed invoices</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Invoices the ingestion job has forwarded from {LANDING_INBOX} to a property inbox.
              </p>
            </div>
            <button
              type="button"
              className="ios-button px-4 py-2 text-sm font-semibold"
              data-variant="secondary"
              onClick={() => void refreshRecords()}
              disabled={recordsLoading}
            >
              {recordsLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 shadow-inner">
            <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
              <thead className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted) 92%,transparent),color-mix(in_srgb,var(--tint-blue) 36%,transparent))] text-[color:var(--text-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Received</th>
                  <th className="px-4 py-3 text-left font-semibold">Ticket</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Site</th>
                  <th className="px-4 py-3 text-left font-semibold">Service date</th>
                  <th className="px-4 py-3 text-left font-semibold">GL code</th>
                  <th className="px-4 py-3 text-left font-semibold">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold">Destination</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-soft)]">
                {recordsLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[color:var(--text-secondary)]">
                      Loading routed invoices...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[color:var(--text-secondary)]">
                      No invoices routed yet. They appear here once the ingestion job forwards one.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => {
                    const status = recordStatusMeta[record.outcome];
                    return (
                      <tr key={record.id} className="transition-colors hover:bg-[color:var(--surface-subtle)]/70">
                        <td className="whitespace-nowrap px-4 py-3 text-[color:var(--text-secondary)]">
                          {formatReceived(record.receivedAt)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] text-[color:var(--text-primary)]">
                          {record.ticketNumber ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {record.invoiceType ? (
                            <span
                              className="rounded-full bg-[rgba(37,99,235,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--accent-strong)]"
                            >
                              {record.invoiceType}
                            </span>
                          ) : (
                            <span className="text-[color:var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold uppercase text-[color:var(--text-primary)]">
                          {record.siteCode ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[color:var(--text-secondary)]">
                          {record.serviceDate ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-secondary)]">{record.glCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[color:var(--text-secondary)]">
                          {record.amount ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] text-[color:var(--text-secondary)]">
                          {record.destination ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--text-primary)]">
                              <span className={`h-2 w-2 rounded-full ${status.dotClass}`} />
                              {status.label}
                            </span>
                            {record.error && (
                              <span className="max-w-[220px] text-[11px] text-[color:var(--text-secondary)]">
                                {record.error}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="pt-3 text-xs text-[color:var(--text-muted)]">
            Only forwarded invoices are recorded here. Dry-run, unrouted, and disabled-property messages are not
            persisted, so they keep showing in the cron run summary until resolved.
          </p>
        </section>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
          <div className="ios-card ios-animate-up max-h-[90vh] w-full max-w-md space-y-6 !overflow-y-auto overscroll-contain p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">
                  {ruleForm.id ? 'Edit property routing' : 'Add property routing'}
                </h3>
                {ruleForm.id && (
                  <button
                    type="button"
                    onClick={() => void deleteRule()}
                    className="ios-icon-button text-[color:var(--text-secondary)] hover:text-[#DC2626]"
                    title="Delete routing rule"
                    disabled={deletingRule || savingRule}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="ios-icon-button text-[color:var(--text-secondary)]"
                aria-label="Close"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    fill="currentColor"
                    d="m7.05 7.757 4.242 4.243 4.243-4.243 1.414 1.415-4.242 4.243 4.242 4.242-1.414 1.415-4.243-4.243-4.242 4.243-1.414-1.415 4.242-4.242-4.242-4.243z"
                  />
                </svg>
              </button>
            </div>
            <form className="space-y-4" onSubmit={saveRule}>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property code
                </label>
                <input
                  name="propertyCode"
                  value={ruleForm.propertyCode}
                  onChange={handleRuleChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. L001"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Site name (optional)
                </label>
                <input
                  name="name"
                  value={ruleForm.name}
                  onChange={handleRuleChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. STORE at the Grove"
                />
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  Helps match the site name in the inbound invoice email.
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Routed email (optional)
                </label>
                <input
                  name="routedEmail"
                  type="email"
                  value={ruleForm.routedEmail}
                  onChange={handleRuleChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder={deriveDestinationInbox(ruleForm.propertyCode) ?? 'l001billing@storestorage.com'}
                />
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  Leave blank to auto-route to{' '}
                  <span className="font-mono">
                    {deriveDestinationInbox(ruleForm.propertyCode) ?? 'the derived inbox'}
                  </span>
                  .
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Enabled
                  </span>
                  <span className="text-[11px] text-[color:var(--text-muted)]">Pause to stop routing this property.</span>
                </div>
                <button
                  type="button"
                  aria-pressed={ruleForm.enabled}
                  aria-label="Toggle routing enabled"
                  className={toggleButtonClass(ruleForm.enabled)}
                  onClick={() => setRuleForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                >
                  <span className={togglePillClass} />
                </button>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="ios-button px-4 py-2 text-sm font-semibold"
                  data-variant="primary"
                  disabled={savingRule}
                >
                  {savingRule ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="secondary"
                  onClick={closeModal}
                >
                  Cancel
                </button>
              </div>
              {ruleMessage && <p className="text-xs text-[color:var(--text-secondary)]">{ruleMessage}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
