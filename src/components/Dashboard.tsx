import React from 'react';
import { Item, Movement } from '../types';
import { isAtReorderPoint } from '../inventoryMetrics';

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

  return (
    <div className="content-section">
      {renderSummaryStats()}
      <div className="dashboard-grid">
        <SectionCard title="Category Prices">
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
        </SectionCard>
        <SectionCard title="Category Units">
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
        </SectionCard>
        <SectionCard title="Low Stock Alerts">
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
        </SectionCard>
        <SectionCard title="Recent Movements">
          {recentMovements.length > 0 ? (
            recentMovements.map(m => {
              const item = inventory.find(i => i.id === m.itemId);
              const date = new Date(m.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
              const isIn = m.type === 'IN';
              return (
                <div key={m.id} className="flex-row-between border-soft cursor-pointer" onClick={() => onGoToStock(m.itemId)}>
                  <span className="label-micro opacity-80" style={{ textTransform: 'none', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item?.name || m.itemId}</span>
                  <div className="flex-row-gap" style={{ gap: '0.5rem', flexShrink: 0 }}>
                    <span className={`label-micro ${isIn ? 'text-success' : 'text-accent'}`} style={{ fontSize: '10px', fontWeight: 'bold' }}>{m.type}</span>
                    <span className={`label-micro font-mono ${isIn ? 'text-success' : 'text-accent'}`} style={{ fontWeight: 'bold' }}>{isIn ? '+' : '-'}{m.qty}</span>
                    <span className="label-micro font-mono opacity-50" style={{ fontSize: '10px' }}>{date}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="label-micro opacity-30">No recent movements recorded.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
