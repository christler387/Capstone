import React from 'react';
import { Item, Movement } from '../types';
import { Dashboard } from './Dashboard';

interface StaffDashboardProps {
  inventory: Item[];
  movements: Movement[];
  onGoToStock: (id: string) => void;
  onGoToWarehouse?: (rack: string) => void;
  onGoToInventory?: () => void;
  userName?: string;
}

export const StaffDashboard: React.FC<StaffDashboardProps> = ({
  inventory,
  movements,
  onGoToStock
}) => {
  return (
    <Dashboard 
      inventory={inventory} 
      movements={movements} 
      onGoToStock={onGoToStock} 
    />
  );
};

