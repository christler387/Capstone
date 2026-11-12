import React, { useEffect, useMemo, useState } from 'react';
import { UserRole } from '../types';
import { apiRequest } from '../apiClient';
import { askReason } from '../reasonPrompt';

interface PeriodTotals {
  sales: number;
  cogs: number;
  profit: number;
  units: number;
  margin: number;
}

interface Summary {
  today: PeriodTotals;
  yesterday: PeriodTotals;
  month: PeriodTotals;
  year: PeriodTotals;
  unrecordedStockOuts: number;
}

interface SeriesRow {
  period: string;
  sales: number;
  cogs: number;
  profit: number;
  units: number;
}

interface TopItem {
  itemId: string;
  itemName: string;
  units: number;
  sales: number;
  profit: number;
}

interface SaleRecord {
  id: string;
  date: string;
  time: string;
  reference: string;
  customer: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  totalCost: number;
  totalSales: number;
  grossProfit: number;
  recordedBy: string;
  status: 'COMPLETED' | 'VOIDED';
}

interface SalesProps {
  userRole: UserRole;
}

const peso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isoDate = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const daysAgo = (days: number) => isoDate(new Date(Date.now() - days * 86400000));

function change(today: number, yesterday: number): string {
  if (yesterday === 0) return today > 0 ? 'New today' : 'No sales yesterday';
  const pct = ((today - yesterday) / yesterday) * 100;
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs yesterday`;
}

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const Sales: React.FC<SalesProps> = ({ userRole }) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [granularity, setGranularity] = useState<'day' | 'month' | 'year'>('day');
  const [reportFrom, setReportFrom] = useState(daysAgo(30));
  const [reportTo, setReportTo] = useState(isoDate(new Date()));
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [history, setHistory] = useState<SaleRecord[]>([]);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [historyInfo, setHistoryInfo] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Staff see the sales reports too.
  const isAdmin = true;

  useEffect(() => {
    if (!isAdmin) return;
    apiRequest<Summary>('/sales/summary').then(setSummary).catch((err: Error) => setError(err.message));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const params = new URLSearchParams({ granularity, from: reportFrom, to: reportTo });
    apiRequest<SeriesRow[]>(`/sales/series?${params}`).then(setSeries).catch((err: Error) => setError(err.message));
    const top = new URLSearchParams({ from: reportFrom, to: reportTo });
    apiRequest<TopItem[]>(`/sales/top-items?${top}`).then(setTopItems).catch(() => setTopItems([]));
  }, [isAdmin, granularity, reportFrom, reportTo]);

  useEffect(() => {
    if (!isAdmin) return;
    const params = new URLSearchParams();
    if (historyFrom) params.set('from', historyFrom);
    if (historyTo) params.set('to', historyTo);
    if (itemFilter.trim()) params.set('item', itemFilter.trim());
    if (userFilter.trim()) params.set('user', userFilter.trim());
    if (search.trim()) params.set('q', search.trim());
    apiRequest<SaleRecord[]>(`/sales?${params}`).then(setHistory).catch((err: Error) => setError(err.message));
  }, [isAdmin, historyFrom, historyTo, itemFilter, userFilter, search, refreshKey]);

  const historyTotals = useMemo(
    () =>
      history.reduce(
        (sum, r) => (r.status === 'VOIDED' ? sum : {
          sales: sum.sales + r.totalSales,
          cost: sum.cost + r.totalCost,
          profit: sum.profit + r.grossProfit,
          units: sum.units + r.quantity,
        }),
        { sales: 0, cost: 0, profit: 0, units: 0 },
      ),
    [history],
  );

  // Undo returns the stock and marks the sale undone. Staff send it for approval.
  const undoSale = async (sale: SaleRecord) => {
    if (!window.confirm(`Undo the sale of ${sale.quantity} ${sale.itemName} on ${sale.reference}? The stock goes back on hand.`)) return;
    const reason = userRole === 'admin' ? '' : askReason(`undo the sale of ${sale.quantity} ${sale.itemName} on ${sale.reference}`);
    if (reason === null) return;
    setError(null);
    setHistoryInfo(null);
    try {
      const result = await apiRequest<{ requested?: boolean }>(`/sales/${encodeURIComponent(sale.id)}/undo`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      if (result.requested) {
        setHistoryInfo(`Sent for approval: undo of ${sale.reference}. Nothing changes until an admin approves it.`);
        return;
      }
      window.dispatchEvent(new CustomEvent('inventory-changed'));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo the sale.');
    }
  };

  if (!isAdmin) {
    return (
      <div className="content-section sal">
        <div className="sal-placeholder">Sales and profit reports are for administrators.</div>
      </div>
    );
  }

  const maxSales = Math.max(1, ...series.map((r) => r.sales));

  return (
    <div className="content-section sal">
      <header className="sal-head">
        <div>
          <h2 className="sal-title">Sales &amp; profit</h2>
          <p className="sal-subtitle">Completed stock-out sales, with the cost and selling price saved on each sale.</p>
        </div>
      </header>

      {error && <div className="sal-alert" role="alert">{error}</div>}
      {summary && summary.unrecordedStockOuts > 0 && (
        <div className="sal-note" role="note">
          {summary.unrecordedStockOuts.toLocaleString()} stock-out record(s) from before sales tracking have no selling price.
          They are not included in these totals and are not counted as zero profit.
        </div>
      )}

      <section className="sal-cards" aria-label="Summary">
        <div className="sal-card is-featured">
          <span className="sal-card-label">Sales today</span>
          <strong className="sal-card-value">{peso(summary?.today.sales ?? 0)}</strong>
          <span className="sal-card-sub">{summary?.today.units ?? 0} unit(s) sold · {summary ? change(summary.today.sales, summary.yesterday.sales) : ''}</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Gross profit today</span>
          <strong className="sal-card-value">{peso(summary?.today.profit ?? 0)}</strong>
          <span className="sal-card-sub">Margin {(summary?.today.margin ?? 0).toFixed(1)}%</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Sales this month</span>
          <strong className="sal-card-value">{peso(summary?.month.sales ?? 0)}</strong>
          <span className="sal-card-sub">{summary?.month.units ?? 0} unit(s) sold</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Gross profit this month</span>
          <strong className="sal-card-value">{peso(summary?.month.profit ?? 0)}</strong>
          <span className="sal-card-sub">Margin {(summary?.month.margin ?? 0).toFixed(1)}%</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Sales this year</span>
          <strong className="sal-card-value">{peso(summary?.year.sales ?? 0)}</strong>
          <span className="sal-card-sub">Cost of goods sold {peso(summary?.year.cogs ?? 0)}</span>
        </div>
        <div className="sal-card">
          <span className="sal-card-label">Gross profit this year</span>
          <strong className="sal-card-value">{peso(summary?.year.profit ?? 0)}</strong>
          <span className="sal-card-sub">{summary?.year.units ?? 0} unit(s) sold · margin {(summary?.year.margin ?? 0).toFixed(1)}%</span>
        </div>
      </section>

      <section className="sal-card-wide">
        <div className="sal-block-head">
          <h3>Sales report</h3>
          <div className="sal-controls">
            <div className="sal-segment" role="group" aria-label="Period">
              {(['day', 'month', 'year'] as const).map((g) => (
                <button key={g} type="button" className={granularity === g ? 'is-active' : ''} onClick={() => setGranularity(g)}>
                  {g === 'day' ? 'Daily' : g === 'month' ? 'Monthly' : 'Annually'}
                </button>
              ))}
            </div>
            <label className="sal-field"><span>From</span><input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} /></label>
            <label className="sal-field"><span>To</span><input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} /></label>
          </div>
        </div>
        <div className="sal-table-wrap">
          <table className="sal-table stack-phone">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Units</th>
                <th className="num">Sales</th>
                <th className="num">Cost of goods</th>
                <th className="num">Gross profit</th>
                <th>Sales bar</th>
              </tr>
            </thead>
            <tbody>
              {series.length === 0 && <tr><td colSpan={6} className="sal-empty-cell">No sales in this period.</td></tr>}
              {series.map((r) => (
                <tr key={r.period}>
                  <td className="sal-strong" data-label="Period">{r.period}</td>
                  <td className="num" data-label="Units">{r.units.toLocaleString()}</td>
                  <td className="num" data-label="Sales">{peso(r.sales)}</td>
                  <td className="num" data-label="Cost of goods">{peso(r.cogs)}</td>
                  <td className="num" data-label="Gross profit">{peso(r.profit)}</td>
                  <td data-label="Sales bar">
                    <div className="sal-bar" aria-hidden="true">
                      <span className="sal-bar-sales" style={{ width: `${(r.sales / maxSales) * 100}%` }} />
                      <span className="sal-bar-profit" style={{ width: `${Math.max(0, (r.profit / maxSales) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sal-legend"><span className="sal-dot is-sales" /> Sales <span className="sal-dot is-profit" /> Gross profit</div>
      </section>

      <div className="sal-two">
        <section className="sal-card-wide">
          <div className="sal-block-head"><h3>Best-selling items</h3></div>
          <div className="sal-table-wrap">
            <table className="sal-table stack-phone">
              <thead><tr><th>Item</th><th className="num">Units</th><th className="num">Sales</th><th className="num">Gross profit</th></tr></thead>
              <tbody>
                {topItems.length === 0 && <tr><td colSpan={4} className="sal-empty-cell">No sales in this period.</td></tr>}
                {topItems.map((t) => (
                  <tr key={t.itemId}>
                    <td data-label="Item"><span className="sal-strong">{t.itemName}</span><span className="sal-muted sal-small">{t.itemId}</span></td>
                    <td className="num" data-label="Units">{t.units.toLocaleString()}</td>
                    <td className="num" data-label="Sales">{peso(t.sales)}</td>
                    <td className="num" data-label="Gross profit">{peso(t.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="sal-card-wide">
        <div className="sal-block-head">
          <h3>Sales history</h3>
          <div className="sal-controls no-print">
            <button type="button" className="sal-btn is-ghost" onClick={() => window.print()}>Print</button>
            <button
              type="button"
              className="sal-btn is-primary"
              onClick={() =>
                downloadCsv(
                  'sales-history.csv',
                  ['Date', 'Time', 'Reference', 'Item', 'Item ID', 'Quantity', 'Unit cost', 'Unit price', 'Total cost', 'Total sales', 'Gross profit', 'Customer', 'Recorded by'],
                  history.map((r) => [r.date, r.time.slice(11), r.reference, r.itemName, r.itemId, r.quantity, r.unitCost, r.unitPrice, r.totalCost, r.totalSales, r.grossProfit, r.recordedBy]),
                )
              }
            >
              Export to Excel (CSV)
            </button>
          </div>
        </div>
        <div className="sal-filters no-print">
          <label className="sal-field"><span>From</span><input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} /></label>
          <label className="sal-field"><span>To</span><input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} /></label>
          <label className="sal-field"><span>Item</span><input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="Item name or ID" /></label>
          <label className="sal-field"><span>Recorded by</span><input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Username" /></label>
          <label className="sal-field sal-field-wide"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference or item" /></label>
        </div>
        <p className="sal-total-line">
          Total for the selected range: <strong>{peso(historyTotals.sales)}</strong> sales ·{' '}
          <strong>{peso(historyTotals.profit)}</strong> gross profit · {historyTotals.units.toLocaleString()} unit(s)
          {history.length >= 500 && <span className="sal-muted"> (showing the newest 500)</span>}
        </p>
        {historyInfo && <div className="sal-note" role="status">{historyInfo}</div>}
        <div className="sal-table-wrap">
          <table className="sal-table sal-history stack-phone">
            <thead>
              <tr>
                <th>Date &amp; time</th>
                <th>Reference</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th className="num">Unit cost</th>
                <th className="num">Total sales</th>
                <th className="num">Total cost</th>
                <th className="num">Gross profit</th>
                <th>Recorded by</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={13} className="sal-empty-cell">No sales match these filters.</td></tr>}
              {history.map((r) => (
                <tr key={r.id} className={r.status === 'VOIDED' ? 'is-void' : undefined}>
                  <td className="sal-nowrap" data-label="When">{r.time.slice(0, 16).replace(' ', ' · ')}</td>
                  <td data-label="Reference"><span className="sal-code">{r.reference}</span></td>
                  <td data-label="Item"><span className="sal-strong">{r.itemName}</span><span className="sal-muted sal-small">{r.itemId}</span></td>
                  <td className="num" data-label="Qty">{r.quantity.toLocaleString()}</td>
                  <td className="num" data-label="Unit price">{peso(r.unitPrice)}</td>
                  <td className="num" data-label="Unit cost">{peso(r.unitCost)}</td>
                  <td className="num" data-label="Total sales">{peso(r.totalSales)}</td>
                  <td className="num" data-label="Total cost">{peso(r.totalCost)}</td>
                  <td className={`num ${r.grossProfit < 0 ? 'sal-loss' : ''}`} data-label="Gross profit">{peso(r.grossProfit)}</td>
                  <td data-label="Recorded by">{r.recordedBy || '—'}</td>
                  <td data-label="Status"><span className={`sal-status ${r.status === 'VOIDED' ? 'is-void' : ''}`}>{r.status === 'VOIDED' ? 'Undone' : 'Completed'}</span></td>
                  <td className="sal-row-actions" data-label="">
                    {r.status !== 'VOIDED' && (
                      <button type="button" className="sal-btn is-ghost" onClick={() => undoSale(r)}>
                        {userRole === 'admin' ? 'Undo' : 'Request undo'}
                      </button>
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
