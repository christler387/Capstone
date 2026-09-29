import React, { useState } from 'react';
import { Item, Movement } from '../types';
import { getEoq, getReorderQuantity, getRop, isAtReorderPoint } from '../inventoryMetrics';

const API_BASE = '/api';

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

interface DashboardProps {
  inventory: Item[];
  movements: Movement[];
  onGoToStock: (id: string) => void;
}

const SectionCard: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => (
  <div className="dash-card">
    <span className="label-micro">{title}</span>
    <div className="dash-card-list">
      {children}
    </div>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ inventory, movements, onGoToStock }) => {
  const [insight, setInsight] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const totalItems = inventory.length;
  const totalValue = inventory.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const lowStock = inventory.filter(i => isAtReorderPoint(i, movements));
  const lowCount = lowStock.length;

  const catData = inventory.reduce((acc, i) => {
    if (!acc[i.category]) acc[i.category] = { qty: 0, val: 0 };
    acc[i.category].qty += i.quantity;
    acc[i.category].val += (i.price * i.quantity);
    return acc;
  }, {} as Record<string, { qty: number, val: number }>);

  const recentMovements = [...movements].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  const reorderReport = inventory
    .map(item => ({
      item,
      eoq: getEoq(item, movements),
      rop: getRop(item, movements),
      reorderQty: getReorderQuantity(item, movements),
    }))
    .filter(({ reorderQty }) => reorderQty > 0)
    .sort((a, b) => {
      if (a.reorderQty !== b.reorderQty) return b.reorderQty - a.reorderQty;
      return b.item.quantity - a.item.quantity;
    })
    .slice(0, 5);

  const generateInsights = async () => {
    setIsLoadingInsight(true);
    setInsightError(null);
    try {
      const result = await requestJson<{ insight: string; model: string }>('/insights', {
        method: 'POST',
        body: JSON.stringify({ inventory, movements }),
      });
      setInsight(result.insight);
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : 'Unable to generate inventory insights.');
    } finally {
      setIsLoadingInsight(false);
    }
  };

  const renderSummaryStats = () => (
    <div className="stats-bar">
      <div className="stat-box">
        <span className="label-micro">Total Items</span>
        <p className="stat-value">{String(totalItems).padStart(3, '0')}</p>
      </div>
      <div className="stat-box">
        <span className="label-micro">Inventory Value</span>
        <p className="stat-value">₱{totalValue.toLocaleString()}</p>
      </div>
      <div className="stat-box">
        <span className="label-micro">Critical Alerts</span>
        <p className="stat-value" style={{ color: 'var(--accent)' }}>{String(lowCount).padStart(3, '0')}</p>
      </div>
    </div>
  );

  const renderDashboardGrid = (includeOverview = true, includeReports = true) => (
    <div className={`dashboard-grid ${includeOverview ? 'overview-grid' : 'report-grid'}`}>
        {includeOverview && <SectionCard title="Low Stock Alerts">
          {lowStock.length > 0 ? (
            lowStock.sort((a, b) => a.name.localeCompare(b.name)).map(i => (
              <div key={i.id} className="flex-row-between border-soft low-stock-item cursor-pointer" onClick={() => onGoToStock(i.id)}>
                <span className="label-micro opacity-80" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '70%' }}>{i.name}</span>
                <span className="label-micro alert-text font-mono text-xs" style={{ fontWeight: 'bold' }}>
                  {i.quantity}
                </span>
              </div>
            ))
          ) : (
            <p className="label-micro opacity-30">All stock levels optimal.</p>
          )}
        </SectionCard>}
        {includeOverview && <SectionCard title="Category Units">
          {Object.entries(catData).length > 0 ? (
            Object.entries(catData).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, d]) => (
              <div key={cat} className="flex-row-between border-soft">
                <span className="label-micro opacity-80" style={{ textTransform: 'none' }}>{cat}</span>
                <span className="label-micro font-mono" style={{ fontWeight: 'bold' }}>{d.qty.toLocaleString()} units</span>
              </div>
            ))
          ) : (
            <p className="label-micro opacity-30">No category unit data.</p>
          )}
        </SectionCard>}
        {includeOverview && <SectionCard title="Category Prices">
          {Object.entries(catData).length > 0 ? (
            Object.entries(catData).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, d]) => (
              <div key={cat} className="flex-row-between border-soft">
                <span className="label-micro opacity-80" style={{ textTransform: 'none' }}>{cat}</span>
                <span className="label-micro font-mono" style={{ fontWeight: 'bold' }}>₱{d.val.toLocaleString()}</span>
              </div>
            ))
          ) : (
            <p className="label-micro opacity-30">No category price data.</p>
          )}
        </SectionCard>}
        {includeReports && <SectionCard title="Recent Audit History">
          {recentMovements.length > 0 ? (
            recentMovements.map(movement => {
              const item = inventory.find(i => i.id === movement.itemId);
              const isIn = movement.type === 'IN';
              const dateFormatted = new Date(movement.timestamp).toLocaleString('en-US', {
                day: '2-digit',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              }).toUpperCase();

              return (
                <div
                  key={movement.id}
                  className="flex-row-between border-soft"
                  style={{
                    gap: '0.75rem',
                    alignItems: 'flex-start',
                    padding: '0.45rem 0.5rem',
                    margin: '0 -0.5rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      className="label-micro opacity-80"
                      style={{
                        display: 'block',
                        textTransform: 'uppercase',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.2,
                        letterSpacing: '0.08em',
                      }}
                    >
                      {item?.name || movement.itemId}
                    </span>
                    <span
                      className="label-micro font-mono opacity-50"
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        marginTop: '2px',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        lineHeight: 1.25,
                      }}
                    >
                      {dateFormatted}
                    </span>
                  </div>
                  <span
                    className={`label-micro font-mono ${isIn ? 'text-success' : 'text-accent'}`}
                    style={{
                      fontWeight: 'bold',
                      flexShrink: 0,
                      minWidth: '2.5rem',
                      textAlign: 'right',
                      lineHeight: 1.2,
                      letterSpacing: '0.08em',
                    }}
                  >
                    {isIn ? '+' : '-'}{movement.qty}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="label-micro opacity-30">No recent audit activity.</p>
          )}
        </SectionCard>}
        {includeReports && <SectionCard title="EOQ & ROP Reorder Report">
          {reorderReport.length > 0 ? (
            reorderReport.map(({ item, eoq, rop, reorderQty }) => (
              <div key={item.id} className="flex-row-between border-soft reorder-report-row" onClick={() => onGoToStock(item.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="label-micro opacity-80" style={{ display: 'block', textTransform: 'none', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.name}</span>
                  <span className="label-micro font-mono opacity-50" style={{ display: 'block', fontSize: '11px', marginTop: '2px' }}>
                    EOQ {Math.ceil(eoq || 0)} • ROP {Math.ceil(rop || 0)}
                  </span>
                </div>
                <div className="flex-col-end" style={{ flexShrink: 0 }}>
                  <span className="label-micro font-mono text-accent" style={{ fontWeight: 'bold' }}>
                    BUY {reorderQty}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="label-micro opacity-30">No reorder data available.</p>
          )}
        </SectionCard>}
    </div>
  );

  return (
    <div className="content-section">
      {renderSummaryStats()}
      {renderDashboardGrid(true, false)}
      {renderDashboardGrid(false, true)}
    </div>
  );
};
