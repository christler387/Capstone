import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Item, UserRole } from '../types';
import { apiRequest } from '../apiClient';
import { Modal } from './Modal';

interface SupplierRow {
  id: number;
  supplierId: string;
  name: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
  itemCount: number;
}

interface SupplierLink {
  id: number;
  supplierId: number;
  itemId: string;
  supplierItemCode: string;
  purchasePrice: number | null;
  notes: string;
  itemName: string;
  itemCategory: string;
  itemBarcode: string;
  itemPartNumber: string;
  itemQuantity: number;
  itemUnit: string;
}

interface SupplierDetail extends SupplierRow {
  items: SupplierLink[];
}

interface SuppliersProps {
  inventory: Item[];
  userRole: UserRole;
  onOpenStockCard: (itemId: string) => void;
  onItemRenamed?: (oldId: string, newId: string) => void;
}

const EMPTY_FORM = { name: '', contactPerson: '', contactNumber: '', email: '', address: '', notes: '' };
const formatPeso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Suppliers: React.FC<SuppliersProps> = ({ inventory, userRole, onOpenStockCard, onItemRenamed }) => {
  const isAdmin = userRole === 'admin';
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkEditing, setLinkEditing] = useState<SupplierLink | null>(null);
  const [linkForm, setLinkForm] = useState({ itemId: '', supplierItemCode: '' });
  const [itemSearch, setItemSearch] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  // The items list scrolls inside the card; the button in its header moves between the top and the bottom.
  const itemsScrollRef = useRef<HTMLDivElement>(null);
  const [itemsAtBottom, setItemsAtBottom] = useState(false);
  const scrollItems = () => {
    const el = itemsScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: itemsAtBottom ? 0 : el.scrollHeight, behavior: 'smooth' });
  };

  const loadSuppliers = () =>
    apiRequest<SupplierRow[]>('/suppliers')
      .then(setSuppliers)
      .catch((err: Error) => setError(err.message));

  const loadDetail = (id: number) =>
    apiRequest<SupplierDetail>(`/suppliers/${id}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));

  // Items that already have a supplier. One item can have only one, so these are not offered in the link form.
  const [linkedItemIds, setLinkedItemIds] = useState<Set<string>>(new Set());
  const loadLinkedItems = () =>
    apiRequest<Record<string, { count: number }>>('/supplier-links/counts')
      .then((counts) => setLinkedItemIds(new Set(Object.keys(counts))))
      .catch(() => setLinkedItemIds(new Set()));

  useEffect(() => {
    loadSuppliers();
    loadLinkedItems();
    window.addEventListener('supplier-links-changed', loadLinkedItems);
    return () => window.removeEventListener('supplier-links-changed', loadLinkedItems);
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      const matchesStatus = status === 'all' || (status === 'active' ? s.isActive : !s.isActive);
      const matchesQuery =
        !query || `${s.supplierId} ${s.name} ${s.contactPerson} ${s.email} ${s.contactNumber}`.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [suppliers, search, status]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = () => {
    if (!detail) return;
    setEditingId(detail.id);
    setForm({
      name: detail.name,
      contactPerson: detail.contactPerson,
      contactNumber: detail.contactNumber,
      email: detail.email,
      address: detail.address,
      notes: detail.notes,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const saveSupplier = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Supplier name is required.');
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    try {
      if (editingId === null) {
        const created = await apiRequest<{ id: number }>('/suppliers', { method: 'POST', body: JSON.stringify(form) });
        await loadSuppliers();
        setSelectedId(created.id);
      } else {
        await apiRequest(`/suppliers/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
        await loadSuppliers();
        await loadDetail(editingId);
      }
      setIsFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the supplier.');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!detail) return;
    const next = !detail.isActive;
    const verb = next ? 'activate' : 'deactivate';
    if (!window.confirm(`${verb[0].toUpperCase() + verb.slice(1)} ${detail.name}? ${next ? '' : 'It stays in records but will not be offered for new links.'}`)) return;
    try {
      await apiRequest(`/suppliers/${detail.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
      await loadSuppliers();
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.');
    }
  };

  // The next free code for a supplier (VIS0001, VIS0002 …), filled in for a new link.
  const fillNextCode = (supplierId: string | number, setCode: (code: string) => void) =>
    apiRequest<{ code: string }>(`/suppliers/${supplierId}/next-code`)
      .then((r) => setCode(r.code))
      .catch(() => undefined);

  const openLink = (link?: SupplierLink) => {
    setLinkEditing(link ?? null);
    setLinkError(null);
    setItemSearch('');
    setLinkForm({ itemId: link?.itemId ?? '', supplierItemCode: link?.supplierItemCode ?? '' });
    setIsLinkOpen(true);
    if (!link && detail) {
      void fillNextCode(detail.id, (code) => setLinkForm((f) => ({ ...f, supplierItemCode: f.supplierItemCode || code })));
    }
  };

  const saveLink = async () => {
    if (!detail) return;
    setLinkError(null);
    const code = linkForm.supplierItemCode.trim();
    if (!linkEditing && !linkForm.itemId) {
      setLinkError('Choose an inventory item.');
      return;
    }
    if (!code) {
      setLinkError("Enter the supplier's item code.");
      return;
    }
    try {
      if (linkEditing) {
        await apiRequest(`/supplier-items/${linkEditing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ supplierItemCode: code }),
        });
      } else {
        const saved = await apiRequest<{ itemId: string; renamed: boolean; note: string | null }>(`/suppliers/${detail.id}/items`, {
          method: 'POST',
          body: JSON.stringify({ itemId: linkForm.itemId, supplierItemCode: code }),
        });
        if (saved.note) window.alert(saved.note);
        if (saved.renamed) {
          setIsLinkOpen(false);
          onItemRenamed?.(linkForm.itemId, saved.itemId);
          void loadDetail(detail.id);
          void loadSuppliers();
          window.dispatchEvent(new Event('supplier-links-changed'));
          return;
        }
      }
      setIsLinkOpen(false);
      window.dispatchEvent(new Event('supplier-links-changed'));
      await Promise.all([loadDetail(detail.id), loadSuppliers()]);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not save the link.');
    }
  };

  const removeLink = async (link: SupplierLink) => {
    if (!detail) return;
    if (!window.confirm(`Remove ${link.itemName} from ${detail.name}? The inventory item is not deleted.`)) return;
    try {
      await apiRequest(`/supplier-items/${link.id}`, { method: 'DELETE' });
      window.dispatchEvent(new Event('supplier-links-changed'));
      await Promise.all([loadDetail(detail.id), loadSuppliers()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the link.');
    }
  };

  const linkableItems = useMemo(() => {
    const taken = linkedItemIds;
    const query = itemSearch.trim().toLowerCase();
    return inventory
      .filter((i) => !taken.has(i.id) || i.id === linkForm.itemId)
      .filter((i) => !query || `${i.id} ${i.name} ${i.barcode ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [inventory, linkedItemIds, itemSearch, linkForm.itemId]);

  return (
    <div className="content-section sup">
      <header className="sup-page-head">
        <div>
          <h2 className="sup-title">Suppliers</h2>
          <p className="sup-subtitle">Who you buy from, and the code each one uses for your items.</p>
        </div>
        {isAdmin && (
          <button type="button" className="sup-btn is-primary" onClick={openAdd}>
            <i className="bx bx-plus" aria-hidden="true"></i> Add supplier
          </button>
        )}
      </header>

      {error && <div className="sup-alert" role="alert">{error}</div>}

      <div className="sup-layout">
        <section className="sup-card sup-list">
          <div className="sup-list-tools">
            <div className="sup-search">
              <i className="bx bx-search" aria-hidden="true"></i>
              <input type="search" placeholder="Search by name, ID, contact or email" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="sup-segment" role="group" aria-label="Filter by status">
              {(['all', 'active', 'inactive'] as const).map((value) => (
                <button key={value} type="button" className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)}>
                  {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>
          <div className="sup-table-wrap">
            <table className="sup-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th className="num">Items</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="sup-empty-cell">
                      {suppliers.length === 0 ? 'No suppliers yet. Add your first supplier.' : 'No suppliers match your search.'}
                    </td>
                  </tr>
                )}
                {visible.map((s) => (
                  <tr key={s.id} className={selectedId === s.id ? 'is-selected' : ''} onClick={() => setSelectedId(s.id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(s.id); }}>
                    <td>
                      <span className="sup-strong">{s.name}</span>
                      <span className="sup-muted sup-small">{s.supplierId}</span>
                    </td>
                    <td>
                      <span>{s.contactPerson || '—'}</span>
                      <span className="sup-muted sup-small">{s.contactNumber || s.email || ''}</span>
                    </td>
                    <td className="num">{s.itemCount.toLocaleString()}</td>
                    <td><span className={`sup-status ${s.isActive ? 'is-active' : 'is-inactive'}`}>{s.isActive ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sup-card sup-detail">
          {!detail && <div className="sup-placeholder">Select a supplier to see its details and item codes.</div>}
          {detail && (
            <>
              <div className="sup-detail-head">
                <div>
                  <h3 className="sup-detail-name">{detail.name}</h3>
                  <span className="sup-muted sup-small">{detail.supplierId}</span>
                </div>
                <div className="sup-detail-actions">
                  <span className={`sup-status ${detail.isActive ? 'is-active' : 'is-inactive'}`}>{detail.isActive ? 'Active' : 'Inactive'}</span>
                  {isAdmin && (
                    <>
                      <button type="button" className="sup-btn is-ghost" onClick={openEdit}>
                        <i className="bx bx-edit-alt" aria-hidden="true"></i> Edit
                      </button>
                      <button type="button" className="sup-btn is-ghost" onClick={toggleStatus}>
                        {detail.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <dl className="sup-facts">
                <div><dt>Contact person</dt><dd>{detail.contactPerson || '—'}</dd></div>
                <div><dt>Contact number</dt><dd>{detail.contactNumber || '—'}</dd></div>
                <div><dt>Email</dt><dd>{detail.email || '—'}</dd></div>
                <div><dt>Business address</dt><dd>{detail.address || '—'}</dd></div>
                <div><dt>Notes</dt><dd>{detail.notes || '—'}</dd></div>
              </dl>

              <div className="sup-items-head">
                <h4>Items from this supplier <span className="sup-muted">({detail.items.length})</span></h4>
                <div className="sup-items-head-actions">
                  {detail.items.length > 4 && (
                    <button type="button" className="sup-btn is-ghost" onClick={scrollItems}>
                      <i className={`bx ${itemsAtBottom ? 'bx-up-arrow-alt' : 'bx-down-arrow-alt'}`} aria-hidden="true"></i>
                      {itemsAtBottom ? 'Back to top' : 'Scroll down'}
                    </button>
                  )}
                  {isAdmin && (
                  <button type="button" className="sup-btn is-ghost" onClick={() => openLink()}>
                    <i className="bx bx-link" aria-hidden="true"></i> Link item
                  </button>
                )}
                </div>
              </div>
              {detail.items.length === 0 ? (
                <p className="sup-muted sup-pad">No items linked yet.</p>
              ) : (
                <div
                  className="sup-table-wrap sup-items-scroll"
                  ref={itemsScrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    setItemsAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
                  }}
                >
                  <table className="sup-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Supplier code</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((link) => (
                        <tr key={link.id}>
                          <td>
                            <button type="button" className="sup-linkbtn" onClick={() => onOpenStockCard(link.itemId)}>{link.itemName}</button>
                            <span className="sup-muted sup-small">{link.itemId} · {link.itemQuantity.toLocaleString()} {link.itemUnit}</span>
                          </td>
                          <td><span className="sup-code">{link.supplierItemCode}</span></td>
                          <td className="sup-actions">
                            {isAdmin && (
                              <>
                                <button type="button" className="sup-icon" aria-label={`Edit ${link.itemName} link`} onClick={() => openLink(link)}>
                                  <i className="bx bx-edit-alt" aria-hidden="true"></i>
                                </button>
                                <button type="button" className="sup-icon is-danger" aria-label={`Remove ${link.itemName}`} onClick={() => removeLink(link)}>
                                  <i className="bx bx-unlink" aria-hidden="true"></i>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingId === null ? 'Add supplier' : 'Edit supplier'}
        footer={
          <div className="sup-modal-actions">
            <button type="button" className="sup-btn is-ghost" onClick={() => setIsFormOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="sup-btn is-primary" onClick={saveSupplier} disabled={saving}>
              {saving ? 'Saving…' : editingId === null ? 'Add supplier' : 'Save changes'}
            </button>
          </div>
        }
      >
        <div className="sup-form">
          {formError && <div className="sup-alert" role="alert">{formError}</div>}
          <label className="sup-field">
            <span>Supplier name *</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="sup-field-row">
            <label className="sup-field">
              <span>Contact person</span>
              <input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
            </label>
            <label className="sup-field">
              <span>Contact number</span>
              <input inputMode="tel" value={form.contactNumber} onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))} />
            </label>
          </div>
          <label className="sup-field">
            <span>Email address</span>
            <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
          <label className="sup-field">
            <span>Business address</span>
            <textarea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </label>
          <label className="sup-field">
            <span>Notes</span>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={isLinkOpen}
        onClose={() => setIsLinkOpen(false)}
        title={linkEditing ? 'Edit item link' : `Link an item to ${detail?.name ?? 'supplier'}`}
        footer={
          <div className="sup-modal-actions">
            <button type="button" className="sup-btn is-ghost" onClick={() => setIsLinkOpen(false)}>Cancel</button>
            <button type="button" className="sup-btn is-primary" onClick={saveLink}>Save link</button>
          </div>
        }
      >
        <div className="sup-form">
          {linkError && <div className="sup-alert" role="alert">{linkError}</div>}
          {!linkEditing && (
            <div className="sup-field">
              <span>Inventory item</span>
              <input type="search" placeholder="Search item by ID, name or barcode" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
              <div className="sup-pick-list" role="listbox" aria-label="Inventory items">
                {linkableItems.map((i) => (
                  <button
                    type="button"
                    key={i.id}
                    role="option"
                    aria-selected={linkForm.itemId === i.id}
                    className={`sup-pick-row ${linkForm.itemId === i.id ? 'is-selected' : ''}`}
                    onClick={() => setLinkForm((f) => ({ ...f, itemId: i.id }))}
                  >
                    <span className="sup-code">{i.id}</span>
                    <span>{i.name}</span>
                  </button>
                ))}
                {linkableItems.length === 0 && <p className="sup-muted sup-pad">No items match.</p>}
              </div>
            </div>
          )}
          <label className="sup-field">
            <span>This supplier's item code *</span>
            <input value={linkForm.supplierItemCode} onChange={(e) => setLinkForm((f) => ({ ...f, supplierItemCode: e.target.value }))} placeholder="e.g. VIS0001" />
          </label>
        </div>
      </Modal>
    </div>
  );
};
