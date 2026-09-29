import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserProfile } from './UserProfile';

describe('UserProfile', () => {
  it('shows who made add audit changes', () => {
    const inventory = [
      {
        id: '001',
        name: 'Brake Pads',
        category: 'BRAKES',
        rack: 'A1',
        quantity: 10,
        price: 150,
      },
    ];

    render(
      <UserProfile
        user="admin"
        role="admin"
        movements={[]}
        inventory={inventory}
        inventoryAudit={[
          {
            id: 'AUDIT-1',
            itemId: '001',
            itemName: 'Brake Pads',
            action: 'ADD',
            date: '2026-09-25',
            timestamp: 1758796800000,
            createdBy: 'Alzed',
          },
        ]}
        onLogout={vi.fn()}
        onGoToDashboard={vi.fn()}
        onUndoInventoryAudit={vi.fn()}
      />
    );

    expect(screen.getByText(/By: Alzed/i)).toBeInTheDocument();
  });
});
