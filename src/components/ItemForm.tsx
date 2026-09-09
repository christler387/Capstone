import React, { useState } from 'react';
import { Item } from '../types';

interface ItemFormProps {
  item?: Partial<Item>;
  onSave: (data: Item) => void;
  onCancel: () => void;
  readOnly?: boolean;
}

export const ItemForm: React.FC<ItemFormProps> = ({ item, onSave, onCancel, readOnly = false }) => {
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Item>>(item || {
    id: '',
    name: '',
    barcode: '',
    category: '',
    rack: '',
    quantity: 0,
    price: 0,
    image: '',
    level: 'L1',
    size: 'MEDIUM',
    weight: 'MEDIUM',
    demand: 'MEDIUM',
    compatibleVehicles: '',
    orderingCost: 100,
    holdingCost: 0,
    leadTimeDays: 7,
    safetyStock: 0
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    const field = id.replace('edit-', '');
    setError(null);
    setFormData(prev => ({
      ...prev,
      [field]: ['quantity', 'price', 'orderingCost', 'holdingCost', 'leadTimeDays', 'safetyStock'].includes(field) ? parseFloat(value) : value
    }));
  };

  const handleSave = () => {
    if (!formData.id || !formData.name || !formData.category) {
      setError('Please fill in all required fields (Item ID, Part Identification, and Category).');
      return;
    }
    onSave(formData as Item);
  };

  return (
    <div className="flex-col-gap">
      {readOnly && (
        <div 
          className="label-micro opacity-70" 
          style={{ 
            fontSize: '11px', 
            padding: '0.5rem 0.75rem', 
            border: '1px solid var(--line)', 
            background: 'var(--bg-card)', 
            borderRadius: 'var(--radius)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <i className="bx bx-lock-alt"></i> Read-Only View (Staff Mode)
        </div>
      )}

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

      <div className="form-group">
        <label className="label-micro">Item ID {!readOnly && <span className="text-accent">*</span>}</label>
        <input type="text" id="edit-id" className="form-input font-mono" value={formData.id} onChange={handleChange} disabled={readOnly} required />
      </div>
      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Part Identification {!readOnly && <span className="text-accent">*</span>}</label>
          <input type="text" id="edit-name" className="form-input" value={formData.name} onChange={handleChange} disabled={readOnly} required />
        </div>
        <div className="form-group">
          <label className="label-micro">Barcode</label>
          <input type="text" id="edit-barcode" className="form-input" value={formData.barcode || ''} onChange={handleChange} disabled={readOnly} />
        </div>
        <div className="form-group">
          <label className="label-micro">Category {!readOnly && <span className="text-accent">*</span>}</label>
          <input type="text" id="edit-category" className="form-input" value={formData.category} onChange={handleChange} disabled={readOnly} required />
        </div>
      </div>
      {!readOnly && (
        <div className="form-group">
          <label className="label-micro">Replenishment Settings</label>
          <div className="grid-4 border-soft-no-pad p-0">
            <div className="form-group">
              <label className="label-micro">Ordering Cost (₱)</label>
              <input type="number" id="edit-orderingCost" className="form-input font-mono" value={formData.orderingCost ?? 100} onChange={handleChange} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label className="label-micro">Holding Cost / Year (₱)</label>
              <input type="number" id="edit-holdingCost" className="form-input font-mono" value={formData.holdingCost ?? 0} onChange={handleChange} min="0" step="0.01" />
            </div>
            <div className="form-group">
              <label className="label-micro">Lead Time (Days)</label>
              <input type="number" id="edit-leadTimeDays" className="form-input font-mono" value={formData.leadTimeDays ?? 7} onChange={handleChange} min="0" step="1" />
            </div>
            <div className="form-group">
              <label className="label-micro">Safety Stock</label>
              <input type="number" id="edit-safetyStock" className="form-input font-mono" value={formData.safetyStock ?? 0} onChange={handleChange} min="0" step="1" />
            </div>
          </div>
        </div>
      )}
      
      <div className="grid-3 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Size</label>
          <select id="edit-size" className="form-input" value={formData.size || 'MEDIUM'} onChange={handleChange} disabled={readOnly}>
            <option value="SMALL">Small</option>
            <option value="MEDIUM">Medium</option>
            <option value="LARGE">Large</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label-micro">Weight</label>
          <select id="edit-weight" className="form-input" value={formData.weight || 'MEDIUM'} onChange={handleChange} disabled={readOnly}>
            <option value="LIGHT">Light</option>
            <option value="MEDIUM">Medium</option>
            <option value="HEAVY">Heavy</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label-micro">Demand</label>
          <select id="edit-demand" className="form-input" value={formData.demand || 'MEDIUM'} onChange={handleChange} disabled={readOnly}>
            <option value="HIGH">High Demand</option>
            <option value="MEDIUM">Medium Demand</option>
            <option value="LOW">Low Demand</option>
          </select>
        </div>
      </div>

      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Rack Location</label>
          <input type="text" id="edit-rack" className="form-input" value={formData.rack} onChange={handleChange} placeholder="e.g. A-01" disabled={readOnly} />
        </div>
        <div className="form-group">
          <label className="label-micro">Level</label>
          <select id="edit-level" className="form-input" value={formData.level} onChange={handleChange} disabled={readOnly}>
            <option value="L1">L1 (Bottom)</option>
            <option value="L2">L2</option>
            <option value="L3">L3</option>
            <option value="L4">L4 (Top)</option>
          </select>
        </div>
      </div>

      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Quantity {!readOnly && <span className="text-accent">*</span>}</label>
          <input type="number" id="edit-quantity" className="form-input font-mono" value={formData.quantity} onChange={handleChange} min="0" disabled={readOnly} required />
        </div>
        <div className="form-group">
          <label className="label-micro">Price (₱) {!readOnly && <span className="text-accent">*</span>}</label>
          <input type="number" id="edit-price" className="form-input font-mono" value={formData.price} onChange={handleChange} min="0" step="0.01" disabled={readOnly} required />
        </div>
      </div>
      <div className="form-group">
        <label className="label-micro">Image URL</label>
        <input type="text" id="edit-image" className="form-input" value={formData.image || ''} onChange={handleChange} placeholder="https://..." disabled={readOnly} />
      </div>
      <div className="form-group">
        <label className="label-micro">Compatible Vehicles</label>
        <input type="text" id="edit-compatibleVehicles" className="form-input" value={formData.compatibleVehicles || ''} onChange={handleChange} placeholder="e.g. Toyota Civic, Honda Altis" disabled={readOnly} />
      </div>

      <div className="flex-row-gap mt-4">
        {readOnly ? (
          <button className="olive-button" style={{ flex: 1 }} onClick={onCancel}>Close</button>
        ) : (
          <>
            <button className="olive-button btn-outline" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
            <button className="olive-button" style={{ flex: 1 }} onClick={handleSave}>Save Item</button>
          </>
        )}
      </div>
    </div>
  );
};
