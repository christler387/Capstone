import React, { useState, useEffect, useRef } from 'react';
import { AisleOrientation, Item, Movement, WarehouseAisle, WarehouseFloor, WarehouseLayout } from '../types';
import { Modal } from './Modal';
import { isAtReorderPoint } from '../inventoryMetrics';

// Density uses this capacity for racks that have no capacity set. Three racks make the old 1000 per aisle.
const DEFAULT_RACK_CAPACITY = 1000 / 3;

// One grid column is the width of one portrait aisle. The floor has this many columns.
const GRID_COLUMNS = 8;
const MAX_RACKS = 10;
const CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NEW_CATEGORY = '__new__';
const DEFAULT_AISLE_COLOR = '#64748b';

// Inventory category keywords that have a dedicated aisle category on the map.
const CATEGORY_LABEL_BY_KEYWORD: Record<string, string> = {
  BODY: 'Body & Brakes',
  BRAKES: 'Body & Brakes',
  ELECTRICAL: 'Electrical & Engine',
  ENGINE: 'Electrical & Engine',
  SUSPENSION: 'Suspension & Transmission',
  TRANSMISSION: 'Suspension & Transmission',
};

const FLOOR_STORAGE_KEY = 'skyrun_warehouse_floor';

// Rows at or beyond this are off the grid (parked aisles).
const UNPLACED_ROW = 100;

interface Footprint {
  cols: number;
  rows: number;
}

// The single source of truth for an aisle's size on the grid, used for rendering, collisions and drag.
// Portrait: one column; a header row, then one row per rack.
// Landscape: one column per rack; a header row, then one rack row.
const getFootprint = (orientation: AisleOrientation, rackCount: number): Footprint => {
  const racks = Math.max(rackCount, 1);
  return orientation === 'landscape' ? { cols: racks, rows: 1 } : { cols: 1, rows: racks };
};

const footprintOf = (aisle: WarehouseAisle): Footprint => getFootprint(aisle.orientation, aisle.racks.length);

// True when the footprint fits on the floor at this cell and overlaps no other aisle.
const footprintFits = (
  floor: WarehouseFloor | undefined,
  gridCol: number,
  gridRow: number,
  footprint: Footprint,
  exceptAisleId: number | null = null,
): boolean => {
  if (!floor || gridCol < 1 || gridRow < 1 || gridCol + footprint.cols - 1 > GRID_COLUMNS) return false;
  return !floor.aisles.some(other => {
    if (other.id === exceptAisleId) return false;
    const otherFootprint = footprintOf(other);
    return (
      other.gridCol <= gridCol + footprint.cols - 1 &&
      other.gridCol + otherFootprint.cols - 1 >= gridCol &&
      other.gridRow <= gridRow + footprint.rows - 1 &&
      other.gridRow + otherFootprint.rows - 1 >= gridRow
    );
  });
};

// "AA-01" -> "AA". Works for aisle names of any length.
const aisleCodeOfRack = (rack: string | undefined): string => {
  const value = (rack || '').toUpperCase();
  const dashIndex = value.lastIndexOf('-');
  return dashIndex > 0 ? value.slice(0, dashIndex) : value;
};

// Each layout change returns the whole layout, so the map can replace its copy directly.
const requestLayout = async (
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<WarehouseLayout> => {
  const response = await fetch(`/api/layout${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }
  return data as WarehouseLayout;
};

const readStoredFloorId = (): number | null => {
  try {
    const value = Number(localStorage.getItem(FLOOR_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

interface PointerDrag {
  aisleId: number;
  floorId: number;
  offsetCol: number;
  offsetRow: number;
  col: number;
  row: number;
  footprint: Footprint;
  valid: boolean;
}

interface WarehouseMapProps {
  inventory: Item[];
  movements: Movement[];
  layout: WarehouseLayout;
  onLayoutChange?: (layout: WarehouseLayout) => void;
  onEditItem: (id: string) => void;
  onAddItem: (rack?: string) => void;
  onBulkUpdate: (newInventory: Item[]) => void;
  initialRack?: string | null;
  onClearInitialRack?: () => void;
  userRole?: 'admin' | 'staff';
}

export const WarehouseMap: React.FC<WarehouseMapProps> = ({
  inventory,
  movements,
  layout: savedLayout,
  onLayoutChange,
  onEditItem,
  onAddItem,
  onBulkUpdate,
  initialRack,
  onClearInitialRack,
  userRole = 'staff'
}) => {
  const isAdmin = userRole === 'admin';
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeFloorId, setActiveFloorId] = useState<number | null>(readStoredFloorId);
  const [analyticsScope, setAnalyticsScope] = useState<'floor' | 'all'>('floor');
  const [floorDialog, setFloorDialog] = useState<{ mode: 'add' | 'rename'; floorId?: number } | null>(null);
  const [floorName, setFloorName] = useState('');
  const [floorToDelete, setFloorToDelete] = useState<number | null>(null);
  const [floorMenuId, setFloorMenuId] = useState<number | null>(null);
  const [isSavingFloor, setIsSavingFloor] = useState(false);
  const [selectedRack, setSelectedRack] = useState<{ zoneId: string, rackId: string } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<{
    id: string;
    name: string;
    category: string;
    demand: 'HIGH' | 'MEDIUM' | 'LOW';
    oldRack: string;
    newRack: string;
    demandReason: string;
  }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add Aisle dialog.
  const [aisleDialogOpen, setAisleDialogOpen] = useState(false);
  const [aisleDraft, setAisleDraft] = useState({
    code: '',
    categoryChoice: NEW_CATEGORY,
    newCategory: '',
    newColor: DEFAULT_AISLE_COLOR,
    orientation: 'portrait' as AisleOrientation,
    rackCount: 3,
  });

  // Edit Layout mode works on a draft copy; Save sends the differences to the server.
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<WarehouseLayout | null>(null);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
  const [selectedAisleId, setSelectedAisleId] = useState<number | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDrag | null>(null);
  const [rackRemoval, setRackRemoval] = useState<{
    aisleId: number;
    code: string;
    itemCount: number;
    targetRack: string;
  } | null>(null);

  // Everything below reads `layout`, which is the draft while editing and the saved layout otherwise.
  const layout: WarehouseLayout = isEditing && draft ? draft : savedLayout;
  const isDirty = isEditing && draft !== null && JSON.stringify(draft) !== JSON.stringify(savedLayout);

  const normalizeRack = (r: string | undefined) => r ? r.replace(/-/g, '').toUpperCase() : '';

  const getStockOutQty = (item: Item): number => {
    return movements
      .filter(m => m.itemId === item.id && m.type === 'OUT')
      .reduce((sum, m) => sum + m.qty, 0);
  };

  const getItemDemand = (item: Item): 'HIGH' | 'MEDIUM' | 'LOW' => {
    const stockOutQty = getStockOutQty(item);
    if (stockOutQty >= 15) return 'HIGH';
    if (stockOutQty >= 4) return 'MEDIUM';
    if (stockOutQty > 0) return 'LOW';
    return item.demand || 'LOW';
  };

  // The remembered tab wins; if that floor was deleted, fall back to the first floor.
  const activeFloor = layout.find(floor => floor.id === activeFloorId) ?? layout[0];
  const aisles = activeFloor?.aisles ?? [];
  // Aisles at or below UNPLACED_ROW are parked off the grid (for example after an interrupted save).
  // They are listed in a tray instead of stretching the grid.
  const onGridAisles = aisles.filter(aisle => aisle.gridRow < UNPLACED_ROW);
  const unplacedAisles = aisles.filter(aisle => aisle.gridRow >= UNPLACED_ROW);
  const analyticsAisles = analyticsScope === 'all' ? layout.flatMap(floor => floor.aisles) : aisles;

  // ---- Optimizer ----

  const runOptimization = async () => {
    setIsOptimizing(true);
    setError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Candidate aisles follow the active floor, or every floor when "All floors" is selected.
      const aislesForLabel = (categoryLabel: string) =>
        analyticsAisles.filter(aisle => aisle.category === categoryLabel && aisle.racks.length > 0);

      const proposals = inventory.flatMap(item => {
        const demand = getItemDemand(item);
        const stockOutQty = getStockOutQty(item);
        const itemSeed = item.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const category = (item.category || '').trim().toUpperCase();
        const dedicatedLabel = CATEGORY_LABEL_BY_KEYWORD[category];
        let candidates: WarehouseAisle[];
        let reason: string;

        if (!dedicatedLabel) {
          candidates = aislesForLabel('Misc');
          reason = `${category || 'UNCATEGORIZED'} category → dedicated category storage`;
        } else if (demand === 'HIGH') {
          candidates = aislesForLabel('High Demand Only');
          reason = `High Demand (${stockOutQty} units stocked out) → dedicated fast-pick slot`;
        } else {
          candidates = aislesForLabel(dedicatedLabel);
          reason = `${category} category → dedicated category storage`;
        }

        // No aisle with a matching category label on this view: leave the item where it is.
        const aisle = candidates[itemSeed % Math.max(candidates.length, 1)];
        if (!aisle) return [];

        // Only racks that exist in the layout are suggested.
        const rack = aisle.racks[itemSeed % aisle.racks.length];
        return [{
          id: item.id,
          name: item.name,
          category: item.category,
          demand,
          oldRack: item.rack || 'NONE',
          newRack: rack.code,
          demandReason: `${reason} → Aisle ${aisle.code} (${rack.code})`,
        }];
      });

      const relocationsNeeded = proposals.filter(p =>
        normalizeRack(p.oldRack) !== normalizeRack(p.newRack)
      );

      setOptimizationResult(relocationsNeeded);
    } catch (err) {
      console.error(err);
      setError("Failed to run layout optimization.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const applyOptimization = () => {
    if (!optimizationResult) return;
    const newInventory = inventory.map(item => {
      const opt = optimizationResult.find(o => o.id === item.id);
      if (opt) {
        return {
          ...item,
          rack: opt.newRack
        };
      }
      return item;
    });
    onBulkUpdate(newInventory);
    setOptimizationResult(null);
  };

  useEffect(() => {
    if (initialRack) {
      const zoneId = aisleCodeOfRack(initialRack);
      setSelectedRack({ zoneId, rackId: initialRack });
      if (onClearInitialRack) onClearInitialRack();
    }
  }, [initialRack, onClearInitialRack]);

  // ---- Floors ----

  const selectFloor = (floorId: number) => {
    setActiveFloorId(floorId);
    setFloorMenuId(null);
    try {
      localStorage.setItem(FLOOR_STORAGE_KEY, String(floorId));
    } catch {
      // Storage can be blocked; the tab then simply resets to the first floor on reload.
    }
  };

  const openAddFloor = () => {
    setFloorName(`Floor ${layout.length + 1}`);
    setFloorDialog({ mode: 'add' });
    setError(null);
  };

  const openRenameFloor = (floor: { id: number; name: string }) => {
    setFloorName(floor.name);
    setFloorDialog({ mode: 'rename', floorId: floor.id });
    setFloorMenuId(null);
    setError(null);
  };

  const saveFloor = async () => {
    if (!floorDialog) return;
    const name = floorName.trim();
    if (!name) {
      setError('Floor name is required.');
      return;
    }
    setIsSavingFloor(true);
    setError(null);
    try {
      if (floorDialog.mode === 'add') {
        const updated = await requestLayout('POST', '/floors', { name });
        onLayoutChange?.(updated);
        const newest = updated.reduce((latest, floor) => (floor.sortOrder > latest.sortOrder ? floor : latest));
        selectFloor(newest.id);
      } else if (floorDialog.floorId) {
        const updated = await requestLayout('PUT', `/floors/${floorDialog.floorId}`, { name });
        onLayoutChange?.(updated);
      }
      setFloorDialog(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the floor.');
    } finally {
      setIsSavingFloor(false);
    }
  };

  const deleteFloor = async () => {
    if (floorToDelete === null) return;
    setIsSavingFloor(true);
    setError(null);
    try {
      const updated = await requestLayout('DELETE', `/floors/${floorToDelete}`);
      onLayoutChange?.(updated);
      setFloorToDelete(null);
    } catch (deleteError) {
      setFloorToDelete(null);
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the floor.');
    } finally {
      setIsSavingFloor(false);
    }
  };

  // ---- Add Aisle ----

  // First unused aisle name across the whole warehouse (A, B, … then AA, AB, …).
  const suggestAisleCode = (): string => {
    const used = new Set(layout.flatMap(floor => floor.aisles.map(aisle => aisle.code)));
    const single = [...CODE_LETTERS].find(letter => !used.has(letter));
    if (single) return single;
    for (const first of CODE_LETTERS) {
      for (const second of CODE_LETTERS) {
        if (!used.has(first + second)) return first + second;
      }
    }
    return '';
  };

  // Existing categories with their colors, so a new aisle reuses the category's color.
  const categoryChoices = Array.from(
    new Map(layout.flatMap(floor => floor.aisles).map(aisle => [aisle.category, aisle.color])).entries(),
  );

  // First spot on a floor where the footprint fits, scanning left to right, top to bottom.
  const findFreeCell = (floor: WarehouseFloor | undefined, footprint: Footprint): { gridCol: number; gridRow: number } => {
    const lastRow = Math.max(1, ...(floor?.aisles ?? [])
      .filter(aisle => aisle.gridRow < UNPLACED_ROW)
      .map(aisle => aisle.gridRow + footprintOf(aisle).rows - 1));
    for (let gridRow = 1; gridRow <= lastRow + 1; gridRow += 1) {
      for (let gridCol = 1; gridCol <= GRID_COLUMNS; gridCol += 1) {
        if (footprintFits(floor, gridCol, gridRow, footprint)) return { gridCol, gridRow };
      }
    }
    return { gridCol: 1, gridRow: lastRow + 1 };
  };

  const openAddAisle = () => {
    const firstCategory = categoryChoices[0];
    setAisleDraft({
      code: suggestAisleCode(),
      categoryChoice: firstCategory ? firstCategory[0] : NEW_CATEGORY,
      newCategory: '',
      newColor: DEFAULT_AISLE_COLOR,
      orientation: 'portrait',
      rackCount: 3,
    });
    setAisleDialogOpen(true);
    setError(null);
  };

  const saveAisle = async () => {
    if (!activeFloor) return;
    const code = aisleDraft.code.trim().toUpperCase();
    const isNewCategory = aisleDraft.categoryChoice === NEW_CATEGORY;
    const category = isNewCategory ? aisleDraft.newCategory.trim() : aisleDraft.categoryChoice;
    const existingColor = categoryChoices.find(([name]) => name === category)?.[1];
    const color = isNewCategory ? aisleDraft.newColor : existingColor ?? DEFAULT_AISLE_COLOR;

    if (!code) {
      setError('Aisle name is required.');
      return;
    }
    if (!category) {
      setError('Choose or create a category for the aisle.');
      return;
    }

    setIsSavingFloor(true);
    setError(null);
    try {
      const cell = findFreeCell(activeFloor, getFootprint(aisleDraft.orientation, aisleDraft.rackCount));
      const updated = await requestLayout('POST', '/aisles', {
        floorId: activeFloor.id,
        code,
        category,
        color,
        orientation: aisleDraft.orientation,
        gridCol: cell.gridCol,
        gridRow: cell.gridRow,
        rackCount: aisleDraft.rackCount,
      });
      onLayoutChange?.(updated);
      setAisleDialogOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the aisle.');
    } finally {
      setIsSavingFloor(false);
    }
  };

  // ---- Edit Layout mode ----

  const cloneLayout = (source: WarehouseLayout): WarehouseLayout => JSON.parse(JSON.stringify(source));

  const rackCodeFor = (aisleCode: string, rackNumber: number) =>
    `${aisleCode}-${String(rackNumber).padStart(2, '0')}`;

  const rackItemCount = (code: string) =>
    inventory.filter(item => normalizeRack(item.rack) === normalizeRack(code)).length;

  const aisleItemCount = (aisleCode: string) =>
    inventory.filter(item => aisleCodeOfRack(item.rack) === aisleCode).length;

  const getDraftAisle = (aisleId: number) =>
    draft?.flatMap(floor => floor.aisles).find(aisle => aisle.id === aisleId);

  const getDraftFloor = (aisleId: number) =>
    draft?.find(floor => floor.aisles.some(aisle => aisle.id === aisleId));

  const allRackCodes = (): string[] =>
    (draft ?? []).flatMap(floor => floor.aisles.flatMap(aisle => aisle.racks.map(rack => rack.code)));

  const enterEditMode = () => {
    setDraft(cloneLayout(savedLayout));
    setIsEditing(true);
    setSelectedAisleId(null);
    setFloorMenuId(null);
    setError(null);
  };

  const leaveEditMode = () => {
    setIsEditing(false);
    setDraft(null);
    setSelectedAisleId(null);
    setPointerDrag(null);
    setRackRemoval(null);
    setShowDiscardPrompt(false);
  };

  const requestCancelEdit = () => {
    if (isDirty) setShowDiscardPrompt(true);
    else leaveEditMode();
  };

  const updateDraft = (mutate: (copy: WarehouseLayout) => void) => {
    setDraft(current => {
      if (!current) return current;
      const copy = cloneLayout(current);
      mutate(copy);
      return copy;
    });
  };

  const findInCopy = (copy: WarehouseLayout, aisleId: number) => {
    for (const floor of copy) {
      const aisle = floor.aisles.find(candidate => candidate.id === aisleId);
      if (aisle) return { floor, aisle };
    }
    return null;
  };

  // Moves an aisle so its top-left cell is at (gridCol, gridRow), possibly on another floor.
  // Returns false (and changes nothing) if the footprint does not fit there.
  const placeAisle = (copy: WarehouseLayout, aisleId: number, floorId: number, gridCol: number, gridRow: number) => {
    const source = copy.find(floor => floor.aisles.some(aisle => aisle.id === aisleId));
    const target = copy.find(floor => floor.id === floorId);
    if (!source || !target) return false;
    const index = source.aisles.findIndex(aisle => aisle.id === aisleId);
    const movingAisle = source.aisles[index];
    if (!footprintFits(target, gridCol, gridRow, footprintOf(movingAisle), aisleId)) return false;

    const [aisle] = source.aisles.splice(index, 1);
    aisle.floorId = floorId;
    aisle.gridCol = gridCol;
    aisle.gridRow = gridRow;
    target.aisles.push(aisle);
    return true;
  };

  const moveAisleToFloor = (aisleId: number, floorId: number) => {
    const targetFloor = draft?.find(floor => floor.id === floorId);
    const aisle = getDraftAisle(aisleId);
    if (!targetFloor || !aisle) return;
    const cell = findFreeCell(targetFloor, footprintOf(aisle));
    updateDraft(copy => {
      placeAisle(copy, aisleId, floorId, cell.gridCol, cell.gridRow);
    });
  };

  const rotateAisle = (aisleId: number) => {
    const floor = getDraftFloor(aisleId);
    const aisle = getDraftAisle(aisleId);
    if (!floor || !aisle) return;
    const nextOrientation: AisleOrientation = aisle.orientation === 'portrait' ? 'landscape' : 'portrait';
    const nextFootprint = getFootprint(nextOrientation, aisle.racks.length);
    if (!footprintFits(floor, aisle.gridCol, aisle.gridRow, nextFootprint, aisleId)) {
      setError(`Aisle ${aisle.code} cannot turn here: the ${nextOrientation} shape would overlap another aisle or leave the grid. It stays where it is.`);
      return;
    }
    updateDraft(copy => {
      const found = findInCopy(copy, aisleId);
      if (found) found.aisle.orientation = nextOrientation;
    });
  };

  const setAisleCategory = (aisleId: number, value: string) => {
    updateDraft(copy => {
      const found = findInCopy(copy, aisleId);
      if (found) found.aisle.category = value;
    });
  };

  const renameAisle = (aisleId: number, value: string) => {
    const aisle = getDraftAisle(aisleId);
    if (!aisle) return;
    const newCode = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (newCode === aisle.code) return;
    // Items are stored by rack code, so an aisle with stock cannot be renamed.
    if (aisleItemCount(aisle.code) > 0) {
      setError(`Aisle ${aisle.code} still holds items. Move them before renaming it.`);
      return;
    }
    updateDraft(copy => {
      const found = findInCopy(copy, aisleId);
      if (!found) return;
      found.aisle.code = newCode;
      found.aisle.racks.forEach(rack => {
        rack.code = rackCodeFor(newCode, rack.number);
      });
    });
  };

  const deleteAisleInDraft = (aisleId: number) => {
    const aisle = getDraftAisle(aisleId);
    if (!aisle) return;
    if (aisleItemCount(aisle.code) > 0) {
      setError(`Aisle ${aisle.code} still holds items. Move them before deleting it.`);
      return;
    }
    setSelectedAisleId(null);
    updateDraft(copy => {
      copy.forEach(floor => {
        floor.aisles = floor.aisles.filter(candidate => candidate.id !== aisleId);
      });
    });
  };

  const changeRackCount = (aisleId: number, delta: 1 | -1) => {
    const floor = getDraftFloor(aisleId);
    const aisle = getDraftAisle(aisleId);
    if (!floor || !aisle) return;

    if (delta === 1) {
      if (aisle.racks.length >= MAX_RACKS) return;
      if (aisle.orientation === 'landscape' && aisle.racks.length + 1 > GRID_COLUMNS) {
        setError(`A landscape aisle can have at most ${GRID_COLUMNS} racks, one per grid column.`);
        return;
      }
      const grownFootprint = getFootprint(aisle.orientation, aisle.racks.length + 1);
      if (!footprintFits(floor, aisle.gridCol, aisle.gridRow, grownFootprint, aisleId)) {
        setError(`No room for another rack on Aisle ${aisle.code}. Move the neighbouring aisle first.`);
        return;
      }
      updateDraft(copy => {
        const found = findInCopy(copy, aisleId);
        if (!found) return;
        const number = Math.max(0, ...found.aisle.racks.map(rack => rack.number)) + 1;
        found.aisle.racks.push({
          // Temporary negative id until the server creates the rack on Save.
          id: -(Date.now() + number),
          number,
          code: rackCodeFor(found.aisle.code, number),
          capacity: null,
        });
      });
      return;
    }

    if (aisle.racks.length <= 1) return;
    // Racks are removed from the highest number down, so numbering stays 1..n.
    const lastRack = aisle.racks[aisle.racks.length - 1];
    const itemCount = rackItemCount(lastRack.code);
    if (itemCount > 0) {
      const targetRack = allRackCodes().find(code => code !== lastRack.code) ?? '';
      setRackRemoval({ aisleId, code: lastRack.code, itemCount, targetRack });
      return;
    }
    updateDraft(copy => {
      const found = findInCopy(copy, aisleId);
      if (found) found.aisle.racks.pop();
    });
  };

  // Moves the items off the rack first, then removes it from the draft.
  const confirmRackRemoval = () => {
    if (!rackRemoval) return;
    const { aisleId, code, targetRack } = rackRemoval;
    if (!targetRack) {
      setError('Add another rack to move these items to first.');
      setRackRemoval(null);
      return;
    }
    const movedInventory = inventory.map(item =>
      normalizeRack(item.rack) === normalizeRack(code) ? { ...item, rack: targetRack } : item,
    );
    onBulkUpdate(movedInventory);
    updateDraft(copy => {
      const found = findInCopy(copy, aisleId);
      if (found) found.aisle.racks.pop();
    });
    setRackRemoval(null);
  };

  // Saves the whole draft in one request. The server checks the full result and applies it in one
  // transaction, so either every change is saved or none is.
  const saveLayoutEdits = async () => {
    if (!draft) return;
    setIsSavingLayout(true);
    setError(null);
    try {
      const updated = await requestLayout('PUT', '', {
        floors: draft.map(floor => ({
          id: floor.id,
          aisles: floor.aisles.map(aisle => ({
            id: aisle.id,
            code: aisle.code,
            category: aisle.category,
            color: aisle.color,
            orientation: aisle.orientation,
            gridCol: aisle.gridCol,
            gridRow: aisle.gridRow,
            rackCount: aisle.racks.length,
          })),
        })),
      });
      onLayoutChange?.(updated);
      leaveEditMode();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the layout.');
    } finally {
      setIsSavingLayout(false);
    }
  };

  // Puts a parked aisle at the first spot where it fits on the grid.
  const placeUnplacedAisle = (aisleId: number) => {
    const floor = getDraftFloor(aisleId);
    const aisle = getDraftAisle(aisleId);
    if (!floor || !aisle) return;
    const cell = findFreeCell(floor, footprintOf(aisle));
    updateDraft(copy => {
      placeAisle(copy, aisleId, floor.id, cell.gridCol, cell.gridRow);
    });
  };

  // Converts a pointer position into a grid cell, using the grid's real padding, gaps and track sizes.
  const cellAt = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const style = getComputedStyle(grid);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const padTop = parseFloat(style.paddingTop) || 0;
    const colGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const rowHeight = parseFloat(style.gridAutoRows) || 92;
    const rect = grid.getBoundingClientRect();
    const contentWidth = grid.clientWidth - padLeft - padRight;
    const colWidth = (contentWidth - colGap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    const x = clientX - rect.left - padLeft;
    const y = clientY - rect.top - padTop;
    const col = Math.min(GRID_COLUMNS, Math.max(1, Math.floor(x / (colWidth + colGap)) + 1));
    const row = Math.max(1, Math.floor(y / (rowHeight + rowGap)) + 1);
    return { col, row };
  };

  // Pointer events cover mouse, pen and touch. The drag handle captures the pointer.
  const startAisleDrag = (event: React.PointerEvent<HTMLSpanElement>, aisle: WarehouseAisle) => {
    if (!isEditing || !activeFloor) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedAisleId(aisle.id);
    setPointerDrag({
      aisleId: aisle.id,
      floorId: activeFloor.id,
      offsetCol: cell.col - aisle.gridCol,
      offsetRow: cell.row - aisle.gridRow,
      col: aisle.gridCol,
      row: aisle.gridRow,
      footprint: footprintOf(aisle),
      valid: true,
    });
  };

  const moveAisleDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!pointerDrag || !activeFloor) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    const col = Math.max(1, cell.col - pointerDrag.offsetCol);
    const row = Math.max(1, cell.row - pointerDrag.offsetRow);
    const valid = footprintFits(activeFloor, col, row, pointerDrag.footprint, pointerDrag.aisleId);
    setPointerDrag(current => (current ? { ...current, col, row, valid } : current));
  };

  const endAisleDrag = () => {
    const drag = pointerDrag;
    setPointerDrag(null);
    if (!drag || !drag.valid) return;
    updateDraft(copy => {
      placeAisle(copy, drag.aisleId, drag.floorId, drag.col, drag.row);
    });
  };

  // Warn before leaving the page with unsaved layout changes.
  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  // Close the floor options menu when the user clicks anywhere else.
  useEffect(() => {
    if (floorMenuId === null) return;
    const closeMenu = () => setFloorMenuId(null);
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [floorMenuId]);

  // ---- Analytics ----

  const aisleData = analyticsAisles.map(aisle => {
    const id = aisle.code;
    const aisleItems = inventory.filter(i => aisleCodeOfRack(i.rack) === id);
    const sizeCapacity = { SMALL: 0.25, MEDIUM: 1, LARGE: 2 } as const;
    const totalQty = aisleItems.reduce((sum, item) => sum + item.quantity * (sizeCapacity[item.size || 'MEDIUM']), 0);
    const uniqueItems = aisleItems.length;
    const maxCapacity = aisle.racks.reduce((sum, rack) => sum + (rack.capacity ?? DEFAULT_RACK_CAPACITY), 0) || DEFAULT_RACK_CAPACITY;
    const density = Math.min(100, Math.round((totalQty / maxCapacity) * 100));
    let statusClass = 'status-optimal';
    let statusText = 'Optimal';

    if (density > 80) {
      statusClass = 'status-critical';
      statusText = 'Overloaded';
    } else if (density > 50) {
      statusClass = 'status-warning';
      statusText = 'Moderate';
    }
    return { id, totalQty, uniqueItems, density, statusClass, statusText };
  });

  // ---- Rendering helpers ----

  const selectedAisle = isEditing && selectedAisleId !== null ? getDraftAisle(selectedAisleId) : undefined;

  // Grid cells that no aisle covers while editing, so the grid's shape is visible.
  const emptyCells: { gridCol: number; gridRow: number }[] = [];
  if (isEditing) {
    const covered = new Set<string>();
    let lastRow = 1;
    onGridAisles.forEach(aisle => {
      const footprint = footprintOf(aisle);
      lastRow = Math.max(lastRow, aisle.gridRow + footprint.rows - 1);
      for (let row = aisle.gridRow; row < aisle.gridRow + footprint.rows; row += 1) {
        for (let col = aisle.gridCol; col < aisle.gridCol + footprint.cols; col += 1) {
          covered.add(`${col}-${row}`);
        }
      }
    });
    for (let gridRow = 1; gridRow <= lastRow + 1; gridRow += 1) {
      for (let gridCol = 1; gridCol <= GRID_COLUMNS; gridCol += 1) {
        if (!covered.has(`${gridCol}-${gridRow}`)) emptyCells.push({ gridCol, gridRow });
      }
    }
  }

  const InspectionModal = () => {
    if (!selectedRack) return null;
    return (
      <div className="modal-overlay active clean-modal">
        <div className="modal-content clean">
          <div className="rack-inspection-header">
            <div className="rack-inspection-icon-wrap"><i className="bx bxs-layer"></i></div>
            <div className="rack-inspection-title-wrap">
              <h2>Rack Inspection</h2>
              <div className="rack-inspection-subtitle">Cell Ident: {selectedRack.zoneId}-R{selectedRack.rackId.split('-')[1]}</div>
            </div>
            <button className="close-preview-btn" onClick={() => setSelectedRack(null)}><i className="bx bx-x"></i></button>
          </div>
          <div className="inspection-main">
            <div className="aisle-info-row">
              <div className="aisle-badge">Aisle {selectedRack.rackId}</div>
            </div>
            <div className="level-container">
              {['L4', 'L3', 'L2', 'L1'].map((lvl, idx) => {
                const rackItems = inventory.filter(i => normalizeRack(i.rack) === normalizeRack(selectedRack.rackId));
                const levelItems = rackItems.filter((i, itemIdx) => i.level ? i.level === lvl : (itemIdx % 4) === (3 - idx));
                return (
                  <div key={lvl} className="level-row-modern">
                    <div className="level-label-modern">{lvl}</div>
                    <div className={`level-belt ${levelItems.length > 0 ? 'occupied-belt' : ''}`}>
                      {levelItems.map(i => (
                        <div
                          key={i.id}
                          className={`item-token ${isAtReorderPoint(i, movements) ? 'low-stock-alert' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => onEditItem(i.id)}
                        >
                          <div className="flex-col" style={{ alignItems: 'center' }}>
                            <span className="item-token-label">{i.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="content-section">
      {error && <div className="dash-card mb-4 border-accent p-3 text-accent label-micro text-center">{error}</div>}

      <div className="floor-tabs" role="tablist" aria-label="Warehouse floors">
        {layout.map(floor => {
          const isActive = floor.id === activeFloor?.id;
          const isMenuOpen = floorMenuId === floor.id;
          return (
            <div key={floor.id} className={`floor-tab${isActive ? ' active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="floor-tab-select"
                onClick={() => selectFloor(floor.id)}
              >
                <span>{floor.name}</span>
                <span className="floor-tab-count" title="Aisles on this floor">{floor.aisles.length}</span>
              </button>
              {isAdmin && (
                <div className="floor-tab-menu-wrap">
                  <button
                    type="button"
                    className="floor-tab-menu"
                    aria-label={`Options for ${floor.name}`}
                    aria-expanded={isMenuOpen}
                    disabled={isEditing}
                    onClick={() => setFloorMenuId(isMenuOpen ? null : floor.id)}
                  >
                    <i className="bx bx-dots-horizontal-rounded"></i>
                  </button>
                  {isMenuOpen && (
                    <div className="floor-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => openRenameFloor(floor)}>
                        <i className="bx bx-edit-alt"></i> Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="floor-menu-danger"
                        disabled={layout.length <= 1}
                        title={layout.length <= 1 ? 'The warehouse needs at least one floor' : undefined}
                        onClick={() => {
                          setFloorMenuId(null);
                          setFloorToDelete(floor.id);
                        }}
                      >
                        <i className="bx bx-trash"></i> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {isAdmin && !isEditing && (
          <button type="button" className="floor-tab-add" onClick={openAddFloor}>
            <i className="bx bx-plus"></i> Add Floor
          </button>
        )}
        {isAdmin && !isEditing && activeFloor && (
          <button type="button" className="floor-tab-add floor-tab-add-aisle" onClick={openAddAisle}>
            <i className="bx bx-plus"></i> Add Aisle to {activeFloor.name}
          </button>
        )}
        {isAdmin && (isEditing ? (
          <div className="layout-edit-bar">
            <span className={`layout-edit-status${isDirty ? ' is-dirty' : ''}`}>
              {isDirty ? 'Unsaved changes' : 'No changes yet'}
            </span>
            <button type="button" className="olive-button btn-outline" onClick={requestCancelEdit} disabled={isSavingLayout}>
              Cancel
            </button>
            <button type="button" className="olive-button" onClick={saveLayoutEdits} disabled={isSavingLayout || !isDirty}>
              {isSavingLayout ? 'Saving…' : 'Save Layout'}
            </button>
          </div>
        ) : (
          <button type="button" className="floor-tab-add" onClick={enterEditMode}>
            <i className="bx bx-edit-alt"></i> Edit Layout
          </button>
        ))}
      </div>

      {isEditing && (
        <div className="aisle-edit-panel">
          {selectedAisle ? (
            <>
              <div className="aisle-edit-panel-title">
                <strong>Aisle {selectedAisle.code}</strong>
                <span className="label-micro opacity-70">
                  {selectedAisle.orientation === 'landscape' ? 'Landscape' : 'Portrait'} · {selectedAisle.racks.length} racks
                </span>
              </div>
              <div className="aisle-edit-controls">
                <button
                  type="button"
                  className="aisle-edit-btn"
                  title="Rotate: portrait or landscape"
                  onClick={() => rotateAisle(selectedAisle.id)}
                >
                  <i className="bx bx-rotate-right"></i>
                  <span>{selectedAisle.orientation === 'portrait' ? 'Make landscape' : 'Make portrait'}</span>
                </button>
                <div className="aisle-rack-stepper">
                  <button
                    type="button"
                    onClick={() => changeRackCount(selectedAisle.id, -1)}
                    disabled={selectedAisle.racks.length <= 1}
                    aria-label="Remove rack"
                  >
                    <i className="bx bx-minus"></i>
                  </button>
                  <span className="font-mono">{selectedAisle.racks.length} racks</span>
                  <button
                    type="button"
                    onClick={() => changeRackCount(selectedAisle.id, 1)}
                    disabled={selectedAisle.racks.length >= MAX_RACKS}
                    aria-label="Add rack"
                  >
                    <i className="bx bx-plus"></i>
                  </button>
                </div>
                <label className="aisle-edit-field">
                  <span className="label-micro">Name</span>
                  <input
                    type="text"
                    className="aisle-rename-input font-mono"
                    value={selectedAisle.code}
                    maxLength={8}
                    onChange={(event) => renameAisle(selectedAisle.id, event.target.value)}
                  />
                </label>
                <label className="aisle-edit-field">
                  <span className="label-micro">Floor</span>
                  <select
                    className="aisle-floor-select"
                    value={selectedAisle.floorId}
                    onChange={(event) => moveAisleToFloor(selectedAisle.id, Number(event.target.value))}
                  >
                    {layout.map(floor => (
                      <option key={floor.id} value={floor.id}>{floor.name}</option>
                    ))}
                  </select>
                </label>
                <label className="aisle-edit-field">
                  <span className="label-micro">Description</span>
                  <input
                    type="text"
                    className="aisle-description-input"
                    list="aisle-category-options"
                    value={selectedAisle.category}
                    maxLength={100}
                    onChange={(event) => setAisleCategory(selectedAisle.id, event.target.value)}
                  />
                  <datalist id="aisle-category-options">
                    {categoryChoices.map(([name]) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
                <button
                  type="button"
                  className="aisle-edit-btn danger"
                  title={aisleItemCount(selectedAisle.code) > 0 ? 'Move the items out of this aisle first' : 'Delete aisle'}
                  disabled={aisleItemCount(selectedAisle.code) > 0}
                  onClick={() => deleteAisleInDraft(selectedAisle.id)}
                >
                  <i className="bx bx-trash"></i> <span>Delete</span>
                </button>
              </div>
            </>
          ) : (
            <div className="label-micro opacity-70">
              Select an aisle to change it. Drag its handle (⠿) to move it to another spot on the grid.
            </div>
          )}
          <div className="label-micro opacity-70 aisle-edit-note">
            Save Layout applies every change at once. Cancel discards them.
          </div>
        </div>
      )}

      <div className="warehouse-layout-container">
        <div className="warehouse-map-scroll">
          <div className="warehouse-map-grid" ref={gridRef}>
            {aisles.length === 0 && (
              <div className="label-micro text-center" style={{ gridColumn: '1 / -1', alignSelf: 'center' }}>
                The warehouse layout is not available yet.
              </div>
            )}

            {emptyCells.map(cell => (
              <div
                key={`empty-${cell.gridCol}-${cell.gridRow}`}
                className="grid-empty-cell"
                style={{ gridColumn: cell.gridCol, gridRow: cell.gridRow }}
              />
            ))}

            {onGridAisles.map(aisle => {
              const isLandscape = aisle.orientation === 'landscape';
              const footprint = footprintOf(aisle);
              const rackCount = Math.max(aisle.racks.length, 1);
              const isSelected = isEditing && aisle.id === selectedAisleId;
              const isDragged = pointerDrag?.aisleId === aisle.id;
              return (
                <div
                  key={aisle.id}
                  className={`aisle-group${isLandscape ? ' aisle-group-landscape' : ''}${isEditing ? ' is-editing' : ''}${isSelected ? ' is-selected' : ''}${isDragged ? ' is-dragging' : ''}`}
                  style={{
                    gridColumn: `${aisle.gridCol} / span ${footprint.cols}`,
                    gridRow: `${aisle.gridRow} / span ${footprint.rows}`,
                    gridTemplateColumns: isLandscape ? `repeat(${rackCount}, minmax(0, 1fr))` : undefined,
                    gridTemplateRows: isLandscape ? 'var(--rack-h)' : `repeat(${rackCount}, var(--rack-h))`,
                    '--aisle-color': aisle.color,
                  } as React.CSSProperties}
                  onClick={isEditing ? () => setSelectedAisleId(aisle.id) : undefined}
                >
                  <div className="aisle-label" title={`Aisle ${aisle.code} · ${aisle.category}`}>
                    <span className="aisle-label-code">Aisle {aisle.code}</span>
                    <span className="aisle-label-category">{aisle.category}</span>
                    {isEditing && (
                      <span
                        className="aisle-drag-handle"
                        role="button"
                        tabIndex={0}
                        aria-label={`Drag Aisle ${aisle.code}`}
                        title="Drag to move this aisle"
                        onPointerDown={(event) => startAisleDrag(event, aisle)}
                        onPointerMove={moveAisleDrag}
                        onPointerUp={endAisleDrag}
                        onPointerCancel={() => setPointerDrag(null)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <i className="bx bx-move"></i>
                      </span>
                    )}
                  </div>
                  {aisle.racks.map(rack => {
                    const rackSpecificItems = inventory.filter(item => normalizeRack(item.rack) === normalizeRack(rack.code));
                    const hasLowStock = rackSpecificItems.some(item => isAtReorderPoint(item, movements));
                    return (
                      <div
                        key={rack.id}
                        className={`rack ${hasLowStock ? 'low-stock-alert' : ''}`}
                        onClick={isEditing ? undefined : () => setSelectedRack({ zoneId: aisle.code, rackId: rack.code })}
                      >
                        <div className="rack-icon">
                          {[1, 2, 3, 4].map(b => <div key={b} className="rack-bar"></div>)}
                        </div>
                        <div className="rack-id">Rack {rack.number}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {pointerDrag && (
              <div
                className={`aisle-drop-ghost ${pointerDrag.valid ? 'is-valid' : 'is-invalid'}`}
                style={{
                  gridColumn: `${pointerDrag.col} / span ${pointerDrag.footprint.cols}`,
                  gridRow: `${pointerDrag.row} / span ${pointerDrag.footprint.rows}`,
                }}
              />
            )}
          </div>
        </div>

        <div className="location-analytics-container">
          <div className="dash-card">
            <div className="warehouse-optimizer border-soft mt-4 p-4">
              <div className="flex-col mb-4">
                <span className="label-micro"><i className="bx bx-bolt-circle"></i> WAREHOUSE LAYOUT OPTIMIZER</span>
                <p className="label-micro opacity-70 mt-1" style={{ textTransform: 'none', lineHeight: '1.4' }}>
                  Optimize layout by demand.
                </p>
              </div>
              <button className={`olive-button w-full ${isOptimizing ? 'opacity-50' : ''}`} onClick={runOptimization} disabled={isOptimizing}>
                {isOptimizing ? <i className="bx bx-loader-alt bx-spin mr-2"></i> : <i className="bx bx-refresh mr-2"></i>}
                Analyze & Optimize Layout
              </button>
            </div>
            <div className="flex-row-between mb-2">
              <span className="label-micro">Aisle Density Analytics</span>
              <button
                type="button"
                className="analytics-scope-toggle"
                onClick={() => setAnalyticsScope(scope => (scope === 'floor' ? 'all' : 'floor'))}
              >
                {analyticsScope === 'all' ? 'All floors' : 'This floor'}
              </button>
            </div>
            <div className="flex-col-gap" style={{ gap: '0.5rem' }}>
              {aisleData.map(a => (
                <div key={a.id} className="aisle-analytics-card border-soft">
                  <div className="flex-row-between mb-1" style={{ paddingRight: '3px' }}>
                    <span className="aisle-header-text">AISLE {a.id} ({a.uniqueItems})</span>
                    <span className={`status-chip ${a.statusClass}`} style={{ padding: '1px 6px', fontSize: '8px' }}>{a.statusText}</span>
                  </div>
                  <div className="density-bar-bg" style={{ margin: '0.5rem 0' }}>
                    <div className="density-bar-fill" style={{ width: `${a.density}%`, background: a.density > 80 ? 'var(--accent)' : 'var(--ink)' }}></div>
                  </div>
                  <div className="flex-row-end"><span className="label-micro font-mono" style={{ fontSize: '11px', padding: '0 3px' }}>{a.density}%</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <InspectionModal />

      {floorDialog && (
        <Modal
          isOpen={true}
          onClose={() => setFloorDialog(null)}
          title={floorDialog.mode === 'add' ? 'Add Floor' : 'Rename Floor'}
          type="mini"
          footer={
            <div className="flex-row-gap">
              <button className="olive-button btn-outline" onClick={() => setFloorDialog(null)} disabled={isSavingFloor}>Cancel</button>
              <button className="olive-button" onClick={saveFloor} disabled={isSavingFloor}>
                {isSavingFloor ? 'Saving…' : floorDialog.mode === 'add' ? 'Add Floor' : 'Save'}
              </button>
            </div>
          }
        >
          <div className="form-group">
            <label className="label-micro" htmlFor="floor-name-input">Floor name</label>
            <input
              id="floor-name-input"
              type="text"
              className="form-input"
              value={floorName}
              maxLength={100}
              autoFocus
              onChange={(event) => setFloorName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveFloor();
              }}
            />
          </div>
          {error && <div className="label-micro text-accent mt-2">{error}</div>}
        </Modal>
      )}

      {aisleDialogOpen && (
        <Modal
          isOpen={true}
          onClose={() => setAisleDialogOpen(false)}
          title={`Add Aisle to ${activeFloor?.name ?? 'Floor'}`}
          type="mini"
          footer={
            <div className="flex-row-gap">
              <button className="olive-button btn-outline" onClick={() => setAisleDialogOpen(false)} disabled={isSavingFloor}>Cancel</button>
              <button className="olive-button" onClick={saveAisle} disabled={isSavingFloor}>
                {isSavingFloor ? 'Adding…' : 'Add Aisle'}
              </button>
            </div>
          }
        >
          <div className="form-group">
            <label className="label-micro" htmlFor="aisle-code-input">Aisle name</label>
            <input
              id="aisle-code-input"
              type="text"
              className="form-input font-mono"
              value={aisleDraft.code}
              maxLength={8}
              onChange={(event) => setAisleDraft(draft => ({ ...draft, code: event.target.value.toUpperCase() }))}
            />
            <span className="label-micro opacity-70" style={{ textTransform: 'none' }}>
              Names must be unique across all floors.
            </span>
          </div>

          <div className="form-group">
            <label className="label-micro" htmlFor="aisle-category-select">Category</label>
            <select
              id="aisle-category-select"
              className="form-input"
              value={aisleDraft.categoryChoice}
              onChange={(event) => setAisleDraft(draft => ({ ...draft, categoryChoice: event.target.value }))}
            >
              {categoryChoices.map(([name]) => (
                <option key={name} value={name}>{name}</option>
              ))}
              <option value={NEW_CATEGORY}>Create new category…</option>
            </select>
          </div>

          {aisleDraft.categoryChoice === NEW_CATEGORY && (
            <div className="flex-row-gap" style={{ alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="label-micro" htmlFor="aisle-new-category">New category name</label>
                <input
                  id="aisle-new-category"
                  type="text"
                  className="form-input"
                  value={aisleDraft.newCategory}
                  maxLength={100}
                  onChange={(event) => setAisleDraft(draft => ({ ...draft, newCategory: event.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="label-micro" htmlFor="aisle-new-color">Color</label>
                <input
                  id="aisle-new-color"
                  type="color"
                  className="aisle-color-input"
                  value={aisleDraft.newColor}
                  onChange={(event) => setAisleDraft(draft => ({ ...draft, newColor: event.target.value }))}
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <span className="label-micro">Orientation</span>
            <div className="orientation-options" role="radiogroup" aria-label="Aisle orientation">
              {(['portrait', 'landscape'] as AisleOrientation[]).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={aisleDraft.orientation === option}
                  className={`orientation-option${aisleDraft.orientation === option ? ' selected' : ''}`}
                  onClick={() => setAisleDraft(draft => ({ ...draft, orientation: option }))}
                >
                  <span className={`orientation-preview ${option}`} aria-hidden="true">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <span key={index} className="orientation-preview-rack"></span>
                    ))}
                  </span>
                  <span className="label-micro">{option === 'portrait' ? 'Portrait' : 'Landscape'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <span className="label-micro">Racks</span>
            <div className="rack-count-stepper">
              <button
                type="button"
                onClick={() => setAisleDraft(draft => ({ ...draft, rackCount: Math.max(1, draft.rackCount - 1) }))}
                disabled={aisleDraft.rackCount <= 1}
                aria-label="Remove one rack"
              >
                <i className="bx bx-minus"></i>
              </button>
              <span className="font-mono">{aisleDraft.rackCount}</span>
              <button
                type="button"
                onClick={() => setAisleDraft(draft => ({ ...draft, rackCount: Math.min(MAX_RACKS, draft.rackCount + 1) }))}
                disabled={aisleDraft.rackCount >= MAX_RACKS}
                aria-label="Add one rack"
              >
                <i className="bx bx-plus"></i>
              </button>
            </div>
          </div>

          {error && <div className="label-micro text-accent mt-2">{error}</div>}
        </Modal>
      )}

      {floorToDelete !== null && (
        <Modal
          isOpen={true}
          onClose={() => setFloorToDelete(null)}
          title="Delete Floor"
          type="mini"
          footer={
            <div className="flex-row-gap">
              <button className="olive-button btn-outline" onClick={() => setFloorToDelete(null)} disabled={isSavingFloor}>Cancel</button>
              <button className="olive-button btn-danger" onClick={deleteFloor} disabled={isSavingFloor}>
                {isSavingFloor ? 'Deleting…' : 'Delete Floor'}
              </button>
            </div>
          }
        >
          <p className="label-micro" style={{ textTransform: 'none', lineHeight: 1.5 }}>
            Delete {layout.find(floor => floor.id === floorToDelete)?.name ?? 'this floor'} and all of its aisles and racks?
            A floor that still holds items cannot be deleted.
          </p>
        </Modal>
      )}

      {showDiscardPrompt && (
        <Modal
          isOpen={true}
          onClose={() => setShowDiscardPrompt(false)}
          title="Discard unsaved changes?"
          type="mini"
          footer={
            <div className="flex-row-gap">
              <button className="olive-button btn-outline" onClick={() => setShowDiscardPrompt(false)}>Keep Editing</button>
              <button className="olive-button btn-danger" onClick={leaveEditMode}>Discard Changes</button>
            </div>
          }
        >
          <p className="label-micro" style={{ textTransform: 'none', lineHeight: 1.5 }}>
            Your layout changes have not been saved. Leaving edit mode now will throw them away.
          </p>
        </Modal>
      )}

      {rackRemoval && (
        <Modal
          isOpen={true}
          onClose={() => setRackRemoval(null)}
          title="Rack still holds items"
          type="mini"
          footer={
            <div className="flex-row-gap">
              <button className="olive-button btn-outline" onClick={() => setRackRemoval(null)}>Cancel</button>
              <button className="olive-button btn-danger" onClick={confirmRackRemoval} disabled={!rackRemoval.targetRack}>
                Move Items &amp; Remove Rack
              </button>
            </div>
          }
        >
          <p className="label-micro" style={{ textTransform: 'none', lineHeight: 1.5 }}>
            Rack <span className="font-mono">{rackRemoval.code}</span> holds {rackRemoval.itemCount} item
            {rackRemoval.itemCount === 1 ? '' : 's'}. Choose the rack to move them to. The items are moved right away.
          </p>
          <div className="form-group">
            <label className="label-micro" htmlFor="rack-move-target">Move items to</label>
            <select
              id="rack-move-target"
              className="form-input font-mono"
              value={rackRemoval.targetRack}
              onChange={(event) => setRackRemoval(current => (current ? { ...current, targetRack: event.target.value } : current))}
            >
              {allRackCodes().filter(code => code !== rackRemoval.code).map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {optimizationResult && (
        <Modal
          isOpen={true}
          onClose={() => setOptimizationResult(null)}
          title="DEMAND-BASED LAYOUT OPTIMIZER"
          type="wide"
          footer={
            <div className="flex-row-gap">
               <button className="olive-button btn-outline" onClick={() => setOptimizationResult(null)}>Discard</button>
               <button className="olive-button" onClick={applyOptimization}>Apply Relocations ({optimizationResult.length})</button>
            </div>
          }
        >
           <div className="flex-col-gap">
              <div className="flex-row-between mb-2 p-2 border-soft" style={{ background: 'var(--bg)', borderRadius: '6px', fontSize: '11px' }}>
                <span><strong>{optimizationResult.length}</strong> items recommended for demand-based relocation</span>
                <span className="label-micro font-mono text-bold" style={{ color: 'var(--ink)' }}>High Demand prioritized in High Demand aisles</span>
              </div>
              <div className="table-container" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                <div className="table-header table-grid" style={{ gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr 2.6fr', fontSize: '10px' }}>
                  <span className="label-table">Item & Category</span>
                  <span className="label-table">Demand</span>
                  <span className="label-table">Current</span>
                  <span className="label-table">Optimized</span>
                  <span className="label-table">Demand Rationale</span>
                </div>
                <div className="table-body">
                   {optimizationResult.map((res, idx) => (
                     <div key={idx} className="table-row table-grid" style={{ gridTemplateColumns: '2.2fr 1.2fr 1fr 1fr 2.6fr', fontSize: '10px', alignItems: 'center' }}>
                        <div className="flex-col" style={{ gap: '2px' }}>
                          <span className="text-bold">{res.name}</span>
                          <span className="label-micro font-mono opacity-50" style={{ fontSize: '8px' }}>{res.id} · {res.category}</span>
                        </div>
                        <div>
                          <span className={res.demand === 'HIGH' ? 'badge-demand-high' : res.demand === 'LOW' ? 'badge-demand-low' : 'badge-demand-med'}>
                            {res.demand === 'HIGH' ? 'High Demand' : res.demand === 'LOW' ? 'Low Demand' : 'Medium Demand'}
                          </span>
                        </div>
                        <div className="font-mono opacity-60" style={{ fontSize: '11px' }}>
                          <span>{res.oldRack}</span>
                        </div>
                        <div className="font-mono text-bold" style={{ fontSize: '11px' }}>
                          <span className="text-success">{res.newRack}</span>
                        </div>
                        <div className="flex-col" style={{ gap: '2px', fontSize: '9px', lineHeight: '1.3' }}>
                          <span className="opacity-90">{res.demandReason}</span>
                        </div>
                     </div>
                   ))}
                 </div>
              </div>
           </div>
        </Modal>
      )}
    </div>
  );
};
