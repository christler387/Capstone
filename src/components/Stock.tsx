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
}


export const Stock: React.FC<StockProps> = ({ 
  inventory, 
  onAddMovement, 
  onAddItem, 
  selectedItemId, 
  userRole = 'staff',
  userName
}) => {


  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmOverdraw, setShowConfirmOverdraw] = useState<boolean>(false);
  const [pendingMovement, setPendingMovement] = useState<Movement | null>(null);
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
    setFormData({
      itemId: id,
      name: item?.name || '',
      category: item?.category || '',
      rack: item?.rack || '',
      compatibleVehicles: item?.compatibleVehicles || '',
      qty: 0
    });
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

    const movement: Movement = {
      id: `MOV-${Date.now()}`,
      itemId: formData.itemId,
      type: type.toUpperCase() as 'IN' | 'OUT',
      qty: formData.qty,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now(),
      createdBy: userName || undefined
    };
    setPendingMovement(movement);
  };

  const confirmMovement = async () => {
    if (!pendingMovement) return;
    await onAddMovement(pendingMovement);
    setFormData(prev => ({ ...prev, qty: 0 }));
    setPendingMovement(null);
    setShowConfirmOverdraw(false);
  };


  const renderFormFields = (type: 'in' | 'out') => (
    <div className="flex-col-gap">
      {error && (
        <div 
          className="font-mono alert-text" 
          style={{ 
            fontSize: '11px', 
            padding: '0.75rem', 
            border: '1px solid var(--accent)', 
            background: 'rgba(255, 68, 68, 0.05)', 
            borderRadius: 'var(--radius)'
          }}
        >
          <i className="bx bx-error-circle" style={{ marginRight: '6px', verticalAlign: 'middle' }}></i>
          {error}
        </div>
      )}

      {showConfirmOverdraw && (
        <div 
          className="font-mono alert-text" 
          style={{ 
            fontSize: '11px', 
            padding: '1rem', 
            border: '1px solid var(--accent)', 
            background: 'rgba(255, 68, 68, 0.08)', 
            borderRadius: 'var(--radius)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          <div>
            <i className="bx bx-error" style={{ marginRight: '6px', fontSize: '13px', verticalAlign: 'middle' }}></i>
            <strong>CRITICAL STOCK SHORTAGE:</strong> The requested deduction quantity is greater than the available stock. Do you wish to override and force the stock deduction?
          </div>
          <div className="flex-row-gap gap-2">
            <button 
              className="olive-button btn-danger label-micro" 
              style={{ padding: '4px 10px', fontSize: '9px', textTransform: 'none' }}
              onClick={() => handleRecord(type, true)}
            >
              Force Deduct
            </button>
            <button 
              className="olive-button btn-outline label-micro" 
              style={{ padding: '4px 10px', fontSize: '9px', textTransform: 'none' }}
              onClick={() => setShowConfirmOverdraw(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isScannerOpen && (
        <div className="scanner-container-inline mb-4 p-4 border-soft" style={{ background: 'var(--bg-card)' }}>
          <div className="flex-row-between mb-2">
            <span className="label-micro"><i className="bx bx-camera"></i> Scan Item</span>
          </div>
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
      <div className="form-group">
        <label className="label-micro">{type === 'in' ? 'Select Item to Restock' : 'Select Item to Deduct'}</label>
        <select className="form-input" value={formData.itemId} onChange={(e) => handleItemSelect(e.target.value, type)}>
          <option value="">-- Select Item --</option>
          {type === 'in' && userRole === 'admin' && <option value="NEW">-- Add New Item --</option>}
          {[...inventory].sort((a, b) => a.name.localeCompare(b.name)).map(i => <option key={i.id} value={i.id}>{i.id} - {i.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="label-micro">Item Name</label>
        <input type="text" className="form-input" value={formData.name} readOnly placeholder="Part Name" />
      </div>
      <div className="form-group">
        <label className="label-micro">Category</label>
        <input type="text" className="form-input" value={formData.category} readOnly placeholder="Category" />
      </div>
      {formData.compatibleVehicles && (
        <div className="form-group">
          <label className="label-micro">Compatible Vehicles</label>
          <input type="text" className="form-input text-success font-semibold" style={{ color: 'var(--success)' }} value={formData.compatibleVehicles} readOnly placeholder="None" />
        </div>
      )}
      {type === 'in' && (
        <div className="form-group">
          <label className="label-micro">Rack Location</label>
          <input 
            type="text" 
            className="form-input" 
            value={formData.rack} 
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setFormData(prev => ({ ...prev, rack: val }));
            }} 
            placeholder="e.g. A1" 
          />
        </div>
      )}
      <div className="form-group">
        <label className="label-micro">Quantity to {type === 'in' ? 'Add' : 'Deduct'} <span className="text-accent">*</span></label>
        <input 
          type="number" 
          className="form-input font-mono" 
          placeholder="0" 
          min="1" 
          value={formData.qty || ''} 
          onChange={(e) => {
            const val = e.target.value;
            setFormData(prev => ({ ...prev, qty: val === '' ? 0 : parseInt(val, 10) || 0 }));
          }} 
        />
      </div>
      <button className={`olive-button ${type === 'out' ? 'btn-danger' : ''}`} onClick={() => handleRecord(type)}>
        Record Stock {type === 'in' ? 'In' : 'Out'}
      </button>
    </div>
  );

  
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
            <span className="label-micro">Stock {tab === 'in' ? 'In' : 'Out'} Log</span>
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
            <button className={`olive-button ${pendingMovement?.type === 'OUT' ? 'btn-danger' : ''}`} style={{ flex: 1 }} onClick={confirmMovement}>Confirm</button>
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

