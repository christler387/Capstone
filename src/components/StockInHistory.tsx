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
  // Staff have the same features as admins; edits and deletes are sent for approval.
  const isAdmin = true;
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(rangeFor('month'));
  const [search, setSearch] = useState('');
  const [item, setItem] = useState('');
  const [user, setUser] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; supplierId: string }[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiRequest<{ id: number; name: string; supplierId: string }[]>('/suppliers')
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (search.trim()) params.set('q', search.trim());
    if (item.trim()) params.set('item', item.trim());
    if (user.trim()) params.set('user', user.trim());
    if (supplierId) params.set('supplier', supplierId);
    apiRequest<InvoiceRow[]>(`/stock-in/invoices?${params}`)
      .then((data) => { setInvoices(data); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [range.from, range.to, search, item, user, supplierId, refreshKey]);

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
          </div>
        </div>

        <div className="sal-filters">
          <label className="sal-field"><span>From</span>
            <input type="date" value={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }); }} />
          </label>
          <label className="sal-field"><span>To</span>
            <input type="date" value={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }); }} />
          </label>
          <label className="sal-field"><span>Supplier</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>{sup.name} ({sup.supplierId})</option>
              ))}
            </select>
          </label>
          <label className="sal-field"><span>Item</span>
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item name or ID" />
          </label>
          <label className="sal-field"><span>Recorded by</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" />
          </label>
          <label className="sal-field sal-field-wide"><span>Search</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, item or supplier" />
          </label>
        </div>

        <p className="sal-total-line">
          Total for the selected range: <strong>{summary.invoices.toLocaleString()}</strong> invoice(s) ·{' '}
          <strong>{summary.items.toLocaleString()}</strong> item line(s) · <strong>{summary.units.toLocaleString()}</strong> unit(s)
        </p>

        <div className="sal-table-wrap">
          <table className="sal-table stack-phone">
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
                  <td className="sal-nowrap" data-label="Date">{inv.date}</td>
                  <td data-label="Invoice"><span className="sal-code">{invoiceLabel(inv.reference)}</span></td>
                  <td data-label="Supplier">{inv.supplier || '—'}</td>
                  <td className="num" data-label="Items">{inv.lineCount}</td>
                  <td className="num" data-label="Units">{inv.totalQty.toLocaleString()}</td>
                  <td data-label="Recorded by">{inv.recordedBy || '—'}</td>
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
  const [info, setInfo] = useState<string | null>(null);
  const [iAmAdmin, setIAmAdmin] = useState(false);

  useEffect(() => {
    apiRequest<{ role: string }>('/me')
      .then((me) => setIAmAdmin(me.role === 'admin'))
      .catch(() => setIAmAdmin(false));
  }, []);

  const load = () =>
    apiRequest<InvoiceDetail>(`/stock-in/invoice?ref=${encodeURIComponent(reference)}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));

  useEffect(() => {
    load();
  }, [reference]);

  const saveLine = async (line: InvoiceLine) => {
    setError(null);
    setInfo(null);
    const qty = Number(editQty);
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Quantity must be a whole number of at least 1.');
      return;
    }
    try {
      const result = await apiRequest<{ requested?: boolean }>(`/stock-in/lines/${encodeURIComponent(line.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty }),
      });
      setEditingId(null);
      if (result.requested) {
        setInfo(`Sent for approval: ${line.itemName} from ${line.qty} to ${qty}. Nothing changes until an admin approves it.`);
        onChanged();
        return;
      }
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      onChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the quantity.');
    }
  };

  // Admins only: removes the line and takes its stock back out.
  const deleteLine = async (line: InvoiceLine) => {
    if (!window.confirm(`Delete ${line.qty} ${line.itemName} from this invoice? The stock is taken back out.`)) return;
    setError(null);
    try {
      const result = await apiRequest<{ requested?: boolean } | undefined>(`/stock-in/lines/${encodeURIComponent(line.id)}`, { method: 'DELETE' });
      if (result?.requested) {
        setInfo('Sent for approval. Nothing changes until an admin approves it.');
        return;
      }
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      onChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the line.');
    }
  };

  // Undo reverses part or all of a line's stock and keeps it on the stock card. Staff send it for approval.
  const undoLine = async (line: InvoiceLine) => {
    const answer = window.prompt(`Units of ${line.itemName} to undo (1 to ${line.qty}):`, String(line.qty));
    if (answer === null) return;
    const qty = Number(answer);
    if (!Number.isInteger(qty) || qty < 1 || qty > line.qty) {
      setError(`Enter a whole number from 1 to ${line.qty}.`);
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const result = await apiRequest<{ requested?: boolean }>(`/movements/${encodeURIComponent(line.id)}/undo`, {
        method: 'PATCH',
        body: JSON.stringify({ qty }),
      });
      if (result?.requested) {
        setInfo(`Sent for approval: undo ${qty} ${line.itemName}. Nothing changes until an admin approves it.`);
        return;
      }
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      onChanged();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo the line.');
    }
  };

  // Admins only: removes every line on the invoice.
  const deleteInvoice = async () => {
    if (!window.confirm(`Delete the whole invoice ${invoiceLabel(reference)} and take all its stock back out?`)) return;
    setError(null);
    try {
      const result = await apiRequest<{ requested?: boolean } | undefined>(`/stock-in/invoice?ref=${encodeURIComponent(reference)}`, { method: 'DELETE' });
      if (result?.requested) {
        setInfo('Sent for approval. Nothing changes until an admin approves it.');
        return;
      }
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the invoice.');
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
        {info && <div className="sin-info" role="status">{info}</div>}

        <div className="stk-table-wrap">
          <table className="stk-table stack-phone">
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
                  <td data-label="Item">
                    <span className="stk-item-name">{line.itemName}</span>
                    <span className="stk-item-meta">{line.itemId}{line.partNumber ? ` · ${line.partNumber}` : ''}</span>
                  </td>
                  <td className="num" data-label="Qty">
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
                  <td data-label="Time">{line.time}</td>
                  <td data-label="Recorded by">{line.recordedBy || '—'}</td>
                  <td className="sin-actions" data-label="">
                    {isAdmin && editingId !== line.id && (
                      <button type="button" className="sin-btn is-ghost" onClick={() => { setEditingId(line.id); setEditQty(String(line.qty)); }}>
                        {iAmAdmin ? 'Edit' : 'Request edit'}
                      </button>
                    )}
                    {editingId !== line.id && (
                      <button type="button" className="sin-btn is-ghost" onClick={() => undoLine(line)}>
                        {iAmAdmin ? 'Undo' : 'Request undo'}
                      </button>
                    )}
                    {editingId !== line.id && (
                      <button type="button" className="sin-btn is-danger" onClick={() => deleteLine(line)}>
                        {iAmAdmin ? 'Delete' : 'Request delete'}
                      </button>
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
            {detail && detail.lines.length > 0 && (
              <button type="button" className="sin-btn is-danger" onClick={deleteInvoice}>
                {iAmAdmin ? 'Delete invoice' : 'Request invoice delete'}
              </button>
            )}
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
