import React, { useEffect, useMemo, useState } from 'react';
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
  // Every rack code in the warehouse layout. Not used by this screen; kept so the app can pass it.
  rackLocations?: string[];
}

type Tab = 'in' | 'out';
interface Line {
  itemId: string;
  qty: number;
}

const MAX_SUGGESTIONS = 8;

const addLine = (lines: Line[], itemId: string): Line[] =>
  lines.some((line) => line.itemId === itemId) ? lines : [...lines, { itemId, qty: 0 }];

export const Stock: React.FC<StockProps> = ({
  inventory,
  onAddMovement,
  onAddItem,
  selectedItemId,
  userRole = 'staff',
  userName,
}) => {
  const [tab, setTab] = useState<Tab>('in');
  // Each tab keeps its own list, so switching tabs does not lose a half-finished sheet.
  const [sheets, setSheets] = useState<Record<Tab, Line[]>>({ in: [], out: [] });
  const [search, setSearch] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const isIn = tab === 'in';
  const lines = sheets[tab];
  const itemById = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory]);

  // Opened from the inventory list with an item: put it on the sheet.
  useEffect(() => {
    if (!selectedItemId || !itemById.has(selectedItemId)) return;
    setSheets((prev) => ({ ...prev, [tab]: addLine(prev[tab], selectedItemId) }));
  }, [selectedItemId, tab]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setSearch('');
    setError(null);
    setIsScannerOpen(false);
  };

  const updateSheet = (update: (current: Line[]) => Line[]) => {
    setError(null);
    setSheets((prev) => ({ ...prev, [tab]: update(prev[tab]) }));
  };

  const addItemToSheet = (itemId: string) => {
    updateSheet((current) => addLine(current, itemId));
    setSearch('');
  };

  const setQty = (itemId: string, value: string) => {
    const parsed = value === '' ? 0 : Math.max(0, parseInt(value, 10) || 0);
    updateSheet((current) => current.map((line) => (line.itemId === itemId ? { ...line, qty: parsed } : line)));
  };

  const removeLine = (itemId: string) => {
    updateSheet((current) => current.filter((line) => line.itemId !== itemId));
  };

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const onSheet = new Set(lines.map((line) => line.itemId));
    return inventory
      .filter((item) => !onSheet.has(item.id) && `${item.id} ${item.name}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [search, inventory, lines]);

  const exactMatch = (value: string) => {
    const query = value.trim().toLowerCase();
    return inventory.find((item) => item.id.toLowerCase() === query || `${item.id} - ${item.name}`.toLowerCase() === query);
  };

  const handleSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const match = exactMatch(search) ?? (suggestions.length === 1 ? suggestions[0] : undefined);
    if (match) addItemToSheet(match.id);
  };

  const handleScan = (value: string) => {
    const code = value.trim();
    const found = inventory.find((item) => item.id === code || (item.barcode ?? '').trim() === code);
    if (!found) {
      setError(`No item matches the code ${code}.`);
      return;
    }
    addItemToSheet(found.id);
    setIsScannerOpen(false);
  };

  const rows = lines.map((line) => {
    const item = itemById.get(line.itemId);
    const onHand = item?.quantity ?? 0;
    const after = isIn ? onHand + line.qty : onHand - line.qty;
    const short = !isIn && line.qty > onHand;
    return { line, item, onHand, after, short };
  });

  const totalUnits = lines.reduce((sum, line) => sum + line.qty, 0);
  const shortRows = rows.filter((row) => row.short);

  const requestRecord = () => {
    setError(null);
    if (lines.length === 0) {
      setError('Add at least one item to the sheet.');
      return;
    }
    if (lines.some((line) => line.qty <= 0)) {
      setError('Enter a quantity for every item.');
      return;
    }
    setIsConfirmOpen(true);
  };

  const confirmRecord = async () => {
    if (isRecording) return;
    setIsRecording(true);
    setError(null);
    const recordingTab = tab;
    const activeUserName = userName || sessionStorage.getItem('skyrun_session_user') || 'Warehouse Staff';
    const pending = [...sheets[recordingTab]];
    let done = 0;
    try {
      for (const line of pending) {
        const movement: Movement = {
          // Unique per record, so two people recording at the same moment never share an ID.
          id: `MOV-${crypto.randomUUID()}`,
          itemId: line.itemId,
          type: recordingTab === 'in' ? 'IN' : 'OUT',
          qty: line.qty,
          date: new Date().toISOString().split('T')[0],
          timestamp: Date.now(),
          createdBy: activeUserName,
        };
        await onAddMovement(movement);
        done += 1;
        // Remove each line as soon as it is saved, so a failure later leaves only the unsaved ones.
        setSheets((prev) => ({
          ...prev,
          [recordingTab]: prev[recordingTab].filter((item) => item.itemId !== line.itemId),
        }));
      }
      setIsConfirmOpen(false);
    } catch (recordError) {
      const message = recordError instanceof Error ? recordError.message : 'Could not record the movement.';
      setError(`Saved ${done} of ${pending.length}. ${message} The items not yet saved are still on the sheet.`);
      setIsConfirmOpen(false);
    } finally {
      setIsRecording(false);
    }
  };

  const clearSheet = () => {
    setError(null);
    setSheets((prev) => ({ ...prev, [tab]: [] }));
  };

  const canAddNewItem = isIn && userRole === 'admin';
  const title = isIn ? 'Stock in' : 'Stock out';
  const subtitle = isIn
    ? 'Record units received. Each line adds to the item’s stock on hand.'
    : 'Record units that left the warehouse. Each line is deducted from stock on hand.';

  return (
    <div className="content-section stk">
      <div className="stk-tabs" role="tablist" aria-label="Stock movement">
        <button
          type="button"
          role="tab"
          aria-selected={isIn}
          className={`stk-tab ${isIn ? 'is-active' : ''}`}
          onClick={() => changeTab('in')}
        >
          <i className="bx bx-log-in" aria-hidden="true"></i> Stock in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isIn}
          className={`stk-tab ${!isIn ? 'is-active' : ''}`}
          onClick={() => changeTab('out')}
        >
          <i className="bx bx-log-out" aria-hidden="true"></i> Stock out
        </button>
      </div>

      <section className="stk-sheet" aria-labelledby="stk-title">
        <header className="stk-head">
          <div>
            <h2 id="stk-title" className="stk-title">{title}</h2>
            <p className="stk-subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className={`stk-scan ${isScannerOpen ? 'is-active' : ''}`}
            onClick={() => setIsScannerOpen((open) => !open)}
          >
            <i className={`bx ${isScannerOpen ? 'bx-x' : 'bx-barcode-reader'}`} aria-hidden="true"></i>
            {isScannerOpen ? 'Close scanner' : 'Scan barcode'}
          </button>
        </header>

        {isScannerOpen && (
          <div className="stk-scanner">
            <BarcodeScanner onScanSuccess={handleScan} />
          </div>
        )}

        <div className="stk-add">
          <label className="stk-add-label" htmlFor={`stk-search-${tab}`}>Add item</label>
          <div className="stk-search">
            <i className="bx bx-search" aria-hidden="true"></i>
            <input
              id={`stk-search-${tab}`}
              type="search"
              className="stk-search-input"
              placeholder="Type an item ID or name, then press Enter"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKey}
              autoComplete="off"
            />
          </div>
          {search.trim() && (
            <div className="stk-suggest" role="listbox" aria-label="Matching items">
              {canAddNewItem && (
                <button type="button" className="stk-suggest-row is-add" onClick={() => onAddItem()}>
                  <i className="bx bx-plus" aria-hidden="true"></i> Add a new item
                </button>
              )}
              {suggestions.map((item) => (
                <button type="button" key={item.id} className="stk-suggest-row" onClick={() => addItemToSheet(item.id)}>
                  <span className="stk-code">{item.id}</span>
                  <span className="stk-suggest-name">{item.name}</span>
                  <span className="stk-suggest-stock">{item.quantity.toLocaleString()} on hand</span>
                </button>
              ))}
              {suggestions.length === 0 && !canAddNewItem && (
                <p className="stk-suggest-empty">No matching items.</p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="stk-alert" role="alert">
            <i className="bx bx-error-circle" aria-hidden="true"></i>
            <span>{error}</span>
          </div>
        )}

        <div className="stk-table-wrap">
          <table className="stk-table">
            <thead>
              <tr>
                <th scope="col">Item ID</th>
                <th scope="col">Item</th>
                <th scope="col" className="num">On hand</th>
                <th scope="col" className="num">{isIn ? 'Add' : 'Deduct'}</th>
                <th scope="col">UOM</th>
                <th scope="col" className="num">After</th>
                <th scope="col" aria-label="Remove line" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="stk-empty">
                    No items yet. Search for an item above or scan its barcode.
                  </td>
                </tr>
              )}
              {rows.map(({ line, item, onHand, after, short }) => (
                <tr key={line.itemId} className={short ? 'is-short' : ''}>
                  <td><span className="stk-code">{line.itemId}</span></td>
                  <td>
                    <span className="stk-item-name">{item?.name ?? 'Unknown item'}</span>
                    {item?.compatibleVehicles && <span className="stk-item-meta">{item.compatibleVehicles}</span>}
                  </td>
                  <td className="num">{onHand.toLocaleString()}</td>
                  <td className="num">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="stk-qty"
                      aria-label={`Quantity for ${item?.name ?? line.itemId}`}
                      value={line.qty || ''}
                      placeholder="0"
                      onChange={(event) => setQty(line.itemId, event.target.value)}
                    />
                  </td>
                  <td>{item?.unitOfMeasure || 'PCS'}</td>
                  <td className="num">
                    {line.qty > 0 ? (
                      <span className={short ? 'stk-after is-short' : 'stk-after'}>{after.toLocaleString()}</span>
                    ) : (
                      <span className="stk-after is-idle">—</span>
                    )}
                  </td>
                  <td className="stk-remove-cell">
                    <button
                      type="button"
                      className="stk-remove"
                      aria-label={`Remove ${item?.name ?? line.itemId}`}
                      title="Remove from sheet"
                      onClick={() => removeLine(line.itemId)}
                    >
                      <i className="bx bx-x" aria-hidden="true"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="stk-foot">
          <div className="stk-totals">
            <span>Items <strong>{lines.length.toLocaleString()}</strong></span>
            <span>Units <strong>{totalUnits.toLocaleString()}</strong></span>
            {shortRows.length > 0 && (
              <span className="stk-totals-warning">
                <i className="bx bx-error" aria-hidden="true"></i>
                {shortRows.length} over stock
              </span>
            )}
          </div>
          <div className="stk-foot-actions">
            <button type="button" className="stk-btn is-ghost" onClick={clearSheet} disabled={lines.length === 0 || isRecording}>
              Clear
            </button>
            <button
              type="button"
              className={`stk-btn ${isIn ? 'is-primary' : 'is-danger'}`}
              onClick={requestRecord}
              disabled={lines.length === 0 || isRecording}
            >
              {isIn ? 'Record stock in' : 'Record stock out'}
            </button>
          </div>
        </footer>
      </section>

      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title={`Confirm stock ${isIn ? 'in' : 'out'}`}
        footer={
          <div className="stk-modal-actions">
            <button type="button" className="stk-btn is-ghost" onClick={() => setIsConfirmOpen(false)} disabled={isRecording}>
              Cancel
            </button>
            <button
              type="button"
              className={`stk-btn ${isIn ? 'is-primary' : 'is-danger'}`}
              onClick={confirmRecord}
              disabled={isRecording}
            >
              {isRecording ? 'Recording…' : shortRows.length > 0 ? 'Deduct anyway' : 'Confirm'}
            </button>
          </div>
        }
      >
        <p className="stk-modal-summary">
          {lines.length} item{lines.length === 1 ? '' : 's'}, {totalUnits.toLocaleString()} unit{totalUnits === 1 ? '' : 's'} {isIn ? 'into' : 'out of'} stock.
        </p>
        {shortRows.length > 0 && (
          <p className="stk-modal-warning">
            <i className="bx bx-error" aria-hidden="true"></i>
            {shortRows.length === 1 ? 'One item' : `${shortRows.length} items`} will go below zero on hand after this change.
          </p>
        )}
        <ul className="stk-modal-list">
          {rows.map(({ line, item, onHand, after, short }) => (
            <li key={line.itemId} className={short ? 'is-short' : ''}>
              <span className="stk-item-name">{item?.name ?? line.itemId}</span>
              <span className="stk-modal-qty">
                {isIn ? '+' : '−'}{line.qty.toLocaleString()} · {onHand.toLocaleString()} → {after.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
};
