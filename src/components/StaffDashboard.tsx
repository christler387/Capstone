import React from 'react';
import { InventorySummary, Movement } from '../types';
import { Dashboard } from './Dashboard';

interface StaffDashboardProps {
  summary: InventorySummary | null;
  movements: Movement[];
  onGoToStock: (id: string) => void;
  onGoToWarehouse?: (rack: string) => void;
  onGoToInventory?: () => void;
  userName?: string;
}

export const StaffDashboard: React.FC<StaffDashboardProps> = ({
  summary,
  movements,
  onGoToStock
}) => {
  return (
    <Dashboard
      summary={summary}
      movements={movements}
      onGoToStock={onGoToStock}
    />
  );
};
