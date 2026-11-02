import React, { useEffect, useState } from 'react';
import { InventoryAuditEntry, Item, Movement, UserRole, WarehouseLayout } from './types';
import { Modal } from './components/Modal';

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
import { ItemForm } from './components/ItemForm';
import { Navigation } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { StaffDashboard } from './components/StaffDashboard';
import { Inventory } from './components/Inventory';
import { Stock } from './components/Stock';
import { WarehouseMap } from './components/WarehouseMap';
import { Login } from './components/Login';
import { UserProfile } from './components/UserProfile';
import skyrunLogo from './assets/Skyrun.png';

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
}

const App: React.FC = () => {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [inventoryAudit, setInventoryAudit] = useState<InventoryAuditEntry[]>([]);
  const [currentSection, setCurrentSection] = useState('dashboard');
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

  useEffect(() => {
    refreshLayout().catch(() => setLayout([]));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      requestJson<Item[]>('/inventory'),
      requestJson<Movement[]>('/movements'),
      requestJson<InventoryAuditEntry[]>('/inventory-audit'),
    ])
      .then(([loadedInventory, loadedMovements, loadedInventoryAudit]) => {
        if (!active) return;
        setInventory(loadedInventory);
        setMovements(loadedMovements);
        setInventoryAudit(loadedInventoryAudit);
      })
      .catch((error: Error) => {
        if (active) setDatabaseError(`Database unavailable: ${error.message}`);
      });
    return () => { active = false; };
  }, []);

  const handleLoginSuccess = (username: string, role: UserRole, _email?: string, _phone?: string) => {
    sessionStorage.setItem('skyrun_session_user', username);
    sessionStorage.setItem('skyrun_session_role', role);
    sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
    setSessionNotice(null);
    setUser(username);
    setUserRole(role);
  };

  const handleSwitchRole = (newRole: UserRole, newName: string) => {
    sessionStorage.setItem('skyrun_session_user', newName);
    sessionStorage.setItem('skyrun_session_role', newRole);
    setUser(newName);
    setUserRole(newRole);
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
      title: 'Dashboard Manual',
      description: `## Summary Bar
Three headline figures run across the top of the dashboard.

- **Total Items** – The number of distinct items in the system (shown as \`011\`, meaning 11 items). This counts item types, not individual units.
- **Inventory Value** – The total peso value (₱) of everything in stock. It equals the sum of the Category Prices panel below.
- **Critical Alerts** – The number of items that need immediate attention (shown in red). It matches the number of entries in the Low Stock Alerts panel.

## 4. Category Units
This panel (green top border) shows how many units are in stock for each category:

- Body
- Brakes
- Electrical
- Misc
- Suspension
- Transmission
Use it to see which categories hold the most stock and which are thin. The total across categories is your total unit count.

## 5. Category Prices
This panel (purple top border) shows the peso value of the stock held in each category, using the same seven categories. Compare it with Category Units to see where your money is tied up. A category can have many units but low value (for example, Misc), or few units but high value.

## 6. Low Stock Alerts
This panel (red top border) lists items whose stock has fallen to a level that needs action. Each row shows:

- **Item name** (left)
- **Current quantity on hand** (right, in red)
For example, if *Front Fender Panel* shows \`4\`, there are only 4 on hand. When this panel is empty, no items are below their reorder point.

**What to do:** Review each listed item and check the EOQ & ROP Report to see how many to order.

## 7. Recent Audit History
This panel (yellow top border) is a log of the latest stock changes. Each entry shows:

- **Item name**
- **Date and time** of the change (for example, "Sep 24, 4:03 PM")
- **Quantity change** – a red negative number (e.g. \`-5\`) for stock removed, or a green positive number (e.g. \`+10\`) for stock added
Use this log to confirm that adjustments were recorded correctly and to trace unexpected drops in quantity. If you see entries with placeholder or test-like names, they are likely test records and can be reviewed with your administrator.

## 8. EOQ & ROP Report
This panel (blue top border) tells you what to buy and how much. Two terms are used:

- **ROP (Reorder Point)** – The stock level at which you should place a new order.
- **EOQ (Economic Order Quantity)** – The standard, cost-efficient order size for that item.
Each row shows the item name, its EOQ and ROP values, and a red **BUY** recommendation on the right.

## 9. Daily Routine

1. Open the **Dashboard**.
2. Check **Critical Alerts** in the summary bar.
3. Review **Low Stock Alerts** to see which items are running low.
4. Open the **EOQ & ROP Report** to see how many to order.
5. Scan **Recent Audit History** for unexpected changes.
6. Go to **Stock** to record any received or used items, then return to the Dashboard to confirm figures updated.`
    },
    
    inventory: {
      title: 'Inventory Manual',
      description: `## 1. Overview
The Inventory tab is the master list of every part. Use it to find items, add new ones, edit their details, and remove ones you no longer carry.

The screen has four areas: the **Inventory Ledger** header with search and the **+ Add Item** button, the **category filter**, the **item table**, and the pop-up forms for adding or editing an item.

## 2. Finding Items

### Search and scan
The **Search items or scan…** box sits beside the Inventory Ledger title. Type a part name, ID, or barcode to narrow the list. The small scan icon at the right end of the box lets you search by barcode using a camera.

### Category filter
The chips under the search box filter the table by category:

- **All**
- **Body**
- **Brakes**
- **Electrical**
- **Engine**
- **Suspension**
- **Transmission**
Click a chip to show only that category. Click **All** to see everything again.

### Sorting
The **Part Name** column header has a small arrow. Click it to change the sort order of the list.

## 3. Reading the Item Table
Each row is one item. The columns are:

| Column | What it shows |
| **Img** | Thumbnail photo of the part. A gray box means no image has been added. |
| **Part Name** | The part's name. Underneath: the vehicles it fits (in green), the item **ID**, and its barcode (**BC**). |
| **Category** | Which category the part belongs to. |
| **Location** | Rack code (for example H-03) and shelf level (for example Level: L1). |
| **Qty** | Units currently in stock. |
| **Reorder Qty** | How many units to reorder. Shows 00 when no reorder is needed. |
| **Price** | Unit price in pesos (₱). |
| **Actions** | The trash icon, used to delete the item. |

### Red numbers
When **Qty** and **Reorder Qty** appear in red, the item is low on stock. These match the BUY figures in the Dashboard's EOQ & ROP Reorder Report and the entries in Low Stock Alerts.

## 4. Adding a New Item (ADMIN)

1. Click **+ Add Item** (top right).
2. The **Add New Item** form opens. The **Item ID** is filled in automatically with the next number (for example 014).
3. Fill in the fields described in section 6. Fields marked with a red asterisk (*) are required.
4. Click **Save Item**, or **Cancel** to close the form without saving.
Some fields start with default values: Category is Body, Ordering Cost is 100, Holding Cost / Year is 0, and Lead Time is 7 days. Change these to match the real part.

## 5. Editing an Item (ADMIN)

1. Open the item from the table. The **Edit Item** form opens, titled with the item's ID (for example, Edit Item: 008).
2. Change the fields you need. The form scrolls, so keep going down to reach every field.
3. Click **Save Item** to apply your changes, or **Cancel** (or the **X** at the top right) to close without saving.

## 6. Item Form Fields
The Add and Edit forms share the same fields.

### Identification

- **Item ID*** – A unique number for the item (for example 008).
- **Part Identification*** – The part's name (for example, 120A High Output Alternator).
- **Barcode** – The barcode number printed on the part or shelf. You can use it later to find the item with the scanner.
- **Category*** – Choose from the drop-down list.

### Replenishment Settings*
These values control when and how much to reorder.

- **Ordering Cost (₱)*** – The cost of placing one order with your supplier.
- **Holding Cost / Year (₱)*** – The yearly cost of keeping one unit in storage.
- **Lead Time (days)*** – How many days a delivery takes after you order.
- **Safety Stock*** – Extra units to keep on hand as a buffer.

### Handling and demand

- **Size** – Drop-down (for example, Medium).
- **Weight** – Drop-down (for example, Heavy).
- **Demand** – Drop-down for how quickly the part sells (for example, LOW).

### Storage

- **Rack Location** – The rack code (for example, H-03).
- **Level** – The shelf level on that rack (for example, L1 (Bottom)).

### Stock and price

- **Quantity*** – Units in stock now.
- **Price (₱)*** – Unit price in pesos.

### Image
Add a photo in one of two ways:

- Click **Choose File** to upload an image from your device.
- Paste an image web address (URL) into the box below it.

### Compatible Vehicles
Type the vehicles the part fits (for example, Toyota Fortuner). This text appears under the part name in the table.

## 7. Scanning a Barcode
When you start a scan, a camera panel opens with a white frame in the middle.

1. Allow the browser to use your camera if asked.
2. Under **Select Camera**, choose the camera you want from the drop-down (the screen shows how many cameras were found, for example 3).
3. Hold the barcode inside the white frame until it is read.
4. Click **Stop Scanning** when you are done to turn the camera off.
For best results, use good lighting and keep the barcode steady and flat.

## 8. Deleting an Item (ADMIN)
Click the red trash icon in the **Actions** column to remove an item. Deleting cannot be assumed to be reversible, so check that you have the right row first.

## 9. Locate (STAFF)
Click the button in the **Locate** column of the item you want to find in the warehouse map.`
    },

    stock: {
      title: 'Stock Manual',
      description: `## 1. Overview
The Stock tab is where you update quantities after parts are received or used. It has two sub-tabs at the top left:

- **Stock In** – add units to an item (deliveries, returns, restocking).
- **Stock Out** – deduct units from an item (sales, installs, damaged or lost parts).
The active sub-tab is underlined. Each one is a short form with a **Scan Barcode** button at the top right of the card.

## 2. Recording Stock In
Use this when new units arrive.

1. Open the **Stock** tab, then select **Stock In**.
2. Find the item under **Select Item to Restock**. Type the item's ID or name in the search box, or click **Scan Barcode** (see section 4).
3. Check that **Item Name** and **Category** show the part you meant. These fields fill in once an item is chosen.
4. Enter the **Rack Location** where the units are being stored (for example, A1). Leave it as the item's current location unless the units are going to a new rack.
5. Enter **Quantity to Add**. This field is required.
6. Click **Record Stock In** (the dark blue button).
The item's quantity goes up by the amount you entered.

## 3. Recording Stock Out
Use this when units leave the warehouse.

1. Open the **Stock** tab, then select **Stock Out**.
2. Find the item under **Select Item to Deduct**. Type the item's ID or name, or click **Scan Barcode**.
3. Check that **Item Name** and **Category** show the right part.
4. Enter **Quantity to Deduct**. This field is required.
5. Click **Record Stock Out** (the red button).
The item's quantity goes down by the amount you entered. Stock Out has no Rack Location field, because units are taken from where the item is already stored.

## 4. Scanning a Barcode
Instead of typing, you can select an item by scanning its barcode.

1. Click **Scan Barcode** at the top right of the form.
2. Allow the browser to use your camera if asked.
3. If you have more than one camera, choose the one you want under **Select Camera**.
4. Hold the barcode inside the white frame until it is read. The item's details then fill in.
5. Click **Stop Scanning** to turn the camera off if it is still running.
Use good lighting and keep the barcode flat and steady.`
    },

    warehouse: {
      title: 'Warehouse Map Manual',
      description: `## 1. Overview
The Warehouse Map tab shows the physical layout of the warehouse. Use it to see which aisles and racks hold stock, spot racks that need attention, inspect what sits on each shelf level, and check whether the layout suits demand.

The screen has these parts:

- the **floor tabs** (one tab for each floor, such as Floor 1)
- the **aisle map** for the selected floor
- the **Rack Inspection** pop-up for a single rack
- the **Warehouse Layout Optimizer** with Aisle Density Analytics

## 2. The Aisle Map
The map shows the aisles of the floor whose tab is selected. Each aisle has a name (for example, **Aisle A**) and a category label with its own color, such as **High Demand Only**, **Body & Brakes**, **Electrical & Engine**, **Suspension & Transmission**, or **Misc**. Each aisle has one or more racks, numbered **Rack 1**, **Rack 2**, and so on. An aisle can run **portrait** (racks stacked top to bottom) or **landscape** (racks in a row).

**Floors**
- Click a tab to show that floor. The tab shows how many aisles are on it. The floor you last selected is remembered on this computer.
- Administrators can add a floor with **+ Add Floor**, and rename or delete one from the ⋯ menu on its tab. A floor can only be deleted when its racks hold no items, and the warehouse always keeps at least one floor.

**Adding an aisle (administrators)**
- Click **+ Add Aisle to [floor]**. The next free letter is suggested. Names must be unique across all floors.
- Pick an existing category (it keeps its color), or choose **Create new category** and pick a color.
- Choose Portrait or Landscape, and the number of racks (1 to 10, default 3).

**Edit Layout (administrators)**
- Click **Edit Layout** to change the layout. Each aisle then shows a toolbar with a drag handle, rotate, a rack count (− and +), the aisle name, a floor selector, and delete.
- Drag an aisle onto an empty spot to move it. Aisles snap to the grid and cannot overlap.
- Nothing is saved until you click **Save Layout**. **Cancel** throws the changes away, after a confirmation.
- Removing a rack that holds items asks you to choose the rack to move them to. The items are moved right away.
- An aisle that holds items cannot be renamed or deleted until its items are moved.

Staff see the same map, but cannot change the layout.

A rack's code combines its aisle and rack number. For example, **B-02** is Aisle B, Rack 2. The same code appears in the **Location** column on the Inventory tab and in the **Rack Location** field of an item.

### Red dots
A small red dot on a rack means it holds an item that needs attention. Racks without a dot have no flagged items.

## 3. Inspecting a Rack

1. On the aisle map, click the rack you want to look at.
2. The **Rack Inspection** pop-up opens. Its subtitle shows the rack code (for example, Cell Ident: B-R02), and the heading inside shows the aisle and rack (for example, Aisle B-02).
3. Read the shelf levels, listed from top to bottom as **L4, L3, L2, L1**. L1 is the bottom shelf.

### Reading the shelves

- A level with a solid outline holds one or more items. Each item appears as a white tile with its part name.
- A level with a dashed outline is empty.
- A red dot on an item tile means that item is low on stock.
In the sample, rack B-02 has Ceramic Brake Pads (Set) on level L2, with a red dot, and the other three levels are empty.

## 4. Warehouse Layout Optimizer
This section sits below the map. It helps you decide whether fast-selling parts are stored in the best places, with high-demand parts in the High Demand aisles and at the front slots.

### Aisle Density Analytics
This panel lists the aisles of the selected floor. Use the **This floor / All floors** switch at the top of the panel to include every floor. For each aisle you see:

- the aisle name and, in brackets, the number of items stored there (for example, Aisle F (3))
- a status tag (the sample shows **Optimal** for every aisle)
- a bar and a percentage showing how full the aisle is (the sample ranges from 0% to 6%)
Use it to find crowded aisles and aisles with free space. The item counts add up to your Total Items on the Dashboard.

### Analyze and optimize

1. Click **Analyze & Optimize Layout**.
2. The **Demand-Based Layout Optimizer** pop-up opens. It states how many items are recommended for relocation.
3. Review the table of recommendations. It lists each item and its category with its demand level, its **Current** location, and its **Optimized** (suggested) location.
4. Click **Apply Relocations** to accept the suggested moves. The number in brackets is how many moves will be applied.
5. Click **Discard** to close the pop-up without changing anything.
When no changes are needed, the pop-up shows "0 items recommended for demand-based relocation" and an empty table, as in the sample. In that case there is nothing to apply.

**Before you apply:** relocations change where items are recorded. Move the physical stock to match, so the map and the shelves agree.`
    },

    user: {
      title: 'User Manual',
      description: `## 1. Overview
The User tab is split into two panels:

- **Active Session Profile** (left) – shows who is signed in and holds the account buttons.
- **Session Audit History** (right) – a log of stock changes and item changes, with an **Undo** option on each entry.

## 2. Active Session Profile
The left panel shows your avatar, your username, and your role. Five buttons sit at the bottom:

What it does

**Change Username** - Rename your own account.

**Change Password** - Set a new password for your own account.

**Add New User** - Create an account for another person.

**Manage Accounts** - Edit or delete other Staff and Admin accounts.

**Log Out Operator** - Sign out of Skyrun (red button).

Change Username, Change Password, Add New User and Manage Accounts are shown on an Admin account. Staff accounts may not see them. Admins can manage other Admin accounts as well as Staff accounts.

## 3. Changing Your Username (ADMIN)

1. Click **Change Username**.
2. In **New Username**, type the name you want. The box starts with your current name.
3. Enter your **Current Password** to confirm it is you.
4. Click **Save**, or **Cancel** to close without changing anything.
The new name appears in your profile and next to your future entries in the audit history.

## 4. Changing Your Password (ADMIN)

1. Click **Change Password**.
2. Enter your **Current Password**.
3. Enter your **New Password**.
4. Enter it again under **Confirm Password**. Both entries must match.
5. Click **Save**, or **Cancel** to close.

## 5. Adding a New User (ADMIN)

1. Click **Add New User**.
2. Enter a **Username** for the person.
3. Enter a **Password** for them.
4. Choose a **Role** from the drop-down.
5. Click **Create**, or **Cancel** to close.

## 6. Managing Accounts (ADMIN)

1. Sign in with an Admin account and open the **User** tab.
2. Click **Manage Accounts**. The **Manage User Accounts** pop-up lists other accounts, including both Staff and Admin accounts, with each account's username and role.
3. Use the buttons on each row:
- **Edit** opens the row for editing (see below).
- **Delete** (red) removes the account.

### Editing an account
1. Click **Edit** beside the account. The row turns into a form with these fields:

- the **username**
- the **role** drop-down (**Staff** or **Admin**)
- a **New password** box
2. Change the username or role as needed. To reset the password, enter a new password; leave that field blank to keep the existing password.
3. Click **Save** to apply the changes, or **Cancel** to discard them.

### Deleting an account
1. Click **Delete** beside the account and confirm the prompt.
2. That account will no longer be able to sign in.

You cannot manage or delete your own account from this list. You also cannot demote or delete the last remaining Admin account, so the system always retains an administrator. Confirm the username and role before saving or deleting an account.

## 7. Session Audit History
The right panel logs changes made in the system. The number in brackets in the title is the total number of entries.

### Filtering and searching

- **All** shows every entry.
- **Stock In** shows only items added to stock.
- **Stock Out** shows only items taken out.
- The search box (**Search audit entries by item name or ID…**) narrows the list to entries that match an item's name or ID.
The counts on the filters do not add up to the total in the sample, because the list also holds other entries, such as items being added or deleted.

### Reading an entry
Each entry shows:

- the **item name**, with a colored tag for the type of action: **IN** (green), **OUT** (red), **ADD** (green), or **DELETE** (red)
- the item **ID** and who made the change (**By:** username)
- the **quantity change**: a green **+** number for stock in, a red **-** number for stock out, or the word ADD or DELETE for item changes
- the **date and time**
- an **Undo** button
The newest entries are at the top. The Dashboard's Recent Audit History shows the latest of these same entries.

### Undoing an entry
Use **Undo** to reverse a mistake, such as a wrong quantity or an item deleted by accident.

1. Find the entry, using the filters or search if needed.
2. Click **Undo**. For a stock entry, a small box appears showing a quantity (for example, 10) with **Confirm** and **Cancel** buttons.
3. Check the quantity. Change it if you only want to reverse part of the entry.
4. Click **Confirm** to apply the undo, or **Cancel** to keep things as they are.
After an undo, check the **Qty** on the Inventory tab to make sure the number is what you expect.`
    }
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
    setInventoryAudit(await requestJson<InventoryAuditEntry[]>('/inventory-audit'));
  };

  const updateItem = async (id: string, data: Item) => {
    const savedItem = await requestJson<Item>(`/inventory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setInventory(prev => prev.map(i => i.id === id ? savedItem : i));
  };

  const deleteItem = async (id: string) => {
    const deletedItem = inventory.find(item => item.id === id);
    const currentUser = sessionStorage.getItem('skyrun_session_user') || user || 'Unknown';
    await requestJson<void>(`/inventory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ createdBy: currentUser }),
    });
    setInventory(prev => prev.filter(i => i.id !== id));
    if (deletedItem) setInventoryAudit(await requestJson<InventoryAuditEntry[]>('/inventory-audit'));
  };

  const addMovement = async (movement: Movement) => {
    const savedMovement = await requestJson<Movement>('/movements', {
      method: 'POST',
      body: JSON.stringify(movement),
    });
    setMovements(prev => [...prev, savedMovement]);
    setInventory(prev => prev.map(i => i.id === movement.itemId
      ? { ...i, quantity: i.quantity + (movement.type === 'IN' ? movement.qty : -movement.qty) }
      : i));
  };

  const undoMovement = async (movementId: string, undoQuantity: number) => {
    if (userRole !== 'admin') return;

    const movementToUndo = movements.find(m => m.id === movementId);
    if (!movementToUndo) return;

    const result = await requestJson<{ deleted: boolean; movement?: Movement }>(`/movements/${encodeURIComponent(movementId)}/undo`, {
      method: 'PATCH',
      body: JSON.stringify({ qty: undoQuantity }),
    });
    setMovements(prev => result.deleted
      ? prev.filter(m => m.id !== movementId)
      : prev.map(m => m.id === movementId && result.movement ? result.movement : m));
    setInventory(prev => prev.map(i => {
      if (i.id === movementToUndo.itemId) {
        return {
          ...i,
          quantity: Math.max(0, i.quantity + (movementToUndo.type === 'IN' ? -undoQuantity : undoQuantity))
        };
      }
      return i;
    }));
  };

  const undoInventoryAudit = async (auditId: string) => {
    if (userRole !== 'admin') return;
    await requestJson(`/inventory-audit/${encodeURIComponent(auditId)}/undo`, { method: 'PATCH' });
    const [loadedInventory, loadedMovements, loadedInventoryAudit] = await Promise.all([
      requestJson<Item[]>('/inventory'),
      requestJson<Movement[]>('/movements'),
      requestJson<InventoryAuditEntry[]>('/inventory-audit'),
    ]);
    setInventory(loadedInventory);
    setMovements(loadedMovements);
    setInventoryAudit(loadedInventoryAudit);
  };

  const bulkUpdateInventory = async (newInventory: Item[]) => {
    await Promise.all(newInventory.map(item => requestJson<Item>(`/inventory/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    })));
    setInventory([...newInventory]);
  };

  const handleAddItem = (rackStr?: string) => {
    if (userRole === 'staff') return;
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
      await deleteItem(editingItem.id);
      await addItem(data);
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
            userRole={userRole}
            userName={user || undefined}
            rackLocations={rackLocations}
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
            onAddItem={handleAddItem}
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
            movements={movements} 
            inventory={inventory} 
            inventoryAudit={inventoryAudit}
            onLogout={handleLogout} 
            onGoToDashboard={() => setCurrentSection('dashboard')} 
            onUndoMovement={undoMovement}
            onUndoInventoryAudit={undoInventoryAudit}
            onSwitchRole={handleSwitchRole}
            onChangePassword={handleChangePassword}
            onChangeUsername={handleChangeUsername}
            onCreateUser={handleCreateUser}
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
        title={userRole === 'staff' ? `Item Details: ${editingItem?.id || ''}` : (editingItem?.name ? `Edit Item: ${editingItem.id}` : 'Add New Item')}
      >
        <ItemForm 
          item={editingItem} 
          existingItems={inventory}
          onSave={handleSaveItem} 
          onCancel={() => setIsItemModalOpen(false)} 
          readOnly={userRole === 'staff'}
          rackLocations={rackLocations}
          rackFloors={rackFloors}
          floors={layout.map(floor => ({ id: floor.id, name: floor.name }))}
        />
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
        <header>
          <div className="header-info" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <img className="brand-logo" src={skyrunLogo} alt="SkyRun logo" aria-label="SkyRun logo" style={{ width: '42px', height: '42px', objectFit: 'contain' }} />
            <h1 className="title-main" style={{ margin: 0 }}>
              {currentSection === 'dashboard' 
                ? 'SKYRUN' 
                : (currentSection === 'warehouse' ? 'Warehouse Map' : currentSection.charAt(0).toUpperCase() + currentSection.slice(1))}
            </h1>
          </div>
          <Navigation currentSection={currentSection} onSectionChange={setCurrentSection} />
        </header>

        {renderComponentRouter()}
      </div>

      {renderGlobalModals()}
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
