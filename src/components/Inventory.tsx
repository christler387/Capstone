import React, { useEffect, useState } from 'react';
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

const CATEGORIES = ['ALL', 'BODY', 'BRAKES', 'ELECTRICAL', 'ENGINE', 'SUSPENSION', 'TRANSMISSION'];
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
  userRole = 'staff'
}) => {

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sortField, setSortField] = useState<keyof Item>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState(String(currentPage));

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

  const totalPages = Math.max(1, Math.ceil(filteredInventory.length / PAGE_SIZE));
  const displayedPage = Math.min(currentPage, totalPages);
  useEffect(() => {
    setPageInput(String(displayedPage));
  }, [displayedPage]);
  const pageItems = filteredInventory.slice(
    (displayedPage - 1) * PAGE_SIZE,
    displayedPage * PAGE_SIZE
  );

  const isAdmin = userRole === 'admin';

  const renderScannerDrawer = () => (
    <div className="inv-scanner">
      <BarcodeScanner
        onScanSuccess={(val) => {
          setSearch(val);
          setCurrentPage(1);
          setIsScannerOpen(false);
        }}
      />
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
            placeholder="Search by name, ID, category, barcode or vehicle"
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
          {CATEGORIES.map(cat => (
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
              Part name
              <i
                className={`bx bx-chevron-${sortDirection === 'asc' ? 'down' : 'up'} ${sortField === 'name' ? '' : 'is-hidden'}`}
                aria-hidden="true"
              ></i>
            </button>
            <span role="columnheader">Category</span>
            <span role="columnheader">Location</span>
            <span role="columnheader" className="num">Qty</span>
            <span role="columnheader" className="num">Reorder qty</span>
            <span role="columnheader" className="num">Price</span>
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
                    <img
                      src={i.image}
                      className="inv-thumb"
                      onClick={(e) => { e.stopPropagation(); onZoomImage(i.image!, i.name); }}
                      referrerPolicy="no-referrer"
                      alt={i.name}
                      title="View picture"
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
                    ID {i.id}
                    <span aria-hidden="true"> · </span>
                    BC {i.barcode || '---'}
                  </span>
                </div>

                <span className="inv-category" role="cell">{i.category}</span>

                <div className="inv-location" role="cell">
                  <button
                    type="button"
                    className="inv-location-btn"
                    onClick={(e) => { e.stopPropagation(); onLocateOnMap(i.rack); }}
                    title="Show on warehouse map"
                  >
                    <i className="bx bx-map-pin" aria-hidden="true"></i>
                    {formatLocation(i.rack)}
                  </button>
                  {i.level && <span className="inv-level">Level {i.level}</span>}
                </div>

                <span className={`inv-num inv-qty ${needsReorder ? 'is-alert' : ''}`} role="cell">
                  {String(i.quantity).padStart(3, '0')}
                </span>

                <button
                  type="button"
                  className={`inv-num inv-reorder ${needsReorder ? 'is-alert' : ''}`}
                  role="cell"
                  title="Open stock-in for this item"
                  onClick={(event) => { event.stopPropagation(); onGoToStock(i.id); }}
                >
                  {String(reorderQuantity).padStart(2, '0')}
                </button>

                <span className="inv-num inv-price" role="cell">{formatPeso(i.price)}</span>

                <span className="inv-actions" role="cell">
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
                      title="Locate on map"
                      aria-label={`Locate ${i.name} on map`}
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
