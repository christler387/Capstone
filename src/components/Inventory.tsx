

import React, { useState } from 'react';
import { Item, Movement, UserRole } from '../types';
import { BarcodeScanner } from './BarcodeScanner';
import { getReorderQuantity, isAtReorderPoint } from '../inventoryMetrics';

interface InventoryProps {
  inventory: Item[];
  movements?: Movement[];
  onEditItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onGoToStock: (id: string) => void;
  onAddItem: () => void;
  onZoomImage: (url: string, name: string) => void;
  onLocateOnMap: (rack: string) => void;
  userRole?: UserRole;
}

export const Inventory: React.FC<InventoryProps> = ({ 
  inventory, 
  movements = [], 
  onEditItem, 
  onDeleteItem, 
  onGoToStock,
  onAddItem, 
  onZoomImage, 
  onLocateOnMap, 
  userRole = 'staff' 
}) => {

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sortField, setSortField] = useState<keyof Item>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isScannerOpen, setIsScannerOpen] = useState(false);


  const handleToggleSort = (field: keyof Item) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatLocation = (rack: string) => {
    if (!rack) return '---';
    if (rack.includes('-')) return rack;
    const match = rack.match(/^([A-Z])(\d+)$/);
    if (match) {
      const aisle = match[1];
      const shelf = match[2].padStart(2, '0');
      return `${aisle}-${shelf}`;
    }
    return rack;
  };


  const totalItems = inventory.length;
  const totalValue = inventory.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const lowCount = inventory.filter(i => isAtReorderPoint(i, movements)).length;

  const filteredInventory = inventory
    .filter(i => {
      const matchesSearch = [i.name, i.id, i.category, i.barcode || '', i.compatibleVehicles || ''].some(v => v.toLowerCase().includes(search.toLowerCase()));
      const matchesCategory = categoryFilter === 'ALL' || i.category === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      const valA = String(a[sortField]).toLowerCase();
      const valB = String(b[sortField]).toLowerCase();
      return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });


  const renderFilterSection = () => (
    <div className="flex-row-gap px-6 mb-4 overflow-x-auto no-scrollbar" style={{ padding: '0 var(--gap)' }}>
      {['ALL', 'BODY', 'BRAKES', 'ELECTRICAL', 'ENGINE', 'SUSPENSION', 'TRANSMISSION', 'MISC'].map(cat => (
        <button 
          key={cat}
          className={`nav-btn ${categoryFilter === cat ? 'active' : ''}`} 
          onClick={() => setCategoryFilter(cat)}
        >
          {cat.charAt(0) + cat.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );

  const renderScannerDrawer = () => (
    <div className="scanner-container-inline mb-6 p-4 border-soft" style={{ background: 'var(--bg-card)' }}>
      <BarcodeScanner 
        onScanSuccess={(val) => {
          setSearch(val);
          setIsScannerOpen(false);
        }} 
      />
    </div>
  );

  
  return (
    <div className="content-section">
      <div className="actions-bar flex-row-between">
        <div className="flex-row-gap">
          <p className="label-micro opacity-50">Inventory Ledger</p>
          <div className="search-wrapper">
            <i className="bx bx-search search-icon-small opacity-50"></i>
            <input 
              type="text" 
              className="form-input search-input-small" 
              placeholder="Search items or scan..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button 
              className={`barcode-scan-toggle ${isScannerOpen ? 'active' : ''}`}
              onClick={() => setIsScannerOpen(!isScannerOpen)}
              title="Toggle Barcode Scanner"
            >
              <i className={`bx ${isScannerOpen ? 'bx-x' : 'bx-barcode-reader'}`}></i>
            </button>
          </div>
        </div>
        {userRole === 'admin' ? (
          <button className="olive-button" onClick={onAddItem}>+ Add Item</button>
        ) : (
          <span className="label-micro opacity-50" style={{ fontSize: '10px', alignSelf: 'center' }}>
            <i className="bx bx-lock-alt mr-1"></i> Read Only (Staff)
          </span>
        )}
      </div>

      {isScannerOpen && renderScannerDrawer()}
      
      {renderFilterSection()}

      <main>
        <div className="table-container">
          <div className="table-header table-grid inventory-grid">
            <span className="label-table">Img</span>
            <span className="label-table sortable" onClick={() => handleToggleSort('name')}>
              Part Name
              <i className={`bx bx-chevron-${sortDirection === 'asc' ? 'down' : 'up'} sort-icon-inner ${sortField === 'name' ? '' : 'hidden'}`}></i>
            </span>
            <span className="label-table">Category</span>
            <span className="label-table">Location</span>
            <span className="label-table text-right">Qty</span>
            <span className="label-table text-right">Reorder Qty</span>
            <span className="label-table text-right">Price</span>
            <span className="label-table text-right">{userRole === 'admin' ? 'Actions' : 'Locate'}</span>
          </div>

          <div className="table-body">
            {filteredInventory.map(i => {
              const isLow = isAtReorderPoint(i, movements);
              const reorderQuantity = getReorderQuantity(i, movements);
              const needsReorder = isAtReorderPoint(i, movements);
              return (
                <div 
                  key={i.id} 
                  className="table-row table-grid inventory-grid" 
                  style={{ cursor: 'pointer' }} 
                  onClick={() => onEditItem(i.id)}
                >
                  <span className="img-cell">
                    {i.image ? (
                      <img src={i.image} className="inventory-image" onClick={(e) => { e.stopPropagation(); onZoomImage(i.image!, i.name); }} referrerPolicy="no-referrer" alt={i.name} />
                    ) : (
                      <span className="inventory-image placeholder-img"></span>
                    )}
                  </span>
                  
                  <div className="name-cell flex-col" style={{ gap: '2px' }}>
                    <span style={{ fontWeight: 600 }}>{i.name}</span>
                    {i.compatibleVehicles && (
                      <span className="text-success compatibility-line" style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <i className="bx bxs-car"></i> Fits: {i.compatibleVehicles}
                      </span>
                    )}
                    <div className="flex-row items-center gap-2 opacity-50 meta-row" style={{ display: 'flex' }}>
                      <span>ID: {i.id}</span>
                      <span>•</span>
                      <span style={{ fontFamily: 'var(--f-sans)' }}>BC: {i.barcode || '---'}</span>
                    </div>
                  </div>

                  <span className="cat-cell">{i.category}</span>
                  
                  <div className="location-cell-flex flex-row items-center gap-2">
                    <div className="flex-col items-start gap-1">
                      <span className="location-badge" onClick={(e) => { e.stopPropagation(); onLocateOnMap(i.rack); }}>
                        {formatLocation(i.rack)}
                      </span>
                      {i.level && (
                        <span className="id-cell" style={{ fontSize: '9px', opacity: 0.6, textTransform: 'none' }}>Level: {i.level}</span>
                      )}
                    </div>
                  </div>

                  <span className={`qty-cell ${isLow ? 'alert-text' : ''}`}>{String(i.quantity).padStart(3, '0')}</span>
                  <span
                    className={`price-cell ${needsReorder ? 'alert-text' : ''}`}
                    title="Open stock-in for this item"
                    onClick={(event) => { event.stopPropagation(); onGoToStock(i.id); }}
                    style={{ cursor: 'pointer' }}
                  >
                    {String(reorderQuantity).padStart(2, '0')}
                  </span>
                  <span className="price-cell">₱{i.price.toFixed(2)}</span>
                  
                  <span className="actions-cell text-right">
                    {userRole === 'admin' ? (
                      <button className="receipt-btn text-accent" onClick={(e) => { e.stopPropagation(); onDeleteItem(i.id); }}>
                        <i className="bx bx-trash"></i>
                      </button>
                    ) : (
                      <button className="receipt-btn" onClick={(e) => { e.stopPropagation(); onLocateOnMap(i.rack); }} title="Locate on map">
                        <i className="bx bx-map-pin"></i>
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};

