
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
  // Changes each time the item is saved. Sent back on save so an out-of-date edit is refused.
  version?: number;
  brand?: string;
  itemType?: string;
  model?: string;
  partNumber?: string;
  color?: string;
  unitOfMeasure?: string;
  // Supplier discount in percent (0 to 100).
  discount?: number;
}

// Item fields that are typed in, with suggestions drawn from the values already saved.
export type ItemDescriptorField = 'category' | 'brand' | 'itemType' | 'model' | 'partNumber' | 'color' | 'unitOfMeasure';

export interface Movement {
  id: string;
  itemId: string;
  type: MovementType;
  qty: number;
  date: string;
  timestamp: number;
  createdBy?: string;
}

export type InventoryAuditAction = 'ADD' | 'DELETE' | 'QTY';

export type AisleOrientation = 'portrait' | 'landscape';

export interface WarehouseRack {
  id: number;
  number: number;
  code: string;
  capacity: number | null;
}

export interface WarehouseAisle {
  id: number;
  floorId: number;
  code: string;
  category: string;
  color: string;
  orientation: AisleOrientation;
  gridCol: number;
  gridRow: number;
  racks: WarehouseRack[];
}

export interface WarehouseFloor {
  id: number;
  name: string;
  sortOrder: number;
  aisles: WarehouseAisle[];
}

export type WarehouseLayout = WarehouseFloor[];

export interface InventoryAuditEntry {
  id: string;
  itemId: string;
  itemName: string;
  action: InventoryAuditAction;
  date: string;
  timestamp: number;
  createdBy?: string;
  // For QTY entries: the quantity before and after the change.
  quantityChange?: { from: number; to: number };
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

