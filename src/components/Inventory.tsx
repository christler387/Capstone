import React, { useEffect, useState } from 'react';
import { Item, Movement, UserRole } from '../types';
import { Suspense, lazy } from 'react';

// The camera scanner loads only when it is opened.
const BarcodeScanner = lazy(() => import('./BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })));
import { apiRequest } from '../apiClient';
import { ProductImage } from './ProductImage';
import { getLocalCost, getReorderQuantity, getStockTotal, isAtReorderPoint } from '../inventoryMetrics';

interface InventoryProps {
  inventory: Item[];
  movements?: Movement[];
  onEditItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onGoToStock: (id: string) => void;
  onAddItem: () => void;
  onZoomImage: (url: string, name: string) => void;
  onLocateOnMap: (rack: string) => void;
  onOpenStockCard?: (itemId: string) => void;
  userRole?: UserRole;
}

const PAGE_SIZE = 10;

const formatPeso = (value: number) =>
  `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Inventory: React.FC<InventoryProps> = ({
  inventory,
  movements = [],
  onEditItem,
  onDeleteItem,
  onGoToStock,
  onAddItem,
  onZoomImage,
  onLocateOnMap,
  onOpenStockCard,
}) => {
  // How many suppliers each item is linked to, shown on the row.
  const [supplierLinks, setSupplierLinks] = useState<Record<string, { count: number; suppliers: { name: string; code: string }[] }>>({});
  useEffect(() => {
    const load = () =>
      apiRequest<Record<string, { count: number; suppliers: { name: string; code: string }[] }>>('/supplier-links/counts')
        .then(setSupplierLinks)
        .catch(() => setSupplierLinks({}));
    load();
    window.addEventListener('supplier-links-changed', load);
    return () => window.removeEventListener('supplier-links-changed', load);
  }, []);


  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sortField, setSortField] = useState<keyof Item>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);

  // Makes a copy of an item under an ID the admin types. The copy is audited on the server.
  const duplicateItem = async (item: Item) => {
    const newId = window.prompt(`Item ID for the copy of ${item.name}:`, '');
    if (!newId || !newId.trim()) return;
    try {
      const result = await apiRequest<{ id: string }>(`/inventory/${encodeURIComponent(item.id)}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ newId: newId.trim() }),
      });
      window.dispatchEvent(new CustomEvent('inventory-changed', { detail: { openId: result.id } }));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not duplicate the item.');
    }
  };

  // Copies the full web address of an item's picture.
  const copyPictureUrl = async (itemId: string, image: string) => {
    try {
      await navigator.clipboard.writeText(new URL(image, window.location.origin).href);
      setCopiedItemId(itemId);
      window.setTimeout(() => setCopiedItemId(null), 1500);
    } catch {
      window.alert('Could not copy the link. Open the item and copy the address from the Picture URL box.');
    }
  };

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
  // "All" plus every category in use, so a newly added category gets its own filter button.
  const categoryOptions = ['ALL', ...Array.from(new Set(inventory.map(i => (i.category || '').trim().toUpperCase()).filter(Boolean))).sort()];
  const totalValue = inventory.reduce((sum, i) => sum + getStockTotal(i), 0);
  const lowCount = inventory.filter(i => isAtReorderPoint(i, movements)).length;

  const filteredInventory = inventory
    .filter(i => {
      const matchesSearch = [i.name, i.id, i.category, i.brand || '', i.partNumber || '', i.barcode || '', i.compatibleVehicles || '', i.supplier || ''].some(v => v.toLowerCase().includes(search.toLowerCase()));
      const matchesCategory = categoryFilter === 'ALL' || (i.category || '').trim().toUpperCase() === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      const valA = String(a[sortField]).toLowerCase();
      const valB = String(b[sortField]).toLowerCase();
      return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

  const totalPages = Math.max(1, Math.ceil(filteredInventory.length / PAGE_SIZE));
  const displayedPage = Math.min(currentPage, totalPages);
  useEffect(() => {
    setPageInput(String(displayedPage));
  }, [displayedPage]);
  const pageItems = filteredInventory.slice(
    (displayedPage - 1) * PAGE_SIZE,
    displayedPage * PAGE_SIZE
  );

  // Staff have the same features; deletes are sent for approval by the server.
  const isAdmin = true;

  const renderScannerDrawer = () => (
    <div className="inv-scanner">
      <Suspense fallback={null}>
        <BarcodeScanner
          onScanSuccess={(val) => {
            setSearch(val);
            setCurrentPage(1);
            setIsScannerOpen(false);
          }}
        />
      </Suspense>
    </div>
  );

  return (
    <div className="content-section inv-page">
      <header className="inv-header">
        <div>
          <h2 className="inv-title">Inventory</h2>
          <p className="inv-subtitle">
            {totalItems} {totalItems === 1 ? 'item' : 'items'} on record
          </p>
        </div>
        {isAdmin ? (
          <button className="olive-button inv-add" onClick={onAddItem}>
            <i className="bx bx-plus" aria-hidden="true"></i>
            Add item
          </button>
        ) : (
          <span className="inv-readonly">
            <i className="bx bx-lock-alt" aria-hidden="true"></i>
            Read only
          </span>
        )}
      </header>

      <section className="inv-stats" aria-label="Summary">
        <div className="inv-stat">
          <span className="inv-stat-label">Items</span>
          <strong className="inv-stat-value">{totalItems}</strong>
        </div>
        <div className="inv-stat">
          <span className="inv-stat-label">Value on hand</span>
          <strong className="inv-stat-value">{formatPeso(totalValue)}</strong>
        </div>
        <div className={`inv-stat ${lowCount > 0 ? 'is-alert' : ''}`}>
          <span className="inv-stat-label">Need reorder</span>
          <strong className="inv-stat-value">{lowCount}</strong>
        </div>
      </section>

      <div className="inv-toolbar">
        <div className="inv-search">
          <i className="bx bx-search" aria-hidden="true"></i>
          <input
            type="text"
            placeholder="Search by name, ID, category, brand, supplier, part no., barcode or vehicle"
            aria-label="Search inventory"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
          {search && (
            <button
              type="button"
              className="inv-icon-btn"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                setCurrentPage(1);
              }}
            >
              <i className="bx bx-x" aria-hidden="true"></i>
            </button>
          )}
          <button
            type="button"
            className={`inv-icon-btn ${isScannerOpen ? 'is-active' : ''}`}
            onClick={() => setIsScannerOpen(!isScannerOpen)}
            title="Toggle barcode scanner"
            aria-label="Toggle barcode scanner"
            aria-pressed={isScannerOpen}
          >
            <i className={`bx ${isScannerOpen ? 'bx-x' : 'bx-barcode-reader'}`} aria-hidden="true"></i>
          </button>
        </div>

        <div className="inv-chips" role="group" aria-label="Filter by category">
          {categoryOptions.map(cat => (
            <button
              key={cat}
              type="button"
              className={`inv-chip ${categoryFilter === cat ? 'is-active' : ''}`}
              aria-pressed={categoryFilter === cat}
              onClick={() => {
                setCategoryFilter(cat);
                setCurrentPage(1);
              }}
            >
              {cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {isScannerOpen && renderScannerDrawer()}

      <main className="inv-table-wrap">
        <div className="inv-table" role="table" aria-label="Inventory items">
          <div className="inv-row inv-head" role="row">
            <span role="columnheader">Picture</span>
            <button
              type="button"
              role="columnheader"
              className="inv-sort"
              onClick={() => handleToggleSort('name')}
            >
              Item
              <i
                className={`bx bx-chevron-${sortDirection === 'asc' ? 'down' : 'up'} ${sortField === 'name' ? '' : 'is-hidden'}`}
                aria-hidden="true"
              ></i>
            </button>
            <span role="columnheader">Brand &amp; model</span>
            <span role="columnheader">Part no.</span>
            <span role="columnheader">Supplier</span>
            <span role="columnheader">Location</span>
            <span role="columnheader" className="num">Stock</span>
            <span role="columnheader" className="num">Purch. cost</span>
            <span role="columnheader" className="num">Local cost</span>
            <span role="columnheader" className="num">{isAdmin ? 'Actions' : 'Locate'}</span>
          </div>

          {pageItems.length === 0 && (
            <div className="inv-empty">
              <i className="bx bx-package" aria-hidden="true"></i>
              <p>{inventory.length === 0 ? 'No items yet.' : 'No items match your search.'}</p>
            </div>
          )}

          {pageItems.map(i => {
            const needsReorder = isAtReorderPoint(i, movements);
            const reorderQuantity = getReorderQuantity(i, movements);
            const discount = Number(i.discount) || 0;
            return (
              <div
                key={i.id}
                className={`inv-row inv-item ${needsReorder ? 'is-low' : ''}`}
                role="row"
                tabIndex={0}
                onClick={() => onEditItem(i.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onEditItem(i.id);
                  }
                }}
              >
                <span className="inv-picture" role="cell">
                  {i.image ? (
                    <ProductImage
                      src={i.image}
                      className="inv-thumb"
                      width={48}
                      height={48}
                      alt={i.name}
                      title="View picture"
                      onClick={(e) => { e.stopPropagation(); onZoomImage(i.image!, i.name); }}
                    />
                  ) : (
                    <span className="inv-thumb is-empty" aria-label="No picture">
                      <i className="bx bx-image" aria-hidden="true"></i>
                    </span>
                  )}
                </span>

                <div className="inv-name" role="cell">
                  <span className="inv-name-text">{i.name}</span>
                  {i.compatibleVehicles && (
                    <span className="inv-fits">
                      <i className="bx bxs-car" aria-hidden="true"></i>
                      {i.compatibleVehicles}
                    </span>
                  )}
                  <span className="inv-meta">
                    <span className="inv-code">{i.id}</span>
                    <span aria-hidden="true"> · </span>
                    {i.category || '---'}
                  </span>
                  {i.partNumber && <span className="inv-inline-extra">Part {i.partNumber}</span>}
                </div>

                <div className="inv-brandmodel" role="cell">
                  <span className={`inv-brand-name${i.brand ? '' : ' is-empty'}`}>{i.brand || '—'}</span>
                  {i.model && <span className="inv-model">{i.model}</span>}
                  {i.color && <span className="inv-sub">{i.color}</span>}
                </div>

                <span className={`inv-partno${i.partNumber ? '' : ' is-empty'}`} role="cell" title={i.partNumber || undefined}>
                  {i.partNumber || '—'}
                </span>

                <span
                  className={`inv-supplier-cell${supplierLinks[i.id] ? '' : ' is-empty'}`}
                  role="cell"
                  title={supplierLinks[i.id]?.suppliers.map((s) => `${s.name} (${s.code})`).join(', ') || undefined}
                >
                  {supplierLinks[i.id]?.suppliers.map((s) => s.name).join(', ') || '—'}
                </span>

                <div className="inv-location" role="cell">
                  <button
                    type="button"
                    className="inv-location-btn"
                    disabled={!i.rack}
                    onClick={(e) => { e.stopPropagation(); onLocateOnMap(i.rack); }}
                    title={i.rack ? 'Show on warehouse map' : 'No rack assigned'}
                  >
                    <i className="bx bx-map-pin" aria-hidden="true"></i>
                    {formatLocation(i.rack)}
                  </button>
                  {i.level && <span className="inv-level">Level {i.level}</span>}
                </div>

                <div className="inv-stock" role="cell">
                  <span className={`inv-qty-big ${needsReorder ? 'is-alert' : ''}`}>
                    {i.quantity.toLocaleString()}
                    <span className="inv-uom">{i.unitOfMeasure || 'PCS'}</span>
                  </span>
                  <button
                    type="button"
                    className={`inv-reorder-line ${needsReorder ? 'is-alert' : ''}`}
                    title="Open stock-in for this item"
                    onClick={(event) => { event.stopPropagation(); onGoToStock(i.id); }}
                  >
                    Reorder {reorderQuantity.toLocaleString()}
                  </button>
                </div>

                <span className="inv-price-cell" role="cell">{formatPeso(i.price)}</span>

                <div className="inv-local" role="cell">
                  <span className="inv-local-value">{formatPeso(getLocalCost(i))}</span>
                  {discount > 0 && <span className="inv-discount">−{discount}%</span>}
                </div>

                <span className="inv-actions" role="cell">
                  <button
                    type="button"
                    className="inv-icon-btn"
                    title="Stock card"
                    aria-label={`Open stock card for ${i.name}`}
                    onClick={(e) => { e.stopPropagation(); onOpenStockCard?.(i.id); }}
                  >
                    <i className="bx bx-spreadsheet" aria-hidden="true"></i>
                  </button>
                  {i.image && !i.image.startsWith('data:') && (
                    <button
                      type="button"
                      className={`inv-icon-btn ${copiedItemId === i.id ? 'is-active' : ''}`}
                      title={copiedItemId === i.id ? 'Link copied' : 'Copy picture URL'}
                      aria-label={`Copy picture URL for ${i.name}`}
                      onClick={(e) => { e.stopPropagation(); void copyPictureUrl(i.id, i.image!); }}
                    >
                      <i className={`bx ${copiedItemId === i.id ? 'bx-check' : 'bx-link'}`} aria-hidden="true"></i>
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="inv-icon-btn"
                      title="Duplicate item"
                      aria-label={`Duplicate ${i.name}`}
                      onClick={(e) => { e.stopPropagation(); void duplicateItem(i); }}
                    >
                      <i className="bx bx-copy" aria-hidden="true"></i>
                    </button>
                  )}
                  {isAdmin ? (
                    <button
                      type="button"
                      className="inv-icon-btn is-danger"
                      title="Delete item"
                      aria-label={`Delete ${i.name}`}
                      onClick={(e) => { e.stopPropagation(); onDeleteItem(i.id); }}
                    >
                      <i className="bx bx-trash" aria-hidden="true"></i>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="inv-icon-btn"
                      aria-label={`Locate ${i.name} on map`}
                      disabled={!i.rack}
                      title={i.rack ? 'Locate on map' : 'No rack assigned'}
                      onClick={(e) => { e.stopPropagation(); onLocateOnMap(i.rack); }}
                    >
                      <i className="bx bx-map-pin" aria-hidden="true"></i>
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </main>

      <footer className="inv-pager">
        <span className="inv-pager-summary">
          {filteredInventory.length === 0
            ? 'No items'
            : `Showing ${(displayedPage - 1) * PAGE_SIZE + 1}–${Math.min(displayedPage * PAGE_SIZE, filteredInventory.length)} of ${filteredInventory.length}`}
        </span>

        <div className="inv-pager-controls">
          <button
            type="button"
            className="inv-icon-btn"
            aria-label="Previous page"
            onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
            disabled={displayedPage === 1}
          >
            <i className="bx bx-chevron-left" aria-hidden="true"></i>
          </button>

          <label className="inv-page-label">
            Page
            <input
              className="inv-page-input"
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              aria-label="Page number"
              onChange={(event) => {
                const value = event.target.value;
                setPageInput(value);

                if (value === '') return;

                const page = Number(value);
                if (Number.isInteger(page) && page >= 1 && page <= totalPages) {
                  setCurrentPage(page);
                }
              }}
              onBlur={() => {
                const page = Number(pageInput);
                if (!pageInput || page < 1 || page > totalPages) {
                  setPageInput(String(displayedPage));
                }
              }}
            />
            of {totalPages}
          </label>

          <button
            type="button"
            className="inv-icon-btn"
            aria-label="Next page"
            onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
            disabled={displayedPage === totalPages}
          >
            <i className="bx bx-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </footer>
    </div>
  );
};
