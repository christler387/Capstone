import React, { useEffect, useMemo, useState } from 'react';
import { UserRole } from '../types';
import { apiRequest } from '../apiClient';
import { Modal } from './Modal';

// Company details printed on every receipt. Edit these here if they change.
export const COMPANY = {
  name: 'SKYRUN',
  tagline: 'Auto Supply',
  address: 'Company address',
  contact: 'Contact number',
};

interface ReceiptRow {
  id: string;
  receiptNo: string;
  date: string;
  time: string;
  reference: string;
  customer: string;
  itemCount: number;
  quantity: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  status: 'COMPLETED' | 'VOIDED';
  recordedBy: string;
}

interface ReceiptDetail {
  id: string;
  receiptNo: string;
  date: string;
  time: string;
  reference: string;
  customer: { name: string; contact: string; address: string; type: string };
  subtotal: number;
  discount: number;
  otherCharges: number;
  total: number;
  amountPaid: number;
  balance: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  voidReason: string;
  voidedBy: string;
  voidedAt: string;
  recordedBy: string;
  lines: { id: number; itemId: string; itemName: string; partNumber: string; quantity: number; unitPrice: number; amount: number }[];
}

interface ReceiptsProps {
  userRole: UserRole;
  selectedReceiptId?: string;
  onSelectReceipt: (id: string) => void;
}

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isoDate = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  BANK_TRANSFER: 'Bank transfer',
  CHECK: 'Check',
  CREDIT: 'Credit (on account)',
  OTHER: 'Other',
};

const STATUS_LABELS: Record<string, string> = { PAID: 'Paid', PARTIAL: 'Partial', UNPAID: 'Unpaid' };

// The date range for each quick filter.
function rangeFor(preset: string): { from: string; to: string } {
  const now = new Date();
  const today = isoDate(now);
  switch (preset) {
    case 'yesterday': {
      const y = isoDate(new Date(now.getTime() - 86400000));
      return { from: y, to: y };
    }
    case 'week': {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return { from: isoDate(monday), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: today, to: today };
  }
}

export const Receipts: React.FC<ReceiptsProps> = ({ userRole, selectedReceiptId, onSelectReceipt }) => {
  const isAdmin = userRole === 'admin';
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(rangeFor('today'));
  const [customer, setCustomer] = useState('');
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('');
  const [recordedBy, setRecordedBy] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [format, setFormat] = useState<'a4' | 'thermal'>('a4');
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  const applyPreset = (value: string) => {
    setPreset(value);
    if (value !== 'custom') setRange(rangeFor(value));
  };

  const loadRows = () => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (customer.trim()) params.set('customer', customer.trim());
    if (payment) params.set('payment', payment);
    if (status) params.set('status', status);
    if (recordedBy.trim()) params.set('user', recordedBy.trim());
    if (search.trim()) params.set('q', search.trim());
    apiRequest<ReceiptRow[]>(`/sales/receipts?${params}`)
      .then((data) => { setRows(data); setError(null); })
      .catch((err: Error) => setError(err.message));
  };

  useEffect(loadRows, [range.from, range.to, customer, payment, status, recordedBy, search]);

  // Opening a receipt from another screen (for example right after a sale).
  useEffect(() => {
    if (!selectedReceiptId) return;
    apiRequest<ReceiptDetail>(`/sales/receipts/${encodeURIComponent(selectedReceiptId)}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [selectedReceiptId]);

  const openReceipt = (id: string) => {
    onSelectReceipt(id);
    apiRequest<ReceiptDetail>(`/sales/receipts/${encodeURIComponent(id)}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  };

  const summary = useMemo(() => {
    const live = rows.filter((r) => r.status === 'COMPLETED');
    return {
      count: rows.length,
      sales: live.reduce((sum, r) => sum + r.total, 0),
      collected: live.reduce((sum, r) => sum + r.amountPaid, 0),
      outstanding: live.reduce((sum, r) => sum + r.balance, 0),
    };
  }, [rows]);

  const printReceipt = () => {
    const style = document.createElement('style');
    style.id = 'receipt-page-size';
    style.textContent = format === 'thermal'
      ? '@page { size: 80mm auto; margin: 3mm; }'
      : '@page { size: A4; margin: 14mm; }';
    document.head.appendChild(style);
    document.body.classList.add('printing-receipt');
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove('printing-receipt');
      style.remove();
    }, 300);
  };

  const submitVoid = async () => {
    if (!detail) return;
    setVoidError(null);
    if (!voidReason.trim()) {
      setVoidError('Enter the reason for voiding this receipt.');
      return;
    }
    try {
      await apiRequest(`/sales/receipts/${encodeURIComponent(detail.id)}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      setVoidOpen(false);
      setVoidReason('');
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      openReceipt(detail.id);
      loadRows();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Could not void the receipt.');
    }
  };

  return (
    <div className="content-section rcp">
      <header className="rcp-head">
        <div>
          <h2 className="rcp-title">Sales receipts</h2>
          <p className="rcp-subtitle">Every sale gets a receipt number. Voided receipts keep their number.</p>
        </div>
      </header>

      {error && <div className="rcp-alert" role="alert">{error}</div>}

      <section className="rcp-cards" aria-label="Summary">
        <div className="rcp-card"><span>Total receipts</span><strong>{summary.count.toLocaleString()}</strong></div>
        <div className="rcp-card"><span>Total sales</span><strong>{peso(summary.sales)}</strong></div>
        <div className="rcp-card"><span>Amount collected</span><strong>{peso(summary.collected)}</strong></div>
        <div className={`rcp-card ${summary.outstanding > 0 ? 'is-alert' : ''}`}><span>Outstanding balance</span><strong>{peso(summary.outstanding)}</strong></div>
      </section>

      <section className="rcp-panel">
        <div className="rcp-presets" role="group" aria-label="Date range">
          {[
            ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'],
            ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom range'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={preset === value ? 'is-active' : ''} onClick={() => applyPreset(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="rcp-filters">
          {preset === 'custom' && (
            <>
              <label className="rcp-field"><span>From</span><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
              <label className="rcp-field"><span>To</span><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            </>
          )}
          <label className="rcp-field rcp-field-wide"><span>Search</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt or reference number" /></label>
          <label className="rcp-field"><span>Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name" /></label>
          <label className="rcp-field"><span>Payment</span>
            <select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">All</option><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="UNPAID">Unpaid</option>
            </select>
          </label>
          <label className="rcp-field"><span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="COMPLETED">Completed</option><option value="VOIDED">Voided</option>
            </select>
          </label>
          <label className="rcp-field"><span>Recorded by</span><input value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} placeholder="Username" /></label>
        </div>

        <div className="rcp-table-wrap">
          <table className="rcp-table">
            <thead>
              <tr>
                <th>Receipt no.</th><th>Date</th><th>Customer</th><th className="num">Items</th><th className="num">Qty</th>
                <th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Payment</th>
                <th>Recorded by</th><th>Status</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={12} className="rcp-empty-cell">No receipts in this range.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className={r.status === 'VOIDED' ? 'is-voided' : ''}>
                  <td><span className="rcp-code">{r.receiptNo}</span></td>
                  <td className="rcp-nowrap">{r.date}</td>
                  <td>{r.customer || 'Walk-in'}</td>
                  <td className="num">{r.itemCount}</td>
                  <td className="num">{r.quantity.toLocaleString()}</td>
                  <td className="num">{peso(r.total)}</td>
                  <td className="num">{peso(r.amountPaid)}</td>
                  <td className="num">{peso(r.balance)}</td>
                  <td><span className={`rcp-pay is-${r.paymentStatus.toLowerCase()}`}>{STATUS_LABELS[r.paymentStatus]}</span></td>
                  <td>{r.recordedBy}</td>
                  <td><span className={`rcp-status ${r.status === 'VOIDED' ? 'is-voided' : ''}`}>{r.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></td>
                  <td className="rcp-actions">
                    <button type="button" className="rcp-icon" title="View receipt" aria-label={`View ${r.receiptNo}`} onClick={() => openReceipt(r.id)}>
                      <i className="bx bx-show" aria-hidden="true"></i>
                    </button>
                    <button type="button" className="rcp-icon" title="Print or save as PDF" aria-label={`Print ${r.receiptNo}`} onClick={() => { openReceipt(r.id); window.setTimeout(printReceipt, 400); }}>
                      <i className="bx bx-printer" aria-hidden="true"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Receipt ${detail.receiptNo}` : 'Receipt'}
        footer={
          detail ? (
            <div className="rcp-modal-actions no-print">
              {isAdmin && detail.status === 'COMPLETED' && (
                <button type="button" className="rcp-btn is-danger" onClick={() => setVoidOpen(true)}>Void receipt</button>
              )}
              <div className="rcp-modal-right">
                <div className="rcp-seg" role="group" aria-label="Paper size">
                  <button type="button" className={format === 'a4' ? 'is-active' : ''} onClick={() => setFormat('a4')}>A4</button>
                  <button type="button" className={format === 'thermal' ? 'is-active' : ''} onClick={() => setFormat('thermal')}>80mm</button>
                </div>
                <button type="button" className="rcp-btn is-ghost" onClick={printReceipt}>
                  <i className="bx bx-printer" aria-hidden="true"></i> Print
                </button>
                <button type="button" className="rcp-btn is-primary" onClick={printReceipt} title="In the print dialog, choose Save as PDF">
                  <i className="bx bx-download" aria-hidden="true"></i> Download PDF
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {detail && <ReceiptDocument receipt={detail} format={format} />}
      </Modal>

      <Modal
        isOpen={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Void receipt"
        footer={
          <div className="rcp-modal-actions">
            <button type="button" className="rcp-btn is-ghost" onClick={() => setVoidOpen(false)}>Cancel</button>
            <button type="button" className="rcp-btn is-danger" onClick={submitVoid}>Void receipt</button>
          </div>
        }
      >
        <div className="rcp-form">
          <p className="rcp-muted">The stock returns to the shelf and the receipt stays in the list, marked as voided. Its number is not reused.</p>
          {voidError && <div className="rcp-alert" role="alert">{voidError}</div>}
          <label className="rcp-field"><span>Reason *</span><input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={255} /></label>
        </div>
      </Modal>
    </div>
  );
};

// The printable receipt. It uses only the saved sale record.
export const ReceiptDocument: React.FC<{ receipt: ReceiptDetail; format: 'a4' | 'thermal' }> = ({ receipt, format }) => (
  <div id="receipt-print" className={`rcp-doc is-${format}`}>
    <div className="rcp-doc-head">
      <div className="rcp-brand">{COMPANY.name}</div>
      <div className="rcp-brand-sub">{COMPANY.tagline}</div>
      <div className="rcp-doc-small">{COMPANY.address}</div>
      <div className="rcp-doc-small">{COMPANY.contact}</div>
    </div>
    <div className="rcp-doc-title">SALES RECEIPT</div>
    {receipt.status === 'VOIDED' && <div className="rcp-void-stamp">VOIDED — {receipt.voidReason}</div>}
    <dl className="rcp-doc-meta">
      <div><dt>Receipt no.</dt><dd>{receipt.receiptNo}</dd></div>
      <div><dt>Reference</dt><dd>{receipt.reference}</dd></div>
      <div><dt>Date &amp; time</dt><dd>{receipt.date} {receipt.time.slice(11, 16)}</dd></div>
      <div><dt>Customer</dt><dd>{receipt.customer.name || 'Walk-in'}</dd></div>
      {receipt.customer.contact && <div><dt>Contact</dt><dd>{receipt.customer.contact}</dd></div>}
      {receipt.customer.address && <div><dt>Address</dt><dd>{receipt.customer.address}</dd></div>}
      <div><dt>Recorded by</dt><dd>{receipt.recordedBy}</dd></div>
    </dl>
    <table className="rcp-doc-table">
      <thead>
        <tr><th>Item</th>{format === 'a4' && <th>Part no.</th>}<th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr>
      </thead>
      <tbody>
        {receipt.lines.map((l) => (
          <tr key={l.id}>
            <td>{l.itemName}</td>
            {format === 'a4' && <td>{l.partNumber || '—'}</td>}
            <td className="num">{l.quantity}</td>
            <td className="num">{peso(l.unitPrice)}</td>
            <td className="num">{peso(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <dl className="rcp-doc-totals">
      <div><dt>Subtotal</dt><dd>{peso(receipt.subtotal)}</dd></div>
      {receipt.discount > 0 && <div><dt>Discount</dt><dd>−{peso(receipt.discount)}</dd></div>}
      {receipt.otherCharges > 0 && <div><dt>Other charges</dt><dd>{peso(receipt.otherCharges)}</dd></div>}
      <div className="is-total"><dt>Total amount</dt><dd>{peso(receipt.total)}</dd></div>
      <div><dt>Amount paid</dt><dd>{peso(receipt.amountPaid)}</dd></div>
      <div><dt>Remaining balance</dt><dd>{peso(receipt.balance)}</dd></div>
      <div><dt>Payment method</dt><dd>{PAYMENT_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}</dd></div>
      <div><dt>Payment status</dt><dd>{STATUS_LABELS[receipt.paymentStatus] ?? receipt.paymentStatus}</dd></div>
    </dl>
    <div className="rcp-doc-foot">Thank you for your purchase.</div>
    {format === 'a4' && (
      <div className="rcp-signatures">
        <div>Prepared by</div><div>Received by</div>
      </div>
    )}
  </div>
);
