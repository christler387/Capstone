import React, { useEffect, useMemo, useState } from 'react';
import { Item, Movement, UserRole } from '../types';
import { getRop } from '../inventoryMetrics';
import { apiRequest } from '../apiClient';
import { Modal } from './Modal';

interface StockCardProps {
  inventory: Item[];
  movements: Movement[];
  selectedItemId?: string;
  onSelectItem: (id: string) => void;
  onItemRenamed?: (newId: string) => void;
  userRole: UserRole;
}

interface LedgerRow {
  id: string;
  date: string;
  time: string;
  reference: string;
  type: string;
  description: string;
  supplierId: number | null;
  qtyIn: number;
  qtyOut: number;
  balance: number;
  recordedBy: string;
}

interface StockCardResponse {
  item: Item;
  summary: { beginning: number; totalIn: number; totalOut: number; adjustments: number; balance: number };
  rows: LedgerRow[];
  types: string[];
}

interface ItemSupplier {
  id: number;
  supplierId: number;
  itemId: string;
  supplierItemCode: string;
  purchasePrice: number | null;
  notes: string;
  supplierName: string;
  supplierCode: string;
  supplierActive: boolean;
}

interface SupplierOption {
  id: number;
  supplierId: string;
  name: string;
  isActive: boolean;
}

export const TXN_LABELS: Record<string, string> = {
  BEGINNING_BALANCE: 'Beginning Balance',
  STOCK_IN: 'Stock In',
  STOCK_OUT: 'Stock Out',
  PURCHASE_RETURN: 'Purchase Return',
  CUSTOMER_RETURN: 'Customer Return',
  STOCK_ADJUSTMENT: 'Stock Adjustment',
  DAMAGED_ITEMS: 'Damaged Items',
  INVENTORY_CORRECTION: 'Inventory Correction',
};

const formatPeso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDateTime = (value: string) => value.slice(0, 16).replace(' ', ' · ');

export const StockCard: React.FC<StockCardProps> = ({ inventory, movements, selectedItemId, onSelectItem, onItemRenamed, userRole }) => {
  const isAdmin = userRole === 'admin';
  const [itemSearch, setItemSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [reference, setReference] = useState('');
  const [card, setCard] = useState<StockCardResponse | null>(null);
  const [links, setLinks] = useState<ItemSupplier[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linkEditing, setLinkEditing] = useState<ItemSupplier | null>(null);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ supplierId: '', supplierItemCode: '' });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSaving, setLinkSaving] = useState(false);

  const item = inventory.find((i) => i.id === selectedItemId);

  useEffect(() => {
    apiRequest<SupplierOption[]>('/suppliers').then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    if (!selectedItemId) {
      setCard(null);
      setLinks([]);
      return;
    }
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (type) params.set('type', type);
    if (reference.trim()) params.set('q', reference.trim());
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiRequest<StockCardResponse>(`/items/${encodeURIComponent(selectedItemId)}/stock-card?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setCard(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId, from, to, type, reference]);

  const loadLinks = () => {
    if (!selectedItemId) return;
    apiRequest<ItemSupplier[]>(`/items/${encodeURIComponent(selectedItemId)}/suppliers`)
      .then(setLinks)
      .catch(() => setLinks([]));
  };

  useEffect(loadLinks, [selectedItemId]);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const reorderLevel = item ? Math.ceil(getRop(item, movements)) : 0;

  const suggestions = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    if (!query) return [];
    return inventory
      .filter((i) => `${i.id} ${i.name} ${i.barcode ?? ''}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [itemSearch, inventory]);

  const openLinkModal = (link?: ItemSupplier) => {
    setLinkEditing(link ?? null);
    setLinkError(null);
    setLinkForm({ supplierId: link ? String(link.supplierId) : '', supplierItemCode: link?.supplierItemCode ?? '' });
    setIsLinkOpen(true);
  };

  // The next free code for a supplier (VIS0001, VIS0002 …), filled in for a new link.
  const fillNextCode = (supplierId: string | number, setCode: (code: string) => void) =>
    apiRequest<{ code: string }>(`/suppliers/${supplierId}/next-code`)
      .then((r) => setCode(r.code))
      .catch(() => undefined);

  const useCodeAsItemId = async (link: ItemSupplier) => {
    if (!selectedItemId) return;
    if (!window.confirm(`Change the Item ID from ${selectedItemId} to ${link.supplierItemCode}? All stock history moves with it.`)) return;
    try {
      const result = await apiRequest<{ id: string }>(`/items/${encodeURIComponent(selectedItemId)}/use-supplier-code`, {
        method: 'POST',
        body: JSON.stringify({ newId: link.supplierItemCode }),
      });
      onItemRenamed?.(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the Item ID.');
    }
  };

  const saveLink = async () => {
    if (!selectedItemId) return;
    setLinkError(null);
    const code = linkForm.supplierItemCode.trim();
    if (!linkEditing && !linkForm.supplierId) {
      setLinkError('Choose a supplier.');
      return;
    }
    if (!code) {
      setLinkError("Enter the supplier's item code.");
      return;
    }
    setLinkSaving(true);
    try {
      if (linkEditing) {
        await apiRequest(`/supplier-items/${linkEditing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ supplierItemCode: code }),
        });
      } else {
        const saved = await apiRequest<{ itemId: string; renamed: boolean; note: string | null }>(`/suppliers/${linkForm.supplierId}/items`, {
          method: 'POST',
          body: JSON.stringify({ itemId: selectedItemId, supplierItemCode: code }),
        });
        if (saved.note) window.alert(saved.note);
        if (saved.renamed) {
          setIsLinkOpen(false);
          onItemRenamed?.(saved.itemId);
          return;
        }
      }
      setIsLinkOpen(false);
      loadLinks();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not save the supplier link.');
    } finally {
      setLinkSaving(false);
    }
  };

  const removeLink = async (link: ItemSupplier) => {
    if (!window.confirm(`Remove ${link.supplierName} from this item? The item and its stock card stay.`)) return;
    try {
      await apiRequest(`/supplier-items/${link.id}`, { method: 'DELETE' });
      loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the supplier link.');
    }
  };

  const exportCsv = () => {
    if (!card) return;
    const header = ['Date', 'Time', 'Reference', 'Type', 'Description', 'Supplier', 'Qty In', 'Qty Out', 'Balance', 'Recorded By'];
    const lines = card.rows.map((r) => {
      const supplier = r.supplierId ? supplierById.get(r.supplierId)?.name ?? '' : '';
      return [r.date, r.time.slice(11), r.reference, TXN_LABELS[r.type] ?? r.type, r.description, supplier, r.qtyIn, r.qtyOut, r.balance, r.recordedBy];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-card-${card.item.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printCard = () => {
    document.body.classList.add('printing-stock-card');
    window.print();
    window.setTimeout(() => document.body.classList.remove('printing-stock-card'), 300);
  };

  const clearFilters = () => {
    setFrom('');
    setTo('');
    setType('');
    setReference('');
  };
  const hasFilters = Boolean(from || to || type || reference);

  return (
    <div className="content-section sc">
      <header className="sc-page-head">
        <div>
          <h2 className="sc-title">Stock card</h2>
          <p className="sc-subtitle">Every stock movement for one item, with the running balance.</p>
        </div>
      </header>

      <section className="sc-picker">
        <label className="sc-label" htmlFor="sc-item-search">Item</label>
        {item ? (
          <div className="sc-picked">
            <span className="sc-picked-name">{item.name}</span>
            <span className="sc-picked-meta">{item.id} · {item.category || 'No category'} · BC {item.barcode || '---'}</span>
            <button type="button" className="sc-btn is-ghost" onClick={() => { onSelectItem(''); setItemSearch(''); }}>
              Change item
            </button>
          </div>
        ) : (
          <div className="sc-search">
            <i className="bx bx-search" aria-hidden="true"></i>
            <input
              id="sc-item-search"
              type="search"
              placeholder="Type an item ID, name or barcode"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              autoComplete="off"
            />
            {itemSearch.trim() && (
              <div className="sc-suggest" role="listbox">
                {suggestions.length === 0 && <p className="sc-suggest-empty">No matching items.</p>}
                {suggestions.map((i) => (
                  <button type="button" key={i.id} className="sc-suggest-row" onClick={() => onSelectItem(i.id)}>
                    <span className="sc-code">{i.id}</span>
                    <span>{i.name}</span>
                    <span className="sc-muted">{i.quantity.toLocaleString()} on hand</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {!item && <div className="sc-empty">Choose an item to see its stock card.</div>}

      {item && card && (
        <div id="sc-print-area" className="sc-print">
          <div className="sc-toolbar no-print">
            <span className="sc-muted">{loading ? 'Updating…' : `${card.rows.length.toLocaleString()} line(s) shown`}</span>
            <div className="sc-toolbar-actions">
              <button type="button" className="sc-btn is-ghost" onClick={printCard}>
                <i className="bx bx-printer" aria-hidden="true"></i> Print
              </button>
              <button type="button" className="sc-btn is-primary" onClick={exportCsv}>
                <i className="bx bx-download" aria-hidden="true"></i> Export to Excel (CSV)
              </button>
            </div>
          </div>

          <div className="sc-print-head">
            <strong>{card.item.name}</strong>
            <span>{card.item.id} · {card.item.category || '—'} · BC {card.item.barcode || '—'} · Reorder level {reorderLevel.toLocaleString()}</span>
          </div>

          <div className="sc-summary">
            <div className="sc-stat"><span>Beginning balance</span><strong>{card.summary.beginning.toLocaleString()}</strong></div>
            <div className="sc-stat"><span>Total stock in</span><strong>{card.summary.totalIn.toLocaleString()}</strong></div>
            <div className="sc-stat"><span>Total stock out</span><strong>{card.summary.totalOut.toLocaleString()}</strong></div>
            <div className="sc-stat"><span>Adjustments</span><strong>{card.summary.adjustments.toLocaleString()}</strong></div>
            <div className="sc-stat is-current"><span>Current balance</span><strong>{card.summary.balance.toLocaleString()}</strong></div>
            <div className={`sc-stat ${card.summary.balance < reorderLevel ? 'is-alert' : ''}`}>
              <span>Reorder level</span>
              <strong>{reorderLevel.toLocaleString()}</strong>
            </div>
          </div>

          <section className="sc-card">
            <div className="sc-card-head">
              <h3>Supplier information</h3>
              {isAdmin && (
                <button type="button" className="sc-btn is-ghost no-print" onClick={() => openLinkModal()}>
                  <i className="bx bx-plus" aria-hidden="true"></i> Link supplier
                </button>
              )}
            </div>
            {links.length === 0 ? (
              <p className="sc-muted sc-pad">No supplier linked. Supplier is optional; the item works without one.</p>
            ) : (
              <div className="sc-table-wrap">
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Supplier code</th>
                      {isAdmin && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id}>
                        <td>
                          <span className="sc-strong">{link.supplierName}</span>
                          <span className="sc-muted sc-small">{link.supplierCode}{link.supplierActive ? '' : ' · inactive'}</span>
                        </td>
                        <td><span className="sc-code">{link.supplierItemCode}</span></td>
                        {isAdmin && (
                          <td className="sc-actions no-print">
                            {link.supplierItemCode !== card.item.id && (
                              <button type="button" className="sc-btn is-ghost" onClick={() => useCodeAsItemId(link)}>
                                Use as Item ID
                              </button>
                            )}
                            <button type="button" className="sc-icon" aria-label={`Edit link to ${link.supplierName}`} onClick={() => openLinkModal(link)}>
                              <i className="bx bx-edit-alt" aria-hidden="true"></i>
                            </button>
                            <button type="button" className="sc-icon is-danger" aria-label={`Remove ${link.supplierName}`} onClick={() => removeLink(link)}>
                              <i className="bx bx-trash" aria-hidden="true"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="sc-filters no-print">
            <label className="sc-field">
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="sc-field">
              <span>To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="sc-field">
              <span>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {card.types.map((t) => (
                  <option key={t} value={t}>{TXN_LABELS[t] ?? t}</option>
                ))}
              </select>
            </label>
            <label className="sc-field sc-field-wide">
              <span>Reference</span>
              <input type="search" placeholder="Search by reference number" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            {hasFilters && (
              <button type="button" className="sc-btn is-ghost" onClick={clearFilters}>Clear filters</button>
            )}
          </div>

          {error && <div className="sc-alert" role="alert">{error}</div>}

          <section className="sc-card">
            <div className="sc-table-wrap">
              <table className="sc-table sc-ledger">
                <thead>
                  <tr>
                    <th>Date &amp; time</th>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Supplier</th>
                    <th className="num">Qty in</th>
                    <th className="num">Qty out</th>
                    <th className="num">Balance</th>
                    <th>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {card.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="sc-empty-cell">No stock movements match these filters.</td>
                    </tr>
                  )}
                  {card.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="sc-nowrap">{formatDateTime(r.time)}</td>
                      <td><span className="sc-code">{r.reference}</span></td>
                      <td><span className={`sc-type is-${r.type.toLowerCase().replace(/_/g, '-')}`}>{TXN_LABELS[r.type] ?? r.type}</span></td>
                      <td>{r.description || '—'}</td>
                      <td>{r.supplierId ? supplierById.get(r.supplierId)?.name ?? '—' : '—'}</td>
                      <td className="num">{r.qtyIn ? r.qtyIn.toLocaleString() : '—'}</td>
                      <td className="num">{r.qtyOut ? r.qtyOut.toLocaleString() : '—'}</td>
                      <td className="num sc-strong">{r.balance.toLocaleString()}</td>
                      <td>{r.recordedBy || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <Modal
        isOpen={isLinkOpen}
        onClose={() => setIsLinkOpen(false)}
        title={linkEditing ? 'Edit supplier link' : 'Link a supplier'}
        footer={
          <div className="sc-modal-actions">
            <button type="button" className="sc-btn is-ghost" onClick={() => setIsLinkOpen(false)} disabled={linkSaving}>Cancel</button>
            <button type="button" className="sc-btn is-primary" onClick={saveLink} disabled={linkSaving}>
              {linkSaving ? 'Saving…' : 'Save link'}
            </button>
          </div>
        }
      >
        <div className="sc-form">
          {linkError && <div className="sc-alert" role="alert">{linkError}</div>}
          <label className="sc-field">
            <span>Supplier</span>
            <select
              value={linkForm.supplierId}
              disabled={Boolean(linkEditing)}
              onChange={(e) => {
                const supplierId = e.target.value;
                setLinkForm((f) => ({ ...f, supplierId }));
                if (supplierId) void fillNextCode(supplierId, (code) => setLinkForm((f) => ({ ...f, supplierItemCode: code })));
              }}
            >
              <option value="">Choose a supplier</option>
              {suppliers
                .filter((s) => s.isActive || String(s.id) === linkForm.supplierId)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.supplierId})</option>
                ))}
            </select>
          </label>
          <label className="sc-field">
            <span>Supplier's item code</span>
            <input value={linkForm.supplierItemCode} onChange={(e) => setLinkForm((f) => ({ ...f, supplierItemCode: e.target.value }))} placeholder="e.g. VIS0001" />
          </label>
        </div>
      </Modal>
    </div>
  );
};
