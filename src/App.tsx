import { AppDialog } from './components/AppDialog';
import { askNotice } from './components/AppDialog';
import React, { useEffect, useState } from 'react';
import { Item, Movement, UserRole, WarehouseLayout } from './types';
import { Modal } from './components/Modal';
import { askReason } from './reasonPrompt';

const API_BASE = '/api';

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.text();
    const message = response.headers.get('content-type')?.includes('application/json')
      ? (JSON.parse(body) as { error?: string }).error || body
      : body;
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}
import { Login } from './components/Login';
import skyrunLogo from './assets/Skyrun.webp';
import { isAtReorderPoint } from './inventoryMetrics';

// Screens that are not needed on first load are fetched the first time they are opened.
const StockCard = React.lazy(() => import('./components/StockCard').then((m) => ({ default: m.StockCard })));
const Suppliers = React.lazy(() => import('./components/Suppliers').then((m) => ({ default: m.Suppliers })));
const Sales = React.lazy(() => import('./components/Sales').then((m) => ({ default: m.Sales })));
const StockInHistoryPage = React.lazy(() => import('./components/StockInHistory').then((m) => ({ default: m.StockInHistoryPage })));
const ChangeRequestsPage = React.lazy(() => import('./components/ChangeRequests').then((m) => ({ default: m.ChangeRequestsPage })));
const ItemForm = React.lazy(() => import('./components/ItemForm').then((m) => ({ default: m.ItemForm })));
const Navigation = React.lazy(() => import('./components/Navigation').then((m) => ({ default: m.Navigation })));
const Dashboard = React.lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const StaffDashboard = React.lazy(() => import('./components/StaffDashboard').then((m) => ({ default: m.StaffDashboard })));
const Inventory = React.lazy(() => import('./components/Inventory').then((m) => ({ default: m.Inventory })));
const Stock = React.lazy(() => import('./components/Stock').then((m) => ({ default: m.Stock })));
const UserProfile = React.lazy(() => import('./components/UserProfile').then((m) => ({ default: m.UserProfile })));
const WarehouseMap = React.lazy(() => import('./components/WarehouseMap').then((m) => ({ default: m.WarehouseMap })));

// The session is kept in sessionStorage, so closing the tab signs the user out.
// It also expires after 15 minutes without mouse, keyboard, touch or scroll activity.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const SESSION_CHECK_MS = 15 * 1000;
const SESSION_ACTIVITY_KEY = 'skyrun_session_last_active';
const SESSION_EXPIRED_MESSAGE = 'Your session timed out after 15 minutes of inactivity. Please sign in again.';

function clearStoredSession() {
  sessionStorage.removeItem('skyrun_session_user');
  sessionStorage.removeItem('skyrun_session_role');
  sessionStorage.removeItem(SESSION_ACTIVITY_KEY);
  sessionStorage.removeItem('skyrun_session_email');
  sessionStorage.removeItem('skyrun_session_email_verified');
}

const App: React.FC = () => {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  // Requests open as a pop-out over the current page, so no second sign-in is needed.
  const [isRequestsOpen, setIsRequestsOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState('dashboard');
  const [stockCardItemId, setStockCardItemId] = useState('');
  // Set when "Add items to this invoice" is used on the stock-in history page.
  const [stockInPrefill, setStockInPrefill] = useState<{ invoice: string; supplierId: string } | null>(null);
  // After a duplicate: reload the list, then open the copy for editing.
  const [openAfterReload, setOpenAfterReload] = useState<string | null>(null);
  useEffect(() => {
    const onChanged = (event: Event) => {
      const openId = (event as CustomEvent<{ openId?: string }>).detail?.openId ?? null;
      if (openId) setOpenAfterReload(openId);
      void reloadInventory();
    };
    window.addEventListener('inventory-changed', onChanged);
    return () => window.removeEventListener('inventory-changed', onChanged);
  }, []);
  useEffect(() => {
    if (openAfterReload && inventory.some((i) => i.id === openAfterReload)) {
      setOpenAfterReload(null);
      handleEditItem(openAfterReload);
    }
  }, [inventory, openAfterReload]);
  const [user, setUser] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('staff');
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [layout, setLayout] = useState<WarehouseLayout>([]);
  const rackLocations = layout.flatMap(floor => floor.aisles.flatMap(aisle => aisle.racks.map(rack => rack.code)));
  const rackFloors = layout.flatMap(floor =>
    floor.aisles.flatMap(aisle => aisle.racks.map(rack => ({ code: rack.code, floorId: floor.id, floorName: floor.name }))),
  );

  // The warehouse layout loads on its own, so a layout problem never blocks the inventory.
  const refreshLayout = () => requestJson<WarehouseLayout>('/layout').then(setLayout);

  // Other people use the system too, so lists are reloaded from the server after every change
  // instead of being patched from memory.
  const reloadInventory = () => requestJson<Item[]>('/inventory').then(setInventory);
  const reloadMovements = () => requestJson<Movement[]>('/movements').then(setMovements);
  const reloadAll = () =>
    Promise.all([
      reloadInventory(),
      reloadMovements(),
    ]).then(() => undefined);

  // Keep the screens current while others work: refresh when the window is shown again and every 30 seconds.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') reloadAll().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    refreshLayout().catch(() => setLayout([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      requestJson<Item[]>('/inventory'),
      requestJson<Movement[]>('/movements'),
    ])
      .then(([loadedInventory, loadedMovements]) => {
        if (!active) return;
        setInventory(loadedInventory);
        setMovements(loadedMovements);
      })
      .catch((error: Error) => {
        if (active) setDatabaseError(`Database unavailable: ${error.message}`);
      });
    return () => { active = false; };
  }, [user]);

  const handleLoginSuccess = (username: string, role: UserRole, email?: string, _phone?: string, emailVerified?: boolean) => {
    sessionStorage.setItem('skyrun_session_user', username);
    sessionStorage.setItem('skyrun_session_role', role);
    // The recovery email comes with the sign-in response, so the profile does not need to ask the server for it.
    sessionStorage.setItem('skyrun_session_email', email || '');
    sessionStorage.setItem('skyrun_session_email_verified', emailVerified ? '1' : '0');
    sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
    setSessionNotice(null);
    setUser(username);
    setUserRole(role);
  };

  const handleLogout = async () => {
    try {
      await requestJson<{ ok: boolean }>('/logout', { method: 'POST' });
    } catch (error) {
      setDatabaseError(
        `Could not invalidate the server session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      clearStoredSession();
      setUser(null);
      setUserRole('staff');
      setCurrentSection('dashboard');
    }
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    const activeUsername = sessionStorage.getItem('skyrun_session_user') || user;
    if (!activeUsername) {
      throw new Error('No active user is logged in.');
    }
    await requestJson<{ ok: boolean; username: string }>('/users/change-password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  };
  const handleChangeUsername = async (currentPassword: string, newUsername: string) => {
    const activeUsername = sessionStorage.getItem('skyrun_session_user') || user;
    if (!activeUsername) {
      throw new Error('No active user is logged in.');
    }

    const updatedUser = await requestJson<{ ok: boolean; username: string }>('/users/change-username', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newUsername }),
    });
    sessionStorage.setItem('skyrun_session_user', updatedUser.username);
    setUser(updatedUser.username);
  };

  const handleCreateUser = async (username: string, password: string, role: UserRole, email?: string) => {
    await requestJson<{ ok: boolean; username: string }>('/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role, email }),
    });
  };
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | undefined>(undefined);
  const [zoomImage, setZoomImage] = useState<{ url: string, name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [stockToItem, setStockToItem] = useState<string | undefined>(undefined);
  const [locateRack, setLocateRack] = useState<string | null>(null);

  const renderManualHTML = (markdownText: string) => {
    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const formatInline = (value: string) => escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    const lines = markdownText.split('\n');
    let html = '';
    let listType: 'ul' | 'ol' | null = null;
    const listItems: string[] = [];
    let tableRows: string[] = [];

    const flushList = () => {
      if (!listItems.length) return;

      const tag = listType === 'ol' ? 'ol' : 'ul';
      html += `<${tag}>${listItems.map(item => `<li>${formatInline(item)}</li>`).join('')}</${tag}>`;
      listItems.length = 0;
      listType = null;
    };

    const flushTable = () => {
      if (tableRows.length === 0) return;

      const rows = tableRows.map((rowText) => rowText.split('|').map(cell => cell.trim()).filter((_, index, array) => index > 0 && index < array.length - 1));
      if (rows.length < 2) {
        html += `<p>${formatInline(tableRows.join(' | '))}</p>`;
      } else {
        const [header, ...bodyRows] = rows;
        const headerHtml = header.map(cell => `<th>${formatInline(cell)}</th>`).join('');
        const bodyHtml = bodyRows.map(row => `<tr>${row.map(cell => `<td>${formatInline(cell)}</td>`).join('')}</tr>`).join('');
        html += `<table class="manual-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
      }

      tableRows = [];
    };

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        flushList();
        flushTable();
        return;
      }

      if (trimmed.includes('|')) {
        flushList();
        tableRows.push(trimmed);
        return;
      }

      const headingMatch = trimmed.match(/^(#+)\s+(.*)$/);
      if (headingMatch) {
        flushList();
        flushTable();
        const level = Math.min(Math.max(headingMatch[1].length, 1), 4);
        html += `<h${level}>${formatInline(headingMatch[2])}</h${level}>`;
        return;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        if (listType !== 'ul') {
          flushList();
          listType = 'ul';
        }
        listItems.push(trimmed.replace(/^[-*]\s+/, ''));
        return;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        if (listType !== 'ol') {
          flushList();
          listType = 'ol';
        }
        listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
        return;
      }

      flushList();
      flushTable();
      html += `<p>${formatInline(trimmed)}</p>`;
    });

    flushList();
    flushTable();
    return html;
  };

  const sectionInfo: Record<string, { title: string; description: string }> = {
    dashboard: {
      title: 'Dashboard guide',
      description: `## What you see here
The dashboard is the starting point each day. It shows the state of the warehouse at a glance.

- **Total items** – how many different items are on record.
- **Inventory value** – price multiplied by quantity on hand, across all items.
- **Low stock** – items at or below their reorder point. The card turns red when there are any.
- **To reorder** – items that have a suggested order.

## Panels
- **By category** – stock value or units per category. Use the **Value / Units** switch above the panel.
- **Needs attention** – the items at or below their reorder point, lowest first. Select an item to open it in Stock.
- **Summary** – number of categories, total units, the largest category by value, and the average unit value.
- **Recent activity** – the latest stock movements, newest first, with the quantity in or out.
- **Reorder plan** – the suggested order quantity for each item (EOQ). Select an item to open it in Stock.

Lists scroll inside their panel when they are longer than the panel. Counts beside each panel title show how many rows it holds.

## Daily routine
1. Check **Low stock** and **Needs attention**.
2. Open **Reorder plan** and order what is suggested.
3. Check **Recent activity** for anything unexpected.
4. Record received or used stock in **Stock**, then come back here to confirm the figures.`
    },

    inventory: {
      title: 'Inventory guide',
      description: `## Finding an item
Type in the search box to filter by name, item ID, category, barcode, or supplier. Use the barcode button to scan an item's barcode with the camera.

## Adding and editing an item
Select **Add item** to create one. Each item needs an **Item ID** (filled in automatically), a part name, a category, a quantity, and a price.

- The **Item ID** cannot be changed once saved. To make a similar item with a new ID, use **Duplicate**.
- The **quantity** of a saved item is changed only by **Stock in** and **Stock out**, so the stock card always matches the quantity. The quantity field is locked on saved items.
- **Price** is the purchase price. **Discount** is the supplier discount in percent. The local cost is calculated from them.
- A **picture** can be uploaded or given as a web address. Pictures are compressed automatically.

## Row actions
- **Stock card** – open the item's full history.
- **Duplicate** – copy an item under a new ID (recorded in the audit trail).
- **Locate** – show the item on the warehouse map.
- **Edit** – change the item's details.
- **Delete** – removes the item. Staff send deletes for approval, and an admin decides them in **Requests**.

## Staff and admins
Staff can add and edit items. Price and discount changes are recorded on the stock card and in the audit trail; a staff member's price change is approved automatically.`
    },

    stock: {
      title: 'Stock guide',
      description: `## Stock in and Stock out
Use the two tabs at the top of the page.

- **Stock in** – units received from a supplier.
- **Stock out** – units that left the warehouse as a sale.

## Recording a sheet
1. Type an item name or ID in the search box and pick it. If the item does not exist yet, pick **Add a new item** (Stock in only).
2. Enter the **quantity** for each line. On Stock in, you can also enter the **cost** of the line.
3. Enter the **invoice number**. Every line needs one.
4. On Stock in, choose the **supplier** if you know it.
5. Select **Record stock in** (or **Record sale** on Stock out), then **Confirm**. Each line updates the item's quantity and appears on its stock card.

## Stock out and sales
Stock out sheets are sales. Enter the selling price for each line. The sale is kept with its cost, so the profit can be reported later in **Sales**.

## Mistakes
Do not try to correct a quantity on the item. Use **Stock in history** to undo or edit a line, or **Sales** to undo a sale. Staff send these changes for approval.`
    },

    'stock-card': {
      title: 'Stock card guide',
      description: `## What the stock card shows
The stock card is the full record of one item, from its first entry to today.

- **Summary** – beginning balance, total in, total out, adjustments, and the balance on hand.
- **Rows** – every change, oldest first, with the date, the type, the reference, the quantity in or out, the balance after the change, and who recorded it.

## Entry types
- **Beginning balance** – the first quantity when the item was recorded.
- **Stock in** and **Stock out** – normal receipts and issues.
- **Stock adjustment** – a change made by an earlier quantity edit.
- **Inventory correction** – an undo or a deleted movement.
- **Price change** – a change to the price or discount. Quantity does not change.

## Supplier information
The panel lists the suppliers linked to the item, with each supplier's own item code and purchase price. Use **Use as Item ID** to copy a supplier code into the item.

## Tips
Use the filters to narrow the rows by date or type. The running balance always matches the quantity shown on the item.`
    },

    'stock-in-history': {
      title: 'Stock in history guide',
      description: `## Invoices
Each stock-in invoice is listed once, with its date, supplier, number of items, total units, and who recorded it. Select an invoice to see its lines.

## Filtering
- Use the date presets (for example, Today or This month) or pick **From** and **To** dates.
- Filter by **Supplier**, **Item**, **Recorded by**, or type in **Search** for an invoice number.
- The totals line below the filters shows the figures for what you are looking at.

## Inside an invoice
- Each line shows the item, quantity, time, and who recorded it.
- **Edit** – change the quantity of the line. The stock is adjusted by the difference.
- **Undo** – reverse part or all of a line. The units are taken back out and recorded on the stock card.
- **Delete** – remove the line and take its stock back out.
- **Add items to this invoice** – open **Stock** with the same invoice number, to add more lines.
- **Delete invoice** – remove every line on the invoice.

## Approvals
Admins make these changes at once. Staff send them for approval; the request appears in **Requests**, and nothing changes until an admin approves it.`
    },

    sales: {
      title: 'Sales guide',
      description: `## Sales and profit
Sales are walk-in sales recorded in **Stock** as stock out. Each sale keeps its selling price and its cost, so profit is exact.

- **Gross profit** = selling price minus cost.
- **Margin** = gross profit divided by sales.

## Summary cards
Sales today, gross profit today, sales this month and this year, with the change against yesterday.

## Sales report
Choose **Daily**, **Monthly**, or **Annually**, and a date range. The table shows units, sales, cost of goods, and gross profit for each period, with a bar chart.

## Best-selling items
The items with the most units sold in the chosen range, with their sales and gross profit.

## Sales history
- Every sale line, newest first, with its invoice number, item, quantity, prices, cost, profit, and who recorded it.
- Filter by date, item, user, or search for an invoice number.
- **Export to Excel (CSV)** downloads the rows shown.
- **Undo** returns the stock to the warehouse and marks the sale as undone. Undone sales stay in the list, marked **Undone**, and are not counted in the totals.

## Approvals
Admins undo sales at once. Staff send the undo for approval in **Requests**.

## Old sales
Stock-out records from before sales tracking have no selling price. They are counted separately and are not treated as zero profit.`
    },

    suppliers: {
      title: 'Supplier guide',
      description: `## Suppliers
Each supplier has a code (for example SUP-0001), contact details, an address, notes, and a status: **Active** or **Inactive**. Only active suppliers can be chosen on a stock-in sheet.

## Linking items
- Open a supplier and choose **Link item** to connect it to an inventory item.
- Each item belongs to **one supplier**. An item that is already linked cannot be linked to another supplier.
- Each link has the supplier's own **item code** and its **purchase price**. A code can be used only once for each supplier.
- Use **Edit link** to change the code, price, or notes. The item ID stays the same.

## Working with the list
Search by supplier name, code, or contact. Select a supplier to see its linked items. The item list scrolls when it is longer than the panel.`
    },

    warehouse: {
      title: 'Warehouse map guide',
      description: `## Reading the map
The map shows each floor of the warehouse, with its aisles, racks, and levels. Every rack shows the items stored on it.

- Use the floor tabs to switch floors.
- Select a rack to see its items and quantities.
- **Locate** on the inventory list opens this map at the item's rack.

## Making changes
Admins can change the layout: add or rename floors, aisles, and racks, and move items to other racks. Staff can view the map and locate items.

## Tips
Keep the rack labels on the shelves identical to the rack names on the map. When an item moves, update its rack in its item details so the map stays correct.`
    },

    requests: {
      title: 'Requests guide',
      description: `## What a request is
Some changes by staff need approval before they take effect. They are listed in **Requests**, which opens as a pop-out from your profile menu.

## Types of request
- **Edit quantity** – a stock-in line quantity.
- **Delete line** and **Delete invoice** – stock-in lines and invoices.
- **Undo stock in** and **Undo sale** – a partial or full undo.
- **Delete item** and **Delete movement**.
- **Price change** – these are approved automatically and kept for the audit trail.

## Deciding a request (admins)
- **Pending** lists the requests waiting for a decision.
- **Approve** makes the change at once.
- **Reject** asks for a reason, which is kept with the request. Nothing changes.

## The audit trail
Every request and its decision stays in **Audit trail**, with who asked, who decided, when, and any note. Filter by status or search by invoice, item, or requester.

## Staff
Staff see only their own requests, with their status. Nothing changes until an admin approves it.`
    },

    user: {
      title: 'Profile guide',
      description: `## Your account
- **Change username** and **Change password** – you will need your current password.
- **Recovery email** – used for password reset codes.
- **Requests** – opens the approval list as a pop-out, with no second sign-in.

## Administration (admins only)
- **Add new user** – create a staff or admin login.
- **Manage accounts** – change roles and remove accounts.

Staff cannot add or delete accounts.

## Signing out
Use **Log out** at the bottom of the profile menu when you finish, especially on a shared computer.`
    },
  };

  const handleGoToStock = (id: string) => {
    setStockToItem(id);
    setCurrentSection('stock');
  };

  const handleLocateOnMap = (rack: string) => {
    setLocateRack(rack);
    setCurrentSection('warehouse');
  };

  const handleEditItem = (id: string) => {
    const item = inventory.find(i => i.id === id);
    setEditingItem(item);
    setIsItemModalOpen(true);
  };

  const addItem = async (item: Item) => {
    const currentUser = sessionStorage.getItem('skyrun_session_user') || user || 'Unknown';
    const savedItem = await requestJson<Item>('/inventory', {
      method: 'POST',
      body: JSON.stringify({ ...item, createdBy: currentUser }),
    });
    setInventory(prev => [...prev, savedItem]);
  };

  const updateItem = async (id: string, data: Item) => {
    const currentUser = sessionStorage.getItem('skyrun_session_user') || user || 'Unknown';
    const savedItem = await requestJson<Item>(`/inventory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...data, updatedBy: currentUser }),
    });
    setInventory(prev => prev.map(i => i.id === id ? savedItem : i));
  };

  const deleteItem = async (id: string) => {
    const currentUser = sessionStorage.getItem('skyrun_session_user') || user || 'Unknown';
    const reason = userRole === 'admin' ? '' : await askReason(`delete ${inventory.find(item => item.id === id)?.name || 'this item'}`);
    if (reason === null) return;
    const result = await requestJson<{ requested?: boolean } | undefined>(`/inventory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ createdBy: currentUser, reason }),
    });
    if (result?.requested) {
      (await askNotice('Sent for approval. Nothing changes until an admin approves it.'));
      return;
    }
    setInventory(prev => prev.filter(i => i.id !== id));
  };

  // An item's Item ID changed: update the screen at once, then reload the data in the background.
  const handleItemRenamed = (oldId: string, newId: string) => {
    setInventory(prev => prev.map(i => (i.id === oldId ? { ...i, id: newId } : i)));
    setMovements(prev => prev.map(m => (m.itemId === oldId ? { ...m, itemId: newId } : m)));
    setStockCardItemId(newId);
    void Promise.all([reloadInventory(), reloadMovements()]);
    window.dispatchEvent(new Event('supplier-links-changed'));
  };

  // Opens an item's stock card from another screen (the Inventory list or the Suppliers page).
  const handleOpenStockCard = (itemId: string) => {
    setStockCardItemId(itemId);
    setCurrentSection('stock-card');
  };

  const addMovement = async (movement: Movement) => {
    const savedMovement = await requestJson<Movement>('/movements', {
      method: 'POST',
      body: JSON.stringify(movement),
    });
    setMovements(prev => (prev.some(m => m.id === savedMovement.id) ? prev : [...prev, savedMovement]));
    await reloadInventory();
  };

  const bulkUpdateInventory = async (newInventory: Item[]) => {
    // Send only the items that changed, so an untouched item is never overwritten.
    const changed = newInventory.filter(item => {
      const current = inventory.find(i => i.id === item.id);
      return !current || JSON.stringify(current) !== JSON.stringify(item);
    });
    const results = await Promise.allSettled(changed.map(item =>
      requestJson<Item>(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify(item),
      }),
    ));
    await reloadInventory();
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed > 0) {
      const message = `${failed} item(s) were changed by someone else while you were working. The latest data is now shown; please check the warehouse map and try again.`;
      setDatabaseError(message);
      throw new Error(message);
    }
  };

  const handleAddItem = (rackStr?: string) => {
    let rack = rackStr || '';
    let level = 'L1';
    
    if (rackStr && rackStr.includes('-L')) {
      const parts = rackStr.split('-L');
      rack = parts[0];
      level = `L${parts[1]}`;
    }

    const nextId = String(Math.max(0, ...inventory.map(i => parseInt(i.id, 10) || 0)) + 1).padStart(3, '0');
    setEditingItem({ id: nextId, name: '', category: '', rack, level, quantity: 0, price: 0 } as Item);
    setIsItemModalOpen(true);
  };

    const handleSaveItem = async (data: Item) => {
    const exists = inventory.find(i => i.id === data.id || (editingItem && i.id === editingItem.id));
    if (exists && (!editingItem || editingItem.id === data.id)) {
      await updateItem(data.id, data);
    } else if (exists && editingItem && editingItem.id !== data.id) {
      // Add under the new ID first: if that fails, the original item is still there.
      await addItem(data);
      await deleteItem(editingItem.id);
    } else {
      await addItem(data);
    }
    setIsItemModalOpen(false);
    setEditingItem(undefined);
  };

  const confirmDeletion = async () => {
    if (confirmDelete) {
      await deleteItem(confirmDelete);
      setConfirmDelete(null);
    }
  };

  const renderComponentRouter = () => {
    switch (currentSection) {
      case 'dashboard': 
        if (userRole === 'staff') {
          return (
            <StaffDashboard 
              inventory={inventory} 
              movements={movements} 
              onGoToStock={handleGoToStock} 
              onGoToWarehouse={handleLocateOnMap}
              onGoToInventory={() => setCurrentSection('inventory')}
              userName={user || 'Warehouse Staff'}
            />
          );
        }
        return <Dashboard inventory={inventory} movements={movements} onGoToStock={handleGoToStock} />;
      case 'inventory': 
        return (
          <Inventory 
            inventory={inventory} 
            movements={movements}
            onEditItem={handleEditItem} 
            onDeleteItem={setConfirmDelete} 
            onGoToStock={handleGoToStock}
            onAddItem={() => handleAddItem()}
            onZoomImage={(url, name) => setZoomImage({ url, name })}
            onLocateOnMap={handleLocateOnMap}
            onOpenStockCard={handleOpenStockCard}
            userRole={userRole}
          />
        );
      case 'stock': 
        return (
          <Stock 
            inventory={inventory} 
            onAddMovement={addMovement} 
            onAddItem={handleAddItem}
            selectedItemId={stockToItem}
            stockInPrefill={stockInPrefill}
            onPrefillUsed={() => setStockInPrefill(null)}
            userRole={userRole}
            userName={user || undefined}
            rackLocations={rackLocations}
          />
        );
      case 'stock-card':
        return (
          <StockCard
            inventory={inventory}
            movements={movements}
            selectedItemId={stockCardItemId}
            onSelectItem={setStockCardItemId}
            onItemRenamed={handleItemRenamed}
            userRole={userRole}
          />
        );
      case 'suppliers':
        return (
          <Suppliers
            inventory={inventory}
            userRole={userRole}
            onOpenStockCard={handleOpenStockCard}
            onItemRenamed={handleItemRenamed}
          />
        );
      case 'sales':
        return <Sales userRole={userRole} />;
      case 'stock-in-history':
        return (
          <StockInHistoryPage
            userRole={userRole}
            onAddItemsToInvoice={(invoice, supplierId) => {
              setStockInPrefill({ invoice, supplierId });
              setCurrentSection('stock');
            }}
          />
        );
      case 'warehouse': 
        return (
          <WarehouseMap
            inventory={inventory}
            movements={movements}
            layout={layout}
            onLayoutChange={setLayout}
            onEditItem={handleEditItem} 
            onBulkUpdate={bulkUpdateInventory}
            initialRack={locateRack}
            onClearInitialRack={() => setLocateRack(null)}
            userRole={userRole}
          />
        );
      case 'user': 
        return (
          <UserProfile 
            user={user || (userRole === 'staff' ? 'Warehouse Staff' : 'Administrator')} 
            role={userRole}
            onLogout={handleLogout} 
            onChangePassword={handleChangePassword}
            onChangeUsername={handleChangeUsername}
            onCreateUser={handleCreateUser}
            onOpenRequests={() => setIsRequestsOpen(true)}
          />
        );
      default: 
        return null;
    }
  };


  const renderGlobalModals = () => (
    <>
      <Modal 
        isOpen={isItemModalOpen} 
        onClose={() => setIsItemModalOpen(false)} 
        type="landscape"
        title={editingItem?.name ? `Edit Item: ${editingItem.id}` : 'Add New Item'}
      >
        <React.Suspense fallback={null}>
          <ItemForm
            item={editingItem}
            existingItems={inventory}
            onSave={handleSaveItem}
            onCancel={() => setIsItemModalOpen(false)}
            rackLocations={rackLocations}
            rackFloors={rackFloors}
            floors={layout.map(floor => ({ id: floor.id, name: floor.name }))}
          />
        </React.Suspense>
      </Modal>
  
      <Modal 
        isOpen={!!confirmDelete} 
        onClose={() => setConfirmDelete(null)} 
        title="Confirm Deletion"
        footer={
          <div className="flex-row-gap" style={{ width: '100%' }}>
            <button className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="olive-button btn-danger" style={{ flex: 1 }} onClick={confirmDeletion}>Delete</button>
          </div>
        }
      >
        <div className="text-center">
            <p className="label-micro text-lg mb-4">Are you sure you want to delete this item?</p>
            <p className="label-micro opacity-50">This action cannot be undone.</p>
        </div>
      </Modal>
  
      <Modal
        isOpen={!!zoomImage}
        onClose={() => setZoomImage(null)}
        title={zoomImage?.name || 'Image Preview'}
        type="clean"
      >
        <div className="img-zoom-container">
            <img 
                src={zoomImage?.url.includes('picsum.photos') ? zoomImage.url.replace(/\/\d+\/\d+$/, '/600/600') : zoomImage?.url} 
                className="img-zoom-img" 
                referrerPolicy="no-referrer"
                alt="Zoomed"
            />
        </div>
      </Modal>

      <Modal
        isOpen={isRequestsOpen}
        onClose={() => setIsRequestsOpen(false)}
        title="Requests"
        type="full"
      >
        <ChangeRequestsPage />
      </Modal>

      <Modal
        isOpen={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
        title={sectionInfo[currentSection]?.title || 'SKYRUN Info'}
      >
        <div
          className="info-modal-content"
          dangerouslySetInnerHTML={{
            __html: renderManualHTML(sectionInfo[currentSection]?.description || ''),
          }}
        />
      </Modal>
    </>
  );

  useEffect(() => {
    const savedUser = sessionStorage.getItem('skyrun_session_user');
    const savedRole = sessionStorage.getItem('skyrun_session_role') as UserRole | null;
    const lastActive = Number(sessionStorage.getItem(SESSION_ACTIVITY_KEY) || 0);

    if (!savedUser || (savedRole !== 'admin' && savedRole !== 'staff')) return;

    // A page reload keeps the session, but one that sat idle past the limit is ended.
    if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
      clearStoredSession();
      setSessionNotice(SESSION_EXPIRED_MESSAGE);
      return;
    }

    setUser(savedUser);
    setUserRole(savedRole);
  }, []);

  useEffect(() => {
    if (!user) return;

    let lastWrite = 0;
    const markActive = () => {
      const now = Date.now();
      // Writing to storage on every mouse move is wasteful, so record activity at most every 10 seconds.
      if (now - lastWrite < 10_000) return;
      lastWrite = now;
      sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(now));
    };
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, markActive, { passive: true }),
    );

    const expiryTimer = window.setInterval(() => {
      const lastActive = Number(sessionStorage.getItem(SESSION_ACTIVITY_KEY) || 0);
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        clearStoredSession();
        setSessionNotice(SESSION_EXPIRED_MESSAGE);
        setUser(null);
        setUserRole('staff');
        setCurrentSection('dashboard');
      }
    }, SESSION_CHECK_MS);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActive));
      window.clearInterval(expiryTimer);
    };
  }, [user]);

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} notice={sessionNotice} />;
  }

  return (
    <div className="app-container">
      <div className="content-wrapper">
        {databaseError && <div className="alert-text mb-4">{databaseError}</div>}
        <React.Suspense fallback={null}>
        <header className="app-header">
          <div className="header-info">
            <img className="brand-logo" src={skyrunLogo} alt="" aria-hidden="true" />
            <span className="brand-wordmark brand-wordmark--header">SKYRUN</span>
            <h1 className="sr-only">
              {currentSection === 'warehouse' ? 'Warehouse Map' : currentSection === 'stock-card' ? 'Stock Card' : currentSection === 'sales' ? 'Sales & profit' : currentSection === 'stock-in-history' ? 'Stock in history' : currentSection.charAt(0).toUpperCase() + currentSection.slice(1)}
            </h1>
          </div>
          <Navigation
            currentSection={currentSection}
            onSectionChange={setCurrentSection}
            criticalItems={inventory.filter((item) => isAtReorderPoint(item, movements))}
            movements={movements}
            onOpenItem={handleGoToStock}
            userName={user || ''}
          />
        </header>
        </React.Suspense>

        <main className="app-content">
          <React.Suspense fallback={null}>{renderComponentRouter()}</React.Suspense>
        </main>
      </div>

      {renderGlobalModals()}
      <AppDialog />
      <button
        className="floating-info-button"
        type="button"
        onClick={() => setIsInfoModalOpen(true)}
        aria-label="Open information"
        title="Information"
      >
        <i className="bx bx-info-circle" aria-hidden="true"></i>
      </button>
    </div>
  );
};

export default App;
