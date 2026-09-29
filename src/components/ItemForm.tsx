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
  const [formData, setFormData] = useState<Partial<Item>>({
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
    safetyStock: 10,
    ...item,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    const field = id.replace('edit-', '');
    setError(null);
    setFormData(prev => ({
      ...prev,
      [field]: ['quantity', 'price', 'orderingCost', 'holdingCost', 'leadTimeDays', 'safetyStock'].includes(field)
        ? (field === 'safetyStock' && value === '' ? 10 : parseFloat(value))
        : value
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Please select an image smaller than 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFormData(prev => ({ ...prev, image: reader.result as string }));
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!formData.id || !formData.name || !formData.category) {
      setError('Please fill in all required fields (Item ID, Part Identification, and Category).');
      return;
    }

    const replenishmentFields = ['orderingCost', 'holdingCost', 'leadTimeDays', 'safetyStock'] as const;
    const missingReplenishment = replenishmentFields.some(field => formData[field] === undefined || formData[field] === null || Number(formData[field]) < 0 || Number.isNaN(Number(formData[field])));

    if (missingReplenishment) {
      setError('Please complete all replenishment settings (Ordering Cost, Holding Cost, Lead Time, and Safety Stock).');
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
          <label className="label-micro form-label-part-identification">Part Identification {!readOnly && <span className="text-accent">*</span>}</label>
          <input type="text" id="edit-name" className="form-input" value={formData.name} onChange={handleChange} disabled={readOnly} required />
        </div>
        <div className="form-group">
          <label className="label-micro">Barcode</label>
          <input type="text" id="edit-barcode" className="form-input" value={formData.barcode || ''} onChange={handleChange} disabled={readOnly} />
        </div>
        <div className="form-group">
          <label className="label-micro">Category {!readOnly && <span className="text-accent">*</span>}</label>
          <select id="edit-category" className="form-input" value={formData.category || 'BODY'} onChange={handleChange} disabled={readOnly} required>
            <option value="BODY">BODY</option>
            <option value="BRAKES">BRAKES</option>
            <option value="ELECTRICAL">ELECTRICAL</option>
            <option value="ENGINE">ENGINE</option>
            <option value="SUSPENSION">SUSPENSION</option>
            <option value="TRANSMISSION">TRANSMISSION</option>
            <option value="MISC">MISC</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="label-micro">Replenishment Settings {!readOnly && <span className="text-accent">*</span>}</label>
        <div className="grid-4 border-soft-no-pad p-0">
          <div className="form-group">
            <label className="label-micro">Ordering Cost (₱) {!readOnly && <span className="text-accent">*</span>}</label>
            <input type="number" id="edit-orderingCost" className="form-input font-mono" value={formData.orderingCost ?? 100} onChange={handleChange} min="0" step="0.01" required={!readOnly} disabled={readOnly} />
          </div>
          <div className="form-group">
            <label className="label-micro">Holding Cost / Year (₱) {!readOnly && <span className="text-accent">*</span>}</label>
            <input type="number" id="edit-holdingCost" className="form-input font-mono" value={formData.holdingCost ?? 0} onChange={handleChange} min="0" step="0.01" required={!readOnly} disabled={readOnly} />
          </div>
          <div className="form-group">
            <label className="label-micro">Lead Time (Days) {!readOnly && <span className="text-accent">*</span>}</label>
            <input type="number" id="edit-leadTimeDays" className="form-input font-mono" value={formData.leadTimeDays ?? 7} onChange={handleChange} min="0" step="1" required={!readOnly} disabled={readOnly} />
          </div>
          <div className="form-group">
            <label className="label-micro">Safety Stock {!readOnly && <span className="text-accent">*</span>}</label>
            <input type="number" id="edit-safetyStock" className="form-input font-mono" value={formData.safetyStock ?? 10} onChange={handleChange} min="0" step="1" required={!readOnly} disabled={readOnly} />
          </div>
        </div>
      </div>
      
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
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
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
        <label className="label-micro">IMAGE</label>
        <input type="file" id="edit-image-file" className="form-input" accept="image/*" onChange={handleImageUpload} disabled={readOnly} />
        <input type="text" id="edit-image" className="form-input mt-2" value={formData.image?.startsWith('data:') ? '' : (formData.image || '')} onChange={handleChange} placeholder="Or paste an image URL..." disabled={readOnly} />
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
