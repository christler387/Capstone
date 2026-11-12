import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserRole } from '../types';
import { apiRequest } from '../apiClient';

interface InvoiceRow {
  reference: string;
  supplier: string;
  supplierId: number | null;
  date: string;
  lastRecorded: string;
  lineCount: number;
  totalQty: number;
  recordedBy: string;
}

interface InvoiceLine {
  id: string;
  itemId: string;
  itemName: string;
  partNumber: string;
  unit: string;
  qty: number;
  time: string;
  recordedBy: string;
}

interface InvoiceDetail {
  reference: string;
  supplier: string;
  supplierId: number | null;
  date: string;
  lines: InvoiceLine[];
}

interface StockInHistoryPageProps {
  userRole: UserRole;
  onAddItemsToInvoice: (invoice: string, supplierId: string) => void;
}

const isoDate = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

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

const invoiceLabel = (reference: string) => reference || 'No invoice';

export const StockInHistoryPage: React.FC<StockInHistoryPageProps> = ({ userRole, onAddItemsToInvoice }) => {
  const isAdmin = userRole === 'admin';
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(rangeFor('month'));
  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (search.trim()) params.set('q', search.trim());
    apiRequest<InvoiceRow[]>(`/stock-in/invoices?${params}`)
      .then((data) => { setInvoices(data); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [range.from, range.to, search, refreshKey]);

  const summary = useMemo(() => ({
    invoices: invoices.length,
    items: invoices.reduce((sum, i) => sum + i.lineCount, 0),
    units: invoices.reduce((sum, i) => sum + i.totalQty, 0),
    suppliers: new Set(invoices.map((i) => i.supplier).filter(Boolean)).size,
  }), [invoices]);

  const applyPreset = (value: string) => {
    setPreset(value);
    if (value !== 'custom') setRange(rangeFor(value));
  };

  return (
    <div className="content-section sal sih">
      <header className="sal-head">
        <div>
          <h2 className="sal-title">Stock in history</h2>
          <p className="sal-subtitle">Goods received from suppliers, grouped by invoice. Click an invoice to see its items.</p>
        </div>
      </header>

      {error && <div className="sal-alert" role="alert">{error}</div>}

      <section className="sal-cards" aria-label="Summary">
        <div className="sal-card is-featured">
          <span className="sal-card-label">Invoices</span>
          <strong className="sal-card-value">{summary.invoices.toLocaleString()}</strong>
          <span className="sal-card-sub">In the selected range</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Items received</span>
          <strong className="sal-card-value">{summary.items.toLocaleString()}</strong>
          <span className="sal-card-sub">Item lines across all invoices</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Units received</span>
          <strong className="sal-card-value">{summary.units.toLocaleString()}</strong>
          <span className="sal-card-sub">Total quantity</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Suppliers</span>
          <strong className="sal-card-value">{summary.suppliers.toLocaleString()}</strong>
          <span className="sal-card-sub">Named on these invoices</span>
        </div>
      </section>

      <section className="sal-card-wide">
        <div className="sal-block-head">
          <h3>Invoices</h3>
          <div className="sal-controls">
            <div className="sal-segment" role="group" aria-label="Date range">
              {[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom']].map(([value, label]) => (
                <button key={value} type="button" className={preset === value ? 'is-active' : ''} onClick={() => applyPreset(value)}>
                  {label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <>
                <label className="sal-field"><span>From</span><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
                <label className="sal-field"><span>To</span><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
              </>
            )}
          </div>
        </div>

        <div className="sal-filters">
          <label className="sal-field sal-field-wide">
            <span>Search</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, item or supplier" />
          </label>
        </div>

        <div className="sal-table-wrap">
          <table className="sal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Supplier</th>
                <th className="num">Items</th>
                <th className="num">Units</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="sal-empty-cell">No stock-in invoices in this range.</td></tr>
              )}
              {invoices.map((inv) => (
                <tr
                  key={inv.reference || '(none)'}
                  className="sih-row"
                  tabIndex={0}
                  onClick={() => setOpenInvoice(inv.reference)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpenInvoice(inv.reference); }}
                >
                  <td className="sal-nowrap">{inv.date}</td>
                  <td><span className="sal-code">{invoiceLabel(inv.reference)}</span></td>
                  <td>{inv.supplier || '—'}</td>
                  <td className="num">{inv.lineCount}</td>
                  <td className="num">{inv.totalQty.toLocaleString()}</td>
                  <td>{inv.recordedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openInvoice !== null && (
        <InvoiceModal
          reference={openInvoice}
          isAdmin={isAdmin}
          onClose={() => setOpenInvoice(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
          onAddItems={(detail) => {
            setOpenInvoice(null);
            onAddItemsToInvoice(detail.reference, detail.supplierId ? String(detail.supplierId) : '');
          }}
        />
      )}
    </div>
  );
};

// One invoice and its items. Only an admin can change a quantity, and only after clicking Edit on that line.
export const InvoiceModal: React.FC<{
  reference: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
  onAddItems: (detail: InvoiceDetail) => void;
}> = ({ reference, isAdmin, onClose, onChanged, onAddItems }) => {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiRequest<InvoiceDetail>(`/stock-in/invoice?ref=${encodeURIComponent(reference)}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    load();
  }, [reference]);

  const saveLine = async (line: InvoiceLine) => {
    setError(null);
    const qty = Number(editQty);
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Quantity must be a whole number of at least 1.');
      return;
    }
    try {
      await apiRequest(`/stock-in/lines/${encodeURIComponent(line.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty }),
      });
      setEditingId(null);
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      onChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the quantity.');
    }
  };

  const units = detail ? detail.lines.reduce((sum, l) => sum + l.qty, 0) : 0;

  const dialog = (
    <div className="sin-overlay" role="dialog" aria-modal="true" aria-label={`Invoice ${invoiceLabel(reference)}`} onClick={onClose}>
      <div className="sin-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sin-dialog-head">
          <div>
            <span className="sin-kicker">Invoice</span>
            <h3>{invoiceLabel(reference)}</h3>
            <p className="sin-muted">{detail?.supplier || 'No supplier'}{detail?.date ? ` · ${detail.date}` : ''}</p>
          </div>
          <button type="button" className="sin-close" aria-label="Close" onClick={onClose}>
            <i className="bx bx-x" aria-hidden="true"></i>
          </button>
        </div>

        {error && <div className="sin-alert" role="alert">{error}</div>}

        <div className="stk-table-wrap">
          <table className="stk-table">
            <thead>
              <tr>
                <th className="sin-col-item">Item</th>
                <th className="num sin-col-qty">Qty</th>
                <th className="sin-col-time">Time</th>
                <th className="sin-col-by">Recorded by</th>
                <th className="sin-col-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {detail?.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="stk-item-name">{line.itemName}</span>
                    <span className="stk-item-meta">{line.itemId}{line.partNumber ? ` · ${line.partNumber}` : ''}</span>
                  </td>
                  <td className="num">
                    {editingId === line.id ? (
                      <input
                        className="stk-qty sin-qty"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                        aria-label={`New quantity for ${line.itemName}`}
                      />
                    ) : (
                      <>{line.qty.toLocaleString()} <span className="inv-uom">{line.unit}</span></>
                    )}
                  </td>
                  <td>{line.time}</td>
                  <td>{line.recordedBy || '—'}</td>
                  <td className="sin-actions">
                    {isAdmin && editingId !== line.id && (
                      <button type="button" className="sin-btn is-ghost" onClick={() => { setEditingId(line.id); setEditQty(String(line.qty)); }}>Edit</button>
                    )}
                    {isAdmin && editingId === line.id && (
                      <>
                        <button type="button" className="sin-btn is-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                        <button type="button" className="sin-btn is-primary" onClick={() => saveLine(line)}>Save</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {detail && detail.lines.length === 0 && (
                <tr><td colSpan={5} className="stk-empty">No items on this invoice.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sin-dialog-foot">
          <span className="sin-muted">{detail?.lines.length ?? 0} item(s) · {units.toLocaleString()} unit(s)</span>
          <div className="sin-foot-actions">
            {detail && reference && (
              <button type="button" className="sin-btn is-primary" onClick={() => onAddItems(detail)}>
                Add items to this invoice
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
};
