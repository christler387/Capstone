import React, { useState } from 'react';
import { Item, Movement } from '../types';
import { getEoq, getReorderQuantity, getRop, getStockTotal, isAtReorderPoint } from '../inventoryMetrics';

interface DashboardProps {
  inventory: Item[];
  movements: Movement[];
  onGoToStock: (id: string) => void;
}

const RECENT_LIMIT = 20;

const formatPeso = (value: number) => `₱${value.toLocaleString()}`;

const formatWhen = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const KpiCard: React.FC<{ icon: string; label: string; value: string; hint: string; alert?: boolean }> = ({
  icon,
  label,
  value,
  hint,
  alert = false,
}) => (
  <article className={`dash2-kpi${alert ? ' is-alert' : ''}`}>
    <div className="dash2-kpi-head">
      <span className="dash2-kpi-icon" aria-hidden="true">
        <i className={`bx ${icon}`}></i>
      </span>
      <span className="dash2-kpi-label">{label}</span>
    </div>
    <p className="dash2-kpi-value">{value}</p>
    <p className="dash2-kpi-hint">{hint}</p>
  </article>
);

const Panel: React.FC<{
  title: string;
  meta?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, meta, count, action, children }) => (
  <section className="dash2-panel">
    <header className="dash2-panel-head">
      <div className="dash2-panel-titles">
        <h2 className="dash2-panel-title">
          {title}
          {count !== undefined && <span className="dash2-count">{count.toLocaleString()}</span>}
        </h2>
        {meta && <p className="dash2-panel-meta">{meta}</p>}
      </div>
      {action}
    </header>
    <div className="dash2-panel-body">{children}</div>
  </section>
);

const Empty: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div className="dash2-empty">
    <span className="dash2-empty-icon" aria-hidden="true">
      <i className={`bx ${icon}`}></i>
    </span>
    <p>{text}</p>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ inventory, movements, onGoToStock }) => {
  const [categoryMetric, setCategoryMetric] = useState<'value' | 'units'>('value');

  const totalItems = inventory.length;
  const totalValue = inventory.reduce((sum, i) => sum + getStockTotal(i), 0);
  const lowStock = inventory
    .filter((i) => isAtReorderPoint(i, movements))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));

  const catData = inventory.reduce((acc, i) => {
    const displayCategory = (i.category || '').trim().toUpperCase() || 'UNCATEGORIZED';
    if (!acc[displayCategory]) acc[displayCategory] = { qty: 0, val: 0 };
    acc[displayCategory].qty += i.quantity;
    acc[displayCategory].val += getStockTotal(i);
    return acc;
  }, {} as Record<string, { qty: number; val: number }>);

  const categoryRows = Object.entries(catData)
    .map(([name, d]) => ({ name, value: d.val, units: d.qty }))
    .sort((a, b) => (categoryMetric === 'value' ? b.value - a.value : b.units - a.units));
  const categoryMax = Math.max(1, ...categoryRows.map((row) => (categoryMetric === 'value' ? row.value : row.units)));
  const totalUnits = categoryRows.reduce((sum, row) => sum + row.units, 0);
  const largest = [...categoryRows].sort((a, b) => b.value - a.value)[0];

  const recentMovements = [...movements].sort((a, b) => b.timestamp - a.timestamp).slice(0, RECENT_LIMIT);

  const reorderRows = inventory
    .map((item) => ({
      item,
      eoq: getEoq(item, movements),
      rop: getRop(item, movements),
      reorderQty: getReorderQuantity(item, movements),
    }))
    .filter(({ reorderQty }) => reorderQty > 0)
    .sort((a, b) => (a.reorderQty !== b.reorderQty ? b.reorderQty - a.reorderQty : b.item.quantity - a.item.quantity));

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="dash2">
      <header className="dash2-header">
        <div>
          <h1 className="dash2-title">Dashboard</h1>
          <p className="dash2-subtitle">{today}</p>
        </div>
      </header>

      <section className="dash2-kpis" aria-label="Key figures">
        <KpiCard icon="bx-package" label="Total items" value={totalItems.toLocaleString()} hint="Items on record" />
        <KpiCard icon="bx-wallet" label="Inventory value" value={formatPeso(totalValue)} hint="Price × quantity on hand" />
        <KpiCard
          icon="bx-error-circle"
          label="Low stock"
          value={lowStock.length.toLocaleString()}
          hint="At or below reorder point"
          alert={lowStock.length > 0}
        />
        <KpiCard
          icon="bx-cart"
          label="To reorder"
          value={reorderRows.length.toLocaleString()}
          hint="Items with a suggested order"
        />
      </section>

      <div className="dash2-main">
        <Panel
          title="By category"
          count={categoryRows.length}
          meta={categoryMetric === 'value' ? 'Inventory value per category' : 'Units on hand per category'}
          action={
            <div className="dash2-seg" role="group" aria-label="Show by">
              <button type="button" aria-pressed={categoryMetric === 'value'} onClick={() => setCategoryMetric('value')}>
                Value
              </button>
              <button type="button" aria-pressed={categoryMetric === 'units'} onClick={() => setCategoryMetric('units')}>
                Units
              </button>
            </div>
          }
        >
          {categoryRows.length === 0 ? (
            <Empty icon="bx-category" text="No categories yet. Add an item to see them here." />
          ) : (
            <div className="dash2-scroll">
              <ul className="dash2-bars" aria-label="Categories">
                {categoryRows.map((row) => {
                  const amount = categoryMetric === 'value' ? row.value : row.units;
                  const label = categoryMetric === 'value' ? formatPeso(row.value) : `${row.units.toLocaleString()} units`;
                  return (
                    <li key={row.name} className="dash2-bar-row">
                      <span className="dash2-bar-name">{row.name}</span>
                      <span className="dash2-bar-track" aria-hidden="true">
                        <span className="dash2-bar-fill" style={{ width: `${(amount / categoryMax) * 100}%` }}></span>
                      </span>
                      <span className="dash2-bar-value">{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>

        <div className="dash2-stack">
          <Panel
            title="Needs attention"
            count={lowStock.length}
            meta={lowStock.length > 0 ? 'At or below reorder point' : undefined}
          >
            {lowStock.length === 0 ? (
              <Empty icon="bx-check-circle" text="Every item is above its reorder point." />
            ) : (
              <ul className="dash2-list dash2-list--scroll" aria-label="Items at or below reorder point">
                {lowStock.map((item) => {
                  const rop = getRop(item, movements);
                  return (
                    <li key={item.id}>
                      <button type="button" className="dash2-row-button" onClick={() => onGoToStock(item.id)}>
                        <span className="dash2-row-lead is-alert" aria-hidden="true">
                          <i className="bx bx-error"></i>
                        </span>
                        <span className="dash2-row-main">
                          <span className="dash2-row-title">{item.name}</span>
                          <span className="dash2-row-sub">Reorder point {Math.round(rop).toLocaleString()}</span>
                        </span>
                        <span className="dash2-pill is-alert">{item.quantity.toLocaleString()} left</span>
                        <i className="bx bx-chevron-right dash2-row-chevron" aria-hidden="true"></i>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Summary" meta="Across all categories">
            <div className="dash2-summary">
              <div className="dash2-stat">
                <span className="dash2-stat-label">Categories</span>
                <span className="dash2-stat-value">{categoryRows.length.toLocaleString()}</span>
              </div>
              <div className="dash2-stat">
                <span className="dash2-stat-label">Units on hand</span>
                <span className="dash2-stat-value">{totalUnits.toLocaleString()}</span>
              </div>
              <div className="dash2-stat">
                <span className="dash2-stat-label">Largest by value</span>
                <span className="dash2-stat-value dash2-stat-small">
                  {largest ? `${largest.name} · ${Math.round((largest.value / Math.max(totalValue, 1)) * 100)}%` : '—'}
                </span>
              </div>
              <div className="dash2-stat">
                <span className="dash2-stat-label">Average unit value</span>
                <span className="dash2-stat-value">
                  {totalUnits > 0 ? formatPeso(Math.round(totalValue / totalUnits)) : '—'}
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="dash2-pair">
        <Panel title="Recent activity" count={recentMovements.length} meta="Latest stock movements">
          {recentMovements.length === 0 ? (
            <Empty icon="bx-transfer-alt" text="No stock movements yet." />
          ) : (
            <ul className="dash2-list dash2-list--scroll" aria-label="Recent stock movements">
              {recentMovements.map((movement) => {
                const item = inventory.find((i) => i.id === movement.itemId);
                const isIn = movement.type === 'IN';
                return (
                  <li key={movement.id}>
                    <div className="dash2-row-static">
                      <span className="dash2-row-main">
                        <span className="dash2-row-title">{item?.name || movement.itemId}</span>
                        <span className="dash2-row-sub">{formatWhen(movement.timestamp)}</span>
                      </span>
                      <span className={`dash2-chip ${isIn ? 'is-in' : 'is-out'}`}>
                        <i className={`bx ${isIn ? 'bx-log-in' : 'bx-log-out'}`} aria-hidden="true"></i>
                        {isIn ? 'In' : 'Out'} {movement.qty.toLocaleString()}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Reorder plan" count={reorderRows.length} meta="Suggested order quantities (EOQ)">
          {reorderRows.length === 0 ? (
            <Empty icon="bx-cart" text="No reorders needed right now." />
          ) : (
            <ul className="dash2-list dash2-list--scroll" aria-label="Suggested orders">
              {reorderRows.map(({ item, eoq, reorderQty }) => (
                <li key={item.id}>
                  <button type="button" className="dash2-row-button" onClick={() => onGoToStock(item.id)}>
                    <span className="dash2-row-lead" aria-hidden="true">
                      <i className="bx bx-cart-add"></i>
                    </span>
                    <span className="dash2-row-main">
                      <span className="dash2-row-title">{item.name}</span>
                      <span className="dash2-row-sub">
                        Now {item.quantity.toLocaleString()} · EOQ {Math.round(eoq).toLocaleString()}
                      </span>
                    </span>
                    <span className="dash2-pill">Order {reorderQty.toLocaleString()}</span>
                    <i className="bx bx-chevron-right dash2-row-chevron" aria-hidden="true"></i>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
};
