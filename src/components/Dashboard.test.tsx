import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { WarehouseMap } from './WarehouseMap';

describe('Dashboard', () => {
  it('groups uncategorized and custom categories under Misc', () => {
    render(
      <Dashboard
        inventory={[
          {
            id: 'uncategorized',
            name: 'Uncategorized item',
            category: '',
            rack: 'K1',
            quantity: 2,
            price: 10,
          },
          {
            id: 'custom',
            name: 'Custom category item',
            category: 'HAHAHA',
            rack: 'L1',
            quantity: 3,
            price: 10,
          },
        ]}
        movements={[]}
        onGoToStock={vi.fn()}
      />,
    );

    const categoryUnits = within(
      screen.getByText('Category Units').parentElement as HTMLElement,
    );
    const categoryPrices = within(
      screen.getByText('Category Prices').parentElement as HTMLElement,
    );

    expect(categoryUnits.getByText('MISC')).toBeInTheDocument();
    expect(categoryUnits.getByText('5 units')).toBeInTheDocument();
    expect(categoryPrices.getByText('₱50')).toBeInTheDocument();
    expect(screen.queryByText('HAHAHA')).not.toBeInTheDocument();
  });

  it('shows the reorder report without the EOQ and ROP detail line', () => {
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

    const reportCard = screen.getByText(/EOQ & ROP Reorder Report/i).closest('.dash-card') as HTMLElement;
    expect(reportCard).toBeInTheDocument();
    expect(within(reportCard).queryByText(/EOQ\s+\d+\s+•\s+ROP\s+\d+/i)).not.toBeInTheDocument();
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
