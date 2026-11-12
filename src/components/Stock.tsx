import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Item, Movement, UserRole } from '../types';

// The camera scanner loads only when it is opened.
const BarcodeScanner = lazy(() => import('./BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })));
import { apiRequest } from '../apiClient';
import { Modal } from './Modal';
import { getLocalCost } from '../inventoryMetrics';

const formatPeso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface StockProps {
  inventory: Item[];
  onAddMovement: (movement: Movement) => Promise<void> | void;
  onAddItem: (rack?: string) => void;
  stockInPrefill?: { invoice: string; supplierId: string } | null;
  onPrefillUsed?: () => void;
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
  stockInPrefill,
  onPrefillUsed,
  inventory,
  onAddMovement,
  onAddItem,
  selectedItemId,
  userName,
}) => {
  const [tab, setTab] = useState<Tab>('in');
  // Each tab keeps its own list, so switching tabs does not lose a half-finished sheet.
  const [sheets, setSheets] = useState<Record<Tab, Line[]>>({ in: [], out: [] });
  const [search, setSearch] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  useEffect(() => {
    if (!stockInPrefill) return;
    setTab('in');
    setStockInInvoice(stockInPrefill.invoice);
    setStockInSupplierId(stockInPrefill.supplierId);
    onPrefillUsed?.();
  }, [stockInPrefill]);
  // Stock-out details: the invoice number, the customer, and each item's selling price.
  const [saleReference, setSaleReference] = useState('');
  const [stockInInvoice, setStockInInvoice] = useState('');
  const [stockInSupplierId, setStockInSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; supplierId: string; isActive: boolean }[]>([]);
  useEffect(() => {
    apiRequest<{ id: number; name: string; supplierId: string; isActive: boolean }[]>('/suppliers')
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, []);
  const [sellPrices, setSellPrices] = useState<Record<string, string>>({});
  // One ID per sale, so a retried save cannot record the same sale twice.
  const saleBatchId = useRef<string | null>(null);
  // Prices typed in the Cost column, by item, until they are saved on blur or Enter.
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  // Staff have the same features as admins.
  const isAdmin = true;

  // Saves a purchase price typed on the sheet. It is the item's price, so it is saved on the item.
  const savePrice = async (item: Item) => {
    const draft = priceDrafts[item.id];
    if (draft === undefined) return;
    const price = draft.trim() === '' ? 0 : Number(draft);
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a price of zero or more.');
      setPriceDrafts((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
      return;
    }
    setPriceDrafts((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
    if (price === item.price) return;
    try {
      await apiRequest(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...item, price, updatedBy: userName }),
      });
      window.dispatchEvent(new CustomEvent('inventory-changed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the price.');
    }
  };
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

  // Several items can share a barcode, so a scan or a barcode search can add more than one.
  const addItemsToSheet = (itemIds: string[]) => {
    updateSheet((current) => itemIds.reduce((list, id) => addLine(list, id), current));
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
      .filter((item) => !onSheet.has(item.id) && `${item.id} ${item.name} ${item.barcode ?? ''} ${item.supplier ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [search, inventory, lines]);

  // Every item whose ID or barcode is exactly this code. Barcodes can be shared, so this can return several.
  const codeMatches = (value: string) => {
    const query = value.trim().toLowerCase();
    if (!query) return [];
    return inventory.filter((item) => item.id.toLowerCase() === query || (item.barcode ?? '').trim().toLowerCase() === query);
  };

  const handleSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const matches = codeMatches(search);
    if (matches.length > 0) {
      addItemsToSheet(matches.map((item) => item.id));
    } else if (suggestions.length === 1) {
      addItemToSheet(suggestions[0].id);
    }
  };

  const handleScan = (value: string) => {
    const code = value.trim();
    const matches = codeMatches(code);
    if (matches.length === 0) {
      setError(`No item matches the code ${code}.`);
      return;
    }
    addItemsToSheet(matches.map((item) => item.id));
    setIsScannerOpen(false);
  };

  const rows = lines.map((line) => {
    const item = itemById.get(line.itemId);
    const onHand = item?.quantity ?? 0;
    const after = isIn ? onHand + line.qty : onHand - line.qty;
    const short = !isIn && line.qty > onHand;
    const localCost = item ? getLocalCost(item) : 0;
    const lineTotal = localCost * line.qty;
    const sellPrice = Number(sellPrices[line.itemId]) || 0;
    const saleTotal = sellPrice * line.qty;
    const saleProfit = saleTotal - lineTotal;
    return { line, item, onHand, after, short, localCost, lineTotal, sellPrice, saleTotal, saleProfit };
  });
  const saleSalesTotal = rows.reduce((sum, row) => sum + row.saleTotal, 0);
  const saleProfitTotal = rows.reduce((sum, row) => sum + row.saleProfit, 0);

  const totalUnits = lines.reduce((sum, line) => sum + line.qty, 0);
  const totalValue = rows.reduce((sum, row) => sum + row.lineTotal, 0);
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
    if (isIn && !stockInInvoice.trim()) {
      setError('Enter the supplier invoice number.');
      return;
    }
    if (!isIn) {
      if (!saleReference.trim()) {
        setError('Enter the invoice or reference number.');
        return;
      }
      const noPrice = rows.find((row) => !(row.sellPrice > 0));
      if (noPrice) {
        setError(`Enter the selling price for ${noPrice.item?.name ?? noPrice.line.itemId}.`);
        return;
      }
      const overStock = rows.find((row) => row.line.qty > row.onHand);
      if (overStock) {
        setError(`Only ${overStock.onHand} unit(s) of ${overStock.item?.name ?? overStock.line.itemId} are on hand.`);
        return;
      }
      saleBatchId.current = saleBatchId.current ?? crypto.randomUUID();
    }
    setIsConfirmOpen(true);
  };

  // Records a stock-out sale. The stock deduction, the stock card line and the sale are saved together on the server.
  const confirmSale = async () => {
    if (isRecording) return;
    setIsRecording(true);
    setError(null);
    try {
      await apiRequest<{ id: string }>('/sales', {
        method: 'POST',
        body: JSON.stringify({
          batchId: saleBatchId.current,
          reference: saleReference.trim(),
          lines: lines.map((line) => ({ itemId: line.itemId, quantity: line.qty, unitPrice: Number(sellPrices[line.itemId]) })),
        }),
      });
      saleBatchId.current = null;
      setSheets((prev) => ({ ...prev, out: [] }));
      setSellPrices({});
      setSaleReference('');
      setIsConfirmOpen(false);
      window.dispatchEvent(new CustomEvent('inventory-changed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the sale.');
      setIsConfirmOpen(false);
    } finally {
      setIsRecording(false);
    }
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
          reference: recordingTab === 'in' ? stockInInvoice.trim() : saleReference.trim(),
          supplierId: recordingTab === 'in' && stockInSupplierId ? Number(stockInSupplierId) : null,
        };
        await onAddMovement(movement);
        done += 1;
        // Remove each line as soon as it is saved, so a failure later leaves only the unsaved ones.
        setSheets((prev) => ({
          ...prev,
          [recordingTab]: prev[recordingTab].filter((item) => item.itemId !== line.itemId),
        }));
      }
      if (recordingTab === 'in') {
        setStockInInvoice('');
        setStockInSupplierId('');
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

  const canAddNewItem = isIn;
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
            <Suspense fallback={null}>
              <BarcodeScanner onScanSuccess={handleScan} />
            </Suspense>
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
                  <span className="stk-suggest-stock">
                    {item.supplier ? `${item.supplier} · ` : ''}{item.quantity.toLocaleString()} on hand
                  </span>
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

        {isIn && (
          <div className="stk-sale-fields">
            <label className="stk-sale-field">
              <span>Supplier invoice no. <em>*</em></span>
              <input value={stockInInvoice} onChange={(e) => setStockInInvoice(e.target.value)} placeholder="e.g. VIS-INV-0001" maxLength={64} />
            </label>
            <label className="stk-sale-field">
              <span>Supplier <em>optional</em></span>
              <select value={stockInSupplierId} onChange={(e) => setStockInSupplierId(e.target.value)}>
                <option value="">No supplier</option>
                {suppliers.filter((sup) => sup.isActive).map((sup) => (
                  <option key={sup.id} value={sup.id}>{sup.name} ({sup.supplierId})</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!isIn && (
          <div className="stk-sale-fields">
            <label className="stk-sale-field">
              <span>Invoice no. <em>*</em></span>
              <input value={saleReference} onChange={(e) => setSaleReference(e.target.value)} placeholder="e.g. INV-0001" maxLength={64} />
            </label>
          </div>
        )}

        <div className="stk-table-wrap">
          <table className="stk-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">On hand</th>
                <th scope="col" className="num">{isIn ? 'Add' : 'Deduct'}</th>
                <th scope="col" className="num">Cost</th>
                {isIn ? (
                  <th scope="col" className="num">Total</th>
                ) : (
                  <>
                    <th scope="col" className="num">Selling price</th>
                    <th scope="col" className="num">Sales</th>
                    <th scope="col" className="num">Profit</th>
                  </>
                )}
                <th scope="col" className="num">After</th>
                <th scope="col" aria-label="Remove line" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isIn ? 7 : 9} className="stk-empty">
                    No items yet. Search for an item above or scan its barcode.
                  </td>
                </tr>
              )}
              {rows.map(({ line, item, onHand, after, short, localCost, lineTotal, sellPrice, saleTotal, saleProfit }) => {
                const discount = Number(item?.discount) || 0;
                return (
                  <tr key={line.itemId} className={short ? 'is-short' : ''}>
                    <td>
                      <span className="stk-item-name">{item?.name ?? 'Unknown item'}</span>
                      <span className="stk-item-meta">
                        <span className="stk-code">{line.itemId}</span>
                        {item?.compatibleVehicles && <span> · {item.compatibleVehicles}</span>}
                        {item?.supplier && <span> · {item.supplier}</span>}
                      </span>
                    </td>
                    <td className="num">
                      {onHand.toLocaleString()} <span className="inv-uom">{item?.unitOfMeasure || 'PCS'}</span>
                    </td>
                    <td className="num stk-qty-cell">
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
                    <td className="num">
                      {item ? (
                        <div className="inv-cost">
                          {isAdmin && isIn ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              className="stk-qty stk-price-input"
                              aria-label={`Purchase price for ${item.name}`}
                              value={priceDrafts[item.id] ?? String(item.price)}
                              onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              onBlur={() => void savePrice(item)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            />
                          ) : (
                            <span className="inv-cost-main">{formatPeso(item.price)}</span>
                          )}
                          <span className="inv-cost-sub">
                            Local {formatPeso(localCost)}
                            {discount > 0 && <span className="inv-discount">−{discount}%</span>}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    {isIn ? (
                      <td className="num inv-total">{line.qty > 0 ? formatPeso(lineTotal) : '—'}</td>
                    ) : (
                      <>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="stk-qty stk-price-input"
                            aria-label={`Selling price for ${item?.name ?? line.itemId}`}
                            placeholder="0.00"
                            value={sellPrices[line.itemId] ?? ''}
                            onChange={(e) => setSellPrices((prev) => ({ ...prev, [line.itemId]: e.target.value }))}
                          />
                        </td>
                        <td className="num inv-total">{sellPrice > 0 && line.qty > 0 ? formatPeso(saleTotal) : '—'}</td>
                        <td className={`num ${saleProfit < 0 ? 'stk-loss' : ''}`}>
                          {sellPrice > 0 && line.qty > 0 ? formatPeso(saleProfit) : '—'}
                        </td>
                      </>
                    )}
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
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="stk-foot">
          <div className="stk-totals">
            <span>Items <strong>{lines.length.toLocaleString()}</strong></span>
            <span>Units <strong>{totalUnits.toLocaleString()}</strong></span>
            {isIn ? (
              <span>Value <strong>{formatPeso(totalValue)}</strong></span>
            ) : (
              <>
                <span>Sales <strong>{formatPeso(saleSalesTotal)}</strong></span>
                <span>Gross profit <strong>{formatPeso(saleProfitTotal)}</strong></span>
              </>
            )}
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
              {isIn ? 'Record stock in' : 'Record sale'}
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
              onClick={isIn ? confirmRecord : confirmSale}
              disabled={isRecording}
            >
              {isRecording ? 'Recording…' : isIn ? 'Confirm' : 'Record sale'}
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
