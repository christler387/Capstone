import React from 'react';

interface NavigationProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentSection, onSectionChange }) => {
  return (
    <nav className="top-nav">
      <button 
        className={`nav-btn ${currentSection === 'dashboard' ? 'active' : ''}`} 
        onClick={() => onSectionChange('dashboard')}
      >
        Dashboard
      </button>
      <button 
        className={`nav-btn ${currentSection === 'inventory' ? 'active' : ''}`} 
        onClick={() => onSectionChange('inventory')}
      >
        Inventory
      </button>
      <button 
        className={`nav-btn ${currentSection === 'stock' ? 'active' : ''}`} 
        onClick={() => onSectionChange('stock')}
      >
        Stock
      </button>
      <button 
        className={`nav-btn ${currentSection === 'warehouse' ? 'active' : ''}`} 
        onClick={() => onSectionChange('warehouse')}
      >
        Warehouse Map
      </button>
      <button 
        className={`nav-btn ${currentSection === 'user' ? 'active' : ''}`} 
        onClick={() => onSectionChange('user')}
      >
        User
      </button>
    </nav>
  );
};
