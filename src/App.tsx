import React, { useEffect, useState } from 'react';
import { InventoryAuditEntry, Item, Movement, UserRole } from './types';
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
    const message = await response.text();
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

const App: React.FC = () => {
  const [inventory, setInventory] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [inventoryAudit, setInventoryAudit] = useState<InventoryAuditEntry[]>([]);
  const [currentSection, setCurrentSection] = useState('dashboard');
  const [user, setUser] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('staff');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userPhone, setUserPhone] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
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

  const handleLoginSuccess = (username: string, role: UserRole, email?: string | null, phone?: string | null) => {
    localStorage.setItem('skyrun_session_user', username);
    localStorage.setItem('skyrun_session_role', role);
    localStorage.setItem('skyrun_session_email', email || '');
    localStorage.setItem('skyrun_session_phone', phone || '');
    setUser(username);
    setUserRole(role);
    setUserEmail(email || null);
    setUserPhone(phone || null);
  };

  const handleSwitchRole = (newRole: UserRole, newName: string) => {
    localStorage.setItem('skyrun_session_user', newName);
    localStorage.setItem('skyrun_session_role', newRole);
    setUser(newName);
    setUserRole(newRole);
  };

  const handleLogout = () => {
    localStorage.removeItem('skyrun_session_user');
    localStorage.removeItem('skyrun_session_role');
    localStorage.removeItem('skyrun_session_email');
    localStorage.removeItem('skyrun_session_phone');
    setUser(null);
    setUserRole('staff');
    setUserEmail(null);
    setUserPhone(null);
    setCurrentSection('dashboard');
  };

  const handleChangePassword = async (currentPassword: string, newPassword: string) => {
    const activeUsername = localStorage.getItem('skyrun_session_user') || user;
    if (!activeUsername) {
      throw new Error('No active user is logged in.');
    }
    await requestJson<{ ok: boolean; username: string }>('/users/change-password', {
      method: 'PUT',
      body: JSON.stringify({ username: activeUsername, currentPassword, newPassword }),
    });
  };
  const handleChangeUsername = async (currentPassword: string, newUsername: string) => {
    const activeUsername = localStorage.getItem('skyrun_session_user') || user;
    if (!activeUsername) {
      throw new Error('No active user is logged in.');
    }

    const updatedUser = await requestJson<{ ok: boolean; username: string }>('/users/change-username', {
      method: 'PUT',
      body: JSON.stringify({ currentUsername: activeUsername, currentPassword, newUsername }),
    });
    localStorage.setItem('skyrun_session_user', updatedUser.username);
    setUser(updatedUser.username);
  };

  const handleCreateUser = async (username: string, password: string, role: UserRole) => {
    await requestJson<{ ok: boolean; username: string }>('/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    });
  };
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | undefined>(undefined);
  const [zoomImage, setZoomImage] = useState<{ url: string, name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [stockToItem, setStockToItem] = useState<string | undefined>(undefined);
  const [locateRack, setLocateRack] = useState<string | null>(null);

  const sectionInfo: Record<string, { title: string; description: string }> = {
    dashboard: {
      title: 'Dashboard Info',
        description: 'hehehe hohoho'
    },
    inventory: {
      title: 'Inventory Info',
      description: 'hehehe'
    },
    stock: {
      title: 'Stock Info',
      description: 'hohoho'
    },
    warehouse: {
      title: 'Warehouse Map Info',
      description: 'hihihi'
    },
    user: {
      title: 'User Info',
      description: 'huhuhu'
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
    const currentUser = localStorage.getItem('skyrun_session_user') || user || 'Unknown';
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
    const currentUser = localStorage.getItem('skyrun_session_user') || user || 'Unknown';
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
          />
        );
      case 'warehouse': 
        return (
          <WarehouseMap 
            inventory={inventory} 
            movements={movements} 
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
            email={userEmail || undefined}
            phone={userPhone || undefined}
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
          onSave={handleSaveItem} 
          onCancel={() => setIsItemModalOpen(false)} 
          readOnly={userRole === 'staff'} 
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
        <div className="info-modal-content">
          <p className="label-micro">hahaha</p>
          <p className="label-micro opacity-70">{sectionInfo[currentSection]?.description}</p>
        </div>
      </Modal>
    </>
  );

  useEffect(() => {
    localStorage.removeItem('skyrun_session_user');
    localStorage.removeItem('skyrun_session_role');
    localStorage.removeItem('skyrun_session_email');
    localStorage.removeItem('skyrun_session_phone');
    setUser(null);
    setUserRole('staff');
    setUserEmail(null);
    setUserPhone(null);
  }, []);

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
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
