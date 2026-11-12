
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
  // Where the item is bought from. The same item name can come from different suppliers.
  supplier?: string;
}

// Item fields that are typed in, with suggestions drawn from the values already saved.
export type ItemDescriptorField = 'category' | 'brand' | 'itemType' | 'model' | 'partNumber' | 'color' | 'unitOfMeasure' | 'supplier';

export interface Movement {
  id: string;
  itemId: string;
  type: MovementType;
  qty: number;
  date: string;
  timestamp: number;
  createdBy?: string;
  // Stock in: the supplier's invoice number and the supplier. Stock out: the invoice number.
  reference?: string;
  supplierId?: number | null;
}

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
