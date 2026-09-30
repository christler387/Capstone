import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { WarehouseMap } from './WarehouseMap';

describe('Dashboard', () => {
  it('shows the EOQ and ROP reorder report', () => {
    const inventory = [
      {
        id: 'item-1',
        name: 'Ceramic Brake Pads (Set)',
        category: 'BRAKES',
        rack: 'A1',
        quantity: 12,
        price: 75,
        orderingCost: 120,
        holdingCost: 18,
        leadTimeDays: 14,
        safetyStock: 6,
      },
    ];

    const movements = [
      { id: 'm1', itemId: 'item-1', type: 'OUT', qty: 8, date: '2025-01-01', timestamp: 1735689600000 },
      { id: 'm2', itemId: 'item-1', type: 'OUT', qty: 12, date: '2025-02-01', timestamp: 1738368000000 },
      { id: 'm3', itemId: 'item-1', type: 'OUT', qty: 9, date: '2025-03-01', timestamp: 1740787200000 },
    ];

    render(<Dashboard inventory={inventory} movements={movements} onGoToStock={vi.fn()} />);

    expect(screen.getAllByText(/EOQ & ROP Reorder Report/i)).toHaveLength(1);
    expect(screen.getAllByText(/ROP/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EOQ/i).length).toBeGreaterThan(0);
  });

  it('shows a recent audit history card', () => {
    const inventory = [
      {
        id: 'item-1',
        name: 'Ceramic Brake Pads (Set)',
        category: 'BRAKES',
        rack: 'A1',
        quantity: 12,
        price: 75,
      },
    ];

    const movements = [
      { id: 'm1', itemId: 'item-1', type: 'OUT', qty: 8, date: '2025-01-01', timestamp: 1735689600000 },
      { id: 'm2', itemId: 'item-1', type: 'IN', qty: 5, date: '2025-02-01', timestamp: 1738368000000 },
    ];

    render(<Dashboard inventory={inventory} movements={movements} onGoToStock={vi.fn()} />);

    expect(screen.getAllByText(/Recent Audit History/i)).toHaveLength(1);
    expect(screen.getAllByText(/Ceramic Brake Pads \(Set\)/i).length).toBeGreaterThan(0);
  });

  it('excludes items that do not need reordering', () => {
    const inventory = [
      {
        id: 'item-ok',
        name: 'Healthy Stock Item',
        category: 'ENGINE',
        rack: 'A1',
        quantity: 100,
        price: 75,
      },
    ];

    render(<Dashboard inventory={inventory} movements={[]} onGoToStock={vi.fn()} />);

    expect(screen.queryByText('Healthy Stock Item')).not.toBeInTheDocument();
  });

  it('renders the warehouse map with the updated aisle labels', () => {
    render(
      <WarehouseMap
        inventory={[]}
        movements={[]}
        onEditItem={vi.fn()}
        onAddItem={vi.fn()}
        onBulkUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('AISLE I')).toBeInTheDocument();
    expect(screen.getByText('AISLE J')).toBeInTheDocument();
    expect(screen.getByText('AISLE K')).toBeInTheDocument();
    expect(screen.getByText('AISLE L')).toBeInTheDocument();
  });
});
