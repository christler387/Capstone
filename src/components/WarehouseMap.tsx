import React, { useState, useEffect } from 'react';
import { Item, Movement, WarehouseLayout } from '../types';
import { Modal } from './Modal';
import { isAtReorderPoint } from '../inventoryMetrics';

// Density uses this capacity for racks that have no capacity set. Three racks make the old 1000 per aisle.
const DEFAULT_RACK_CAPACITY = 1000 / 3;

// "AA-01" -> "AA". Works for aisle names of any length.
const aisleCodeOfRack = (rack: string | undefined): string => {
  const value = (rack || '').toUpperCase();
  const dashIndex = value.lastIndexOf('-');
  return dashIndex > 0 ? value.slice(0, dashIndex) : value;
};

interface WarehouseMapProps {
  inventory: Item[];
  movements: Movement[];
  layout: WarehouseLayout;
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
  layout,
  onEditItem,
  onAddItem, 
  onBulkUpdate, 
  initialRack, 
  onClearInitialRack,
  userRole = 'staff'
}) => {


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


  const runOptimization = async () => {
    setIsOptimizing(true);
    setError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const proposals = inventory.map(item => {
        const demand = getItemDemand(item);
        const stockOutQty = getStockOutQty(item);
        const itemSeed = item.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const category = (item.category || '').trim().toUpperCase();
        const dedicatedAisleByCategory: Record<string, string> = {
          BODY: 'F',
          BRAKES: 'F',
          ELECTRICAL: 'H',
          ENGINE: 'H',
          SUSPENSION: 'I',
          TRANSMISSION: 'J',
        };
        const dedicatedAisle = dedicatedAisleByCategory[category];
        const isMiscCategory = !dedicatedAisle;
        const targetRackNum = 1 + (itemSeed % 3);
        let targetZone: string;
        let demandReason: string;

        if (isMiscCategory) {
          targetZone = itemSeed % 2 === 0 ? 'K' : 'L';
          demandReason = `${category || 'UNCATEGORIZED'} category → Aisle ${targetZone} (R0${targetRackNum}) dedicated category storage`;

        } else if (demand === 'HIGH') {
          targetZone = ['A', 'B', 'C', 'D'][itemSeed % 4];
          demandReason = `High Demand (${stockOutQty} units stocked out) → Aisle ${targetZone} (R0${targetRackNum}) dedicated fast-pick slot`;

        } else if (dedicatedAisle) {
          targetZone = dedicatedAisle;
          demandReason = `${category} category → Aisle ${targetZone} (R0${targetRackNum}) dedicated category storage`;
          
        } else {
          const usesDeepBufferAisle = ['TRANSMISSION', 'BULK', 'HEAVY'].some(
            keyword => category.includes(keyword),
          );
          targetZone = category.includes('ELECTRICAL')
            ? 'C'
            : usesDeepBufferAisle
              ? 'D'
              : 'B';
          const demandLabel = demand === 'LOW' ? 'Low' : 'Medium';
          const slotDescription = demand === 'LOW'
            ? 'deep buffer storage'
            : 'standard picking slot';
          demandReason = `${demandLabel} Demand (${stockOutQty} units stocked out) → Aisle ${targetZone} (R0${targetRackNum}) ${slotDescription}`;
        }

        const suggestedRack = `${targetZone}-${String(targetRackNum).padStart(2, '0')}`;

        return {
          id: item.id,
          name: item.name,
          category: item.category,
          demand,
          oldRack: item.rack || 'NONE',
          newRack: suggestedRack,
          demandReason
        };
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

  // Step 3: the map shows the first floor. Floor tabs replace this in the next step.
  const activeFloor = layout[0];
  const aisles = activeFloor?.aisles ?? [];

  const aisleData = aisles.map(aisle => {
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

      <div className="warehouse-layout-container">
        <div className="warehouse-map-grid">
          {aisles.length === 0 && (
            <div className="label-micro text-center" style={{ gridColumn: '1 / -1', alignSelf: 'center' }}>
              The warehouse layout is not available yet.
            </div>
          )}
          {aisles.map(aisle => {
            const isLandscape = aisle.orientation === 'landscape';
            const rackCount = Math.max(aisle.racks.length, 1);
            const rackGridStyle = isLandscape
              ? { gridTemplateColumns: `repeat(${rackCount}, minmax(72px, 1fr))` }
              : { gridTemplateRows: `repeat(${rackCount}, 1fr)` };
            return (
              <div
                key={aisle.id}
                className={`zone-cell${isLandscape ? ' zone-cell-landscape' : ''}`}
                style={{ gridColumn: aisle.gridCol, gridRow: aisle.gridRow }}
              >
                <div className="zone-top-header">
                  <div className="aisle-title">AISLE {aisle.code}</div>
                  <div className="picking-label" style={{ color: aisle.color, opacity: 1 }}>
                    {aisle.category}
                  </div>
                </div>
                <div className={`rack-container${isLandscape ? ' rack-container-landscape' : ''}`} style={rackGridStyle}>
                  {aisle.racks.map(rack => {
                    const rackSpecificItems = inventory.filter(item => normalizeRack(item.rack) === normalizeRack(rack.code));
                    const hasLowStock = rackSpecificItems.some(item => isAtReorderPoint(item, movements));
                    return (
                      <div
                        key={rack.id}
                        className={`rack ${hasLowStock ? 'low-stock-alert' : ''}`}
                        style={{ margin: 0, borderRadius: 12 }}
                        onClick={() => setSelectedRack({ zoneId: aisle.code, rackId: rack.code })}
                      >
                        <div className="rack-icon">
                          {[1, 2, 3, 4].map(b => <div key={b} className="rack-bar"></div>)}
                        </div>
                        <div className="rack-id">Rack {rack.number}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
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
            <div className="flex-row-between mb-2"><span className="label-micro">Aisle Density Analytics</span></div>
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
                <span className="label-micro font-mono text-bold" style={{ color: 'var(--ink)' }}>High Demand prioritized in Aisle A & Front Slots</span>
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
