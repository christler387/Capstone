
export type ItemSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type ItemWeight = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type DemandLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type UserRole = 'admin' | 'staff';
export type MovementType = 'IN' | 'OUT';

export interface Item {
  id: string;
  name: string;
  barcode?: string;
  category: string;
  rack: string;
  quantity: number;
  price: number;
  image?: string;
  level?: string;
  size?: ItemSize;
  weight?: ItemWeight;
  demand?: DemandLevel;
  compatibleVehicles?: string;
  orderingCost?: number;
  holdingCost?: number;
  leadTimeDays?: number;
  safetyStock?: number;
}

export interface Movement {
  id: string;
  itemId: string;
  type: MovementType;
  qty: number;
  date: string;
  timestamp: number;
  createdBy?: string;
}

export type InventoryAuditAction = 'ADD' | 'DELETE';

export interface InventoryAuditEntry {
  id: string;
  itemId: string;
  itemName: string;
  action: InventoryAuditAction;
  date: string;
  timestamp: number;
  createdBy?: string;
}


export const CONFIG = {
  LOW_STOCK_THRESHOLD: 5,
  SECTIONS: {
    dashboard: 'System Overview & Analytics',
    inventory: 'Inventory Ledger',
    stock: 'Manage Stock Movements',
    warehouse: 'Visual Layout & Zoning',
    user: 'User Profile & Session'
  } as Record<string, string>
};

