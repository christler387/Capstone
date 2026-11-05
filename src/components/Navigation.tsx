import React from 'react';

interface NavigationProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const NAV_ITEMS: { id: string; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'bx-grid-alt' },
  { id: 'inventory', label: 'Inventory', icon: 'bx-package' },
  { id: 'stock', label: 'Stock', icon: 'bx-transfer-alt' },
  { id: 'warehouse', label: 'Warehouse Map', icon: 'bx-map-alt' },
  { id: 'user', label: 'User', icon: 'bx-user-circle' },
];

export const Navigation: React.FC<NavigationProps> = ({ currentSection, onSectionChange }) => {
  return (
    <nav className="top-nav" aria-label="Main">
      {NAV_ITEMS.map(item => {
        const isActive = currentSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`nav-btn ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            <i className={`bx ${item.icon}`} aria-hidden="true"></i>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
