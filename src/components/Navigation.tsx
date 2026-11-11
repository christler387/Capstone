import React from 'react';
import { Item, Movement } from '../types';
import { CriticalAlerts } from './CriticalAlerts';

interface NavigationProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
  criticalItems: Item[];
  movements: Movement[];
  onOpenItem: (id: string) => void;
  userName: string;
}

const NAV_ITEMS: { id: string; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'stock', label: 'Stock' },
  { id: 'stock-card', label: 'Stock Card' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'warehouse', label: 'Warehouse Map' },
];

// The bar has three parts: the brand (in App), the links in the centre, and the actions on the right.
export const Navigation: React.FC<NavigationProps> = ({
  currentSection,
  onSectionChange,
  criticalItems,
  movements,
  onOpenItem,
  userName,
}) => {
  const initial = (userName || 'U').trim().charAt(0).toUpperCase();
  const isUserActive = currentSection === 'user';

  return (
    <>
      <nav className="top-nav" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const isActive = currentSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-link${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSectionChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="top-actions">
        <CriticalAlerts criticalItems={criticalItems} movements={movements} onOpenItem={onOpenItem} />
        <button
          type="button"
          className={`top-avatar${isUserActive ? ' is-active' : ''}`}
          aria-label={`Your account${userName ? `, ${userName}` : ''}`}
          aria-current={isUserActive ? 'page' : undefined}
          title={userName || 'Your account'}
          onClick={() => onSectionChange('user')}
        >
          {initial}
        </button>
      </div>
    </>
  );
};
