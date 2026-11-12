import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../apiClient';

export interface ChangeRequest {
  id: string;
  type: 'STOCK_IN_EDIT' | 'STOCK_IN_DELETE' | 'INVOICE_DELETE' | 'PRICE_CHANGE';
  invoice: string;
  itemId: string;
  itemName: string;
  oldValue: number | null;
  newValue: number | null;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: string;
  decidedAt: string;
  note: string;
}

const TYPE_LABELS: Record<ChangeRequest['type'], string> = {
  STOCK_IN_EDIT: 'Edit quantity',
  STOCK_IN_DELETE: 'Delete line',
  INVOICE_DELETE: 'Delete invoice',
  PRICE_CHANGE: 'Price change',
};

const STATUS_LABELS: Record<ChangeRequest['status'], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// Edit and delete requests for stock-in invoices. Opened as a pop-out from the profile.
export const ChangeRequestsPage: React.FC = () => {
  const [role, setRole] = useState<'admin' | 'staff' | null>(null);
  const isAdmin = role === 'admin';
  const [view, setView] = useState<'pending' | 'audit'>('pending');
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiRequest<{ role: 'admin' | 'staff' }>('/me')
      .then((me) => setRole(me.role))
      .catch(() => setRole('staff'));
  }, []);

  useEffect(() => {
    if (role === null) return;
    const params = new URLSearchParams();
    if (view === 'pending') params.set('status', 'PENDING');
    else if (status) params.set('status', status);
    if (search.trim()) params.set('q', search.trim());
    apiRequest<ChangeRequest[]>(`/change-requests?${params}`)
      .then((data) => { setRequests(data); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [role, view, status, search, refreshKey]);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'PENDING').length, [requests]);

  const decide = async (request: ChangeRequest, approve: boolean) => {
    setError(null);
    try {
      if (approve) {
        if (!window.confirm(`Approve: ${TYPE_LABELS[request.type]} on ${request.invoice || 'no invoice'} (${request.itemName})?`)) return;
        await apiRequest(`/change-requests/${encodeURIComponent(request.id)}/approve`, { method: 'POST' });
        window.dispatchEvent(new CustomEvent('inventory-changed'));
      } else {
        const note = window.prompt('Reason for rejecting this request:');
        if (!note || !note.trim()) return;
        await apiRequest(`/change-requests/${encodeURIComponent(request.id)}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note: note.trim() }),
        });
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    }
  };

  const change = (r: ChangeRequest) => {
    if (r.type === 'STOCK_IN_EDIT') return `${r.oldValue ?? '—'} → ${r.newValue ?? '—'}`;
    if (r.type === 'PRICE_CHANGE') return `${r.oldValue?.toFixed(2) ?? '—'} → ${r.newValue?.toFixed(2) ?? '—'}`;
    return `${r.oldValue ?? '—'} removed`;
  };

  return (
    <div className="content-section req">
      <header className="req-head">
        <div>
          <span className="req-kicker">Administration</span>
          <h2 className="req-title">Requests</h2>
          <p className="req-subtitle">
            Changes to stock-in invoices by staff wait here for an admin. Every request and decision is kept.
          </p>
        </div>
        <div className="req-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'pending'} className={view === 'pending' ? 'is-active' : ''} onClick={() => setView('pending')}>
            Pending{view === 'pending' ? ` (${pendingCount})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={view === 'audit'} className={view === 'audit' ? 'is-active' : ''} onClick={() => setView('audit')}>
            Audit trail
          </button>
        </div>
      </header>

      {!isAdmin && (
        <div className="req-note" role="note">Your requests are listed here. An admin decides on them.</div>
      )}
      {error && <div className="req-alert" role="alert">{error}</div>}

      <section className="req-panel">
        <div className="req-filters">
          <label className="req-field req-field-wide"><span>Search</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, item, item ID or requester" />
          </label>
          {view === 'audit' && (
            <label className="req-field"><span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>
          )}
        </div>

        <div className="req-table-wrap">
          <table className="req-table">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Request</th>
                <th>Invoice</th>
                <th>Item</th>
                <th>Change</th>
                <th>Requested by</th>
                <th>Status</th>
                <th>Decided by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={9} className="req-empty-cell">{view === 'pending' ? 'No pending requests.' : 'No requests match these filters.'}</td></tr>
              )}
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="req-nowrap">{r.requestedAt}</td>
                  <td>{TYPE_LABELS[r.type]}</td>
                  <td><span className="req-code">{r.invoice || 'No invoice'}</span></td>
                  <td><span className="req-strong">{r.itemName}</span><span className="req-muted">{r.itemId}</span></td>
                  <td className="req-nowrap">{change(r)}</td>
                  <td>{r.requestedBy}</td>
                  <td><span className={`req-status is-${r.status.toLowerCase()}`}>{STATUS_LABELS[r.status]}</span></td>
                  <td>
                    {r.decidedBy ? (
                      <><span>{r.decidedBy}</span><span className="req-muted req-small">{r.decidedAt}</span>{r.note && <span className="req-muted req-small">“{r.note}”</span>}</>
                    ) : '—'}
                  </td>
                  <td className="req-actions">
                    {isAdmin && r.status === 'PENDING' && (
                      <>
                        <button type="button" className="req-btn is-ghost" onClick={() => decide(r, false)}>Reject</button>
                        <button type="button" className="req-btn is-primary" onClick={() => decide(r, true)}>Approve</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
