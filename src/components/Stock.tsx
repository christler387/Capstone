import React, { useState, useEffect } from 'react';
import { Item, Movement, UserRole } from '../types';
import { BarcodeScanner } from './BarcodeScanner';
import { Modal } from './Modal';

interface StockProps {
  inventory: Item[];
  onAddMovement: (movement: Movement) => Promise<void> | void;
  onAddItem: (rack?: string) => void;
  selectedItemId?: string;
  userRole?: UserRole;
  userName?: string;
  // Every rack code in the warehouse layout, for the Rack Location dropdown.
  rackLocations?: string[];
}


export const Stock: React.FC<StockProps> = ({
  inventory,
  onAddMovement,
  onAddItem,
  selectedItemId,
  userRole = 'staff',
  userName,
  rackLocations = []
}) => {


  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmOverdraw, setShowConfirmOverdraw] = useState<boolean>(false);
  const [pendingMovement, setPendingMovement] = useState<Movement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [formData, setFormData] = useState({
    itemId: selectedItemId || '',
    name: '',
    category: '',
    rack: '',
    compatibleVehicles: '',
    qty: 0
  });


  useEffect(() => {
    setError(null);
    setShowConfirmOverdraw(false);
    if (selectedItemId) {
      const item = inventory.find(i => i.id === selectedItemId);
      if (item) {
        setItemSearch(`${item.id} - ${item.name}`);
        setFormData({
          itemId: selectedItemId,
          name: item.name,
          category: item.category,
          rack: item.rack || '',
          compatibleVehicles: item.compatibleVehicles || '',
          qty: 0
        });
      }
    }
  }, [selectedItemId, inventory]);


  const handleItemSelect = (id: string, type: 'in' | 'out') => {
    setError(null);
    setShowConfirmOverdraw(false);
    if (id === 'NEW') {
      onAddItem();
      return;
    }
    const item = inventory.find(i => i.id === id);
    setItemSearch(item ? `${item.id} - ${item.name}` : '');
    setFormData({
      itemId: id,
      name: item?.name || '',
      category: item?.category || '',
      rack: item?.rack || '',
      compatibleVehicles: item?.compatibleVehicles || '',
      qty: 0
    });
  };

  const handleItemSearch = (value: string, type: 'in' | 'out') => {
    setItemSearch(value);
    const query = value.trim().toLowerCase();
    const exactMatch = inventory.find(item => `${item.id} - ${item.name}`.toLowerCase() === query);
    if (exactMatch) {
      handleItemSelect(exactMatch.id, type);
      return;
    }
    setFormData(prev => ({ ...prev, itemId: '', name: '', category: '', rack: '', compatibleVehicles: '' }));
  };


  const handleRecord = (type: 'in' | 'out', force: boolean = false) => {
    setError(null);
    if (!formData.itemId || formData.qty <= 0) {
      setError('Select an item and enter a valid quantity.');
      return;
    }
    const item = inventory.find(i => i.id === formData.itemId);
    if (!item && type === 'out') return;
    
    if (type === 'out' && formData.qty > (item?.quantity || 0) && !force) {
      setShowConfirmOverdraw(true);
      return;
    }

    const activeUserName = userName || sessionStorage.getItem('skyrun_session_user') || 'Warehouse Staff';
    const movement: Movement = {
      // Unique per record, so two people recording at the same moment never share an ID.
      id: `MOV-${crypto.randomUUID()}`,
      itemId: formData.itemId,
      type: type.toUpperCase() as 'IN' | 'OUT',
      qty: formData.qty,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now(),
      createdBy: activeUserName
    };
    setPendingMovement(movement);
  };

  const confirmMovement = async () => {
    if (!pendingMovement || isRecording) return;
    setIsRecording(true);
    setError(null);
    try {
      await onAddMovement(pendingMovement);
      setFormData(prev => ({ ...prev, qty: 0 }));
      setPendingMovement(null);
      setShowConfirmOverdraw(false);
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : 'Could not record the movement. Please try again.');
    } finally {
      setIsRecording(false);
    }
  };


  const renderFormFields = (type: 'in' | 'out') => {
    const isIn = type === 'in';
    const selectedItem = formData.itemId ? inventory.find(i => i.id === formData.itemId) : undefined;
    const onHand = selectedItem?.quantity ?? 0;
    const qty = Number(formData.qty) || 0;
    const after = isIn ? onHand + qty : onHand - qty;
    const canRecord = Boolean(selectedItem) && qty > 0;
    const isShort = !isIn && qty > onHand;

    return (
      <div className="stock-form">
        {error && (
          <div className="stock-alert is-error" role="alert">
            <i className="bx bx-error-circle" aria-hidden="true"></i>
            <span>{error}</span>
          </div>
        )}

        {showConfirmOverdraw && (
          <div className="stock-alert is-warning" role="alert">
            <i className="bx bx-error" aria-hidden="true"></i>
            <div className="stock-alert-body">
              <p>
                Only <strong>{onHand.toLocaleString()}</strong> unit{onHand === 1 ? '' : 's'} are on hand, but you are deducting{' '}
                <strong>{qty.toLocaleString()}</strong>. Deduct anyway?
              </p>
              <div className="stock-alert-actions">
                <button type="button" className="olive-button btn-outline btn-mini" onClick={() => setShowConfirmOverdraw(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="olive-button btn-danger btn-mini"
                  onClick={() => { setShowConfirmOverdraw(false); handleRecord(type, true); }}
                >
                  Deduct anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {isScannerOpen && (
          <div className="stock-scanner">
            <span className="stock-section-label"><i className="bx bx-camera" aria-hidden="true"></i> Scan item</span>
            <BarcodeScanner
              onScanSuccess={(val) => {
                const found = inventory.find(i => i.id === val || i.barcode === val);
                if (found) {
                  handleItemSelect(found.id, type);
                  setIsScannerOpen(false);
                }
              }}
            />
          </div>
        )}

        <div className="stock-field">
          <label className="stock-section-label" htmlFor={`stock-search-${type}`}>
            {isIn ? 'Item to restock' : 'Item to deduct'}
          </label>

          {selectedItem ? (
            <div className="stock-selected">
              <div className="stock-selected-main">
                <span className="stock-selected-name">{selectedItem.name}</span>
                <span className="stock-selected-meta">
                  {selectedItem.id} · {selectedItem.category || 'No category'}
                  {selectedItem.rack ? ` · ${selectedItem.rack}` : ''}
                </span>
                {formData.compatibleVehicles && (
                  <span className="stock-selected-vehicles">{formData.compatibleVehicles}</span>
                )}
              </div>
              <div className="stock-selected-onhand">
                <span className="stock-selected-label">On hand</span>
                <span className="stock-selected-value">{onHand.toLocaleString()}</span>
              </div>
              <button
                type="button"
                className="stock-change"
                onClick={() => {
                  setItemSearch('');
                  setFormData(prev => ({ ...prev, itemId: '', name: '', category: '', rack: '', compatibleVehicles: '' }));
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="stock-item-search">
              <input
                id={`stock-search-${type}`}
                type="search"
                className="form-input stock-search"
                value={itemSearch}
                onChange={(e) => handleItemSearch(e.target.value, type)}
                placeholder="Search by item name or ID"
                aria-label={isIn ? 'Search item to restock' : 'Search item to deduct'}
                autoComplete="off"
              />
              {itemSearch.trim() && (
                <div className="stock-item-suggestions" role="listbox">
                  {isIn && userRole === 'admin' && (
                    <button type="button" className="stock-item-suggestion is-add" onClick={() => onAddItem()}>
                      <i className="bx bx-plus" aria-hidden="true"></i> Add a new item
                    </button>
                  )}
                  {[...inventory]
                    .filter(item => `${item.id} ${item.name}`.toLowerCase().includes(itemSearch.trim().toLowerCase()))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(item => (
                      <button type="button" className="stock-item-suggestion" key={item.id} onClick={() => handleItemSelect(item.id, type)}>
                        <span className="stock-item-suggestion-name">{item.name}</span>
                        <span className="stock-item-suggestion-meta">{item.id} · {item.quantity.toLocaleString()} on hand</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stock-grid">
          {isIn && (
            <div className="stock-field">
              <label className="stock-section-label" htmlFor="stock-rack">Rack location</label>
              <select
                id="stock-rack"
                className="form-input font-mono"
                value={formData.rack}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormData(prev => ({ ...prev, rack: val }));
                }}
              >
                <option value="">Not placed yet</option>
                {rackLocations.map(rack => (
                  <option key={rack} value={rack}>{rack}</option>
                ))}
              </select>
            </div>
          )}

          <div className="stock-field">
            <label className="stock-section-label" htmlFor={`stock-qty-${type}`}>
              Quantity to {isIn ? 'add' : 'deduct'} <span className="text-accent">*</span>
            </label>
            <input
              id={`stock-qty-${type}`}
              type="number"
              inputMode="numeric"
              className="form-input font-mono"
              placeholder="0"
              min="1"
              disabled={!selectedItem}
              value={formData.qty || ''}
              onChange={(e) => {
                const val = e.target.value;
                setFormData(prev => ({ ...prev, qty: val === '' ? 0 : parseInt(val, 10) || 0 }));
              }}
            />
          </div>
        </div>

        {selectedItem && (
          <div className={`stock-preview${isShort ? ' is-warning' : ''}`} aria-live="polite">
            <span>{qty > 0 ? 'Stock after this change' : 'Stock on hand'}</span>
            <span className="stock-preview-value">
              {qty > 0 ? `${onHand.toLocaleString()} → ${Math.max(0, after).toLocaleString()}` : onHand.toLocaleString()}
            </span>
          </div>
        )}

        <button
          type="button"
          className={`olive-button stock-submit ${isIn ? '' : 'btn-danger'}`}
          disabled={!canRecord}
          onClick={() => handleRecord(type)}
        >
          {isIn ? 'Record stock in' : 'Record stock out'}
        </button>
      </div>
    );
  };


  
  return (
    <div className="content-section">
      <div className="actions-bar border-soft-no-pad">
        <div className="flex-row-gap gap-2">
          <button className={`tab-btn ${tab === 'in' ? 'active' : ''}`} onClick={() => setTab('in')}>Stock In</button>
          <button className={`tab-btn ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>Stock Out</button>
        </div>
      </div>
      <div className="stock-tab-content">
        <div className="dash-card m-gap">
          <div className="flex-row-between">
            <div className="stock-heading">
              <h2 className="stock-title">{tab === 'in' ? 'Record stock in' : 'Record stock out'}</h2>
              <p className="stock-subtitle">{tab === 'in' ? 'Add units received for an existing item.' : 'Deduct units that left the warehouse.'}</p>
            </div>
            <button className={`barcode-pill-btn ${isScannerOpen ? 'active' : ''}`} onClick={() => setIsScannerOpen(!isScannerOpen)}>
              <i className="bx bx-barcode-reader"></i> 
              <span>{isScannerOpen ? 'CLOSING...' : 'SCAN BARCODE'}</span>
            </button>
          </div>
          {renderFormFields(tab)}
        </div>
      </div>
      <Modal
        isOpen={!!pendingMovement}
        onClose={() => setPendingMovement(null)}
        title={`Confirm Stock ${pendingMovement?.type === 'IN' ? 'In' : 'Out'}`}
        footer={
          <div className="flex-row-gap" style={{ width: '100%' }}>
            <button className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => setPendingMovement(null)}>Cancel</button>
            <button className={`olive-button ${pendingMovement?.type === 'OUT' ? 'btn-danger' : ''}`} style={{ flex: 1 }} onClick={confirmMovement} disabled={isRecording}>{isRecording ? 'Recording…' : 'Confirm'}</button>
          </div>
        }
      >
        <div className="text-center">
          <p className="label-micro text-lg mb-4">Record {pendingMovement?.qty || 0} unit{pendingMovement?.qty === 1 ? '' : 's'} {pendingMovement?.type === 'IN' ? 'into' : 'out of'} inventory?</p>
          <p className="label-micro opacity-50">Item: {inventory.find(item => item.id === pendingMovement?.itemId)?.name || pendingMovement?.itemId}</p>
        </div>
      </Modal>
    </div>
  );
};

