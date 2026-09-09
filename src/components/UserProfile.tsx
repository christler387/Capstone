import React, { useState } from 'react';
import { InventoryAuditEntry, Movement, Item, UserRole } from '../types';

interface UserProfileProps {
  user: string;
  role?: UserRole;
  movements: Movement[];
  inventory: Item[];
  inventoryAudit: InventoryAuditEntry[];
  onLogout: () => void;
  onGoToDashboard: () => void;
  onUndoMovement?: (id: string) => void;
  onSwitchRole?: (role: UserRole, name: string) => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  onChangeUsername?: (currentPassword: string, newUsername: string) => Promise<void>;
  onCreateUser?: (username: string, password: string, role: UserRole, displayName?: string) => Promise<void>;
}

export const UserProfile: React.FC<UserProfileProps> = ({ 
  user, 
  role = 'staff',
  movements, 
  inventory, 
  inventoryAudit,
  onLogout, 
  onGoToDashboard,
  onUndoMovement,
  onSwitchRole,
  onChangePassword,
  onChangeUsername,
  onCreateUser
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newUsername, setNewUsername] = useState(user);
  const [usernamePassword, setUsernamePassword] = useState('');
  const [createUserName, setCreateUserName] = useState('');
  const [createUserPassword, setCreateUserPassword] = useState('');
  const [createUserRole, setCreateUserRole] = useState<UserRole>('staff');
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [usernameFeedback, setUsernameFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [createUserFeedback, setCreateUserFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const displayName = (role === 'staff' && user.toLowerCase().includes('admin')) ? 'Warehouse Staff' : user;
  const userRole = (role === 'admin' || (role !== 'staff' && user.toLowerCase().includes('admin'))) 
    ? 'SYSTEM ROOT (ADMIN)' 
    : 'OPERATIONAL STAFF';

  const auditEntries = [
    ...movements.map(movement => ({ ...movement, auditType: movement.type as 'IN' | 'OUT' })),
    ...inventoryAudit.map(entry => ({ ...entry, auditType: entry.action })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const totalActions = auditEntries.length;
  const inCount = movements.filter(m => m.type === 'IN').length;
  const outCount = movements.filter(m => m.type === 'OUT').length;
  const totalQtyMoved = movements.reduce((sum, m) => sum + m.qty, 0);

  const filteredMovements = auditEntries
    .filter(m => {
      if (filterType !== 'ALL' && m.auditType !== filterType) return false;
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const item = inventory.find(i => i.id === m.itemId);
      const itemName = ('itemName' in m ? m.itemName : item?.name || '').toLowerCase();
      const itemId = m.itemId.toLowerCase();
      const movementId = m.id.toLowerCase();
      return itemName.includes(query) || itemId.includes(query) || movementId.includes(query);
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const handleUndo = (id: string) => {
    if (onUndoMovement) {
      onUndoMovement(id);
      setConfirmUndoId(null);
    }
  };

  const clearPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordFeedback(null);
  };

  const clearUsernameForm = () => {
    setNewUsername(user);
    setUsernamePassword('');
    setUsernameFeedback(null);
  };

  const clearCreateUserForm = () => {
    setCreateUserName('');
    setCreateUserPassword('');
    setCreateUserRole('staff');
    setCreateUserFeedback(null);
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onChangePassword) {
      setPasswordFeedback({ type: 'error', message: 'Password change is unavailable.' });
      return;
    }

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setPasswordFeedback({ type: 'error', message: 'Please fill in all password fields.' });
      return;
    }

    if (newPassword.length < 4) {
      setPasswordFeedback({ type: 'error', message: 'New password must be at least 4 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', message: 'New passwords do not match.' });
      return;
    }

    try {
      await onChangePassword(currentPassword, newPassword);
      setPasswordFeedback({ type: 'success', message: 'Password updated successfully.' });
      clearPasswordForm();
      setTimeout(() => setIsPasswordModalOpen(false), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update password.';
      setPasswordFeedback({ type: 'error', message: message });
    }
  };

  const handleUsernameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onChangeUsername) {
      setUsernameFeedback({ type: 'error', message: 'Username change is unavailable.' });
      return;
    }

    const normalizedUsername = newUsername.trim();
    if (!normalizedUsername) {
      setUsernameFeedback({ type: 'error', message: 'Please enter a username.' });
      return;
    }

    if (normalizedUsername.length < 3) {
      setUsernameFeedback({ type: 'error', message: 'Username must be at least 3 characters long.' });
      return;
    }

    if (!usernamePassword.trim()) {
      setUsernameFeedback({ type: 'error', message: 'Please enter your current password.' });
      return;
    }

    try {
      await onChangeUsername(usernamePassword, normalizedUsername);
      setUsernameFeedback({ type: 'success', message: 'Username updated successfully.' });
      clearUsernameForm();
      setTimeout(() => setIsUsernameModalOpen(false), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update username.';
      setUsernameFeedback({ type: 'error', message: message });
    }
  };

  const handleCreateUserSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onCreateUser) {
      setCreateUserFeedback({ type: 'error', message: 'User creation is unavailable.' });
      return;
    }

    const username = createUserName.trim();
    const password = createUserPassword.trim();

    if (!username || !password) {
      setCreateUserFeedback({ type: 'error', message: 'Username and password are required.' });
      return;
    }

    if (username.length < 3) {
      setCreateUserFeedback({ type: 'error', message: 'Username must be at least 3 characters long.' });
      return;
    }

    if (password.length < 4) {
      setCreateUserFeedback({ type: 'error', message: 'Password must be at least 4 characters long.' });
      return;
    }

    try {
      await onCreateUser(username, password, createUserRole);
      setCreateUserFeedback({ type: 'success', message: 'User created successfully.' });
      clearCreateUserForm();
      setTimeout(() => setIsCreateUserModalOpen(false), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create user.';
      setCreateUserFeedback({ type: 'error', message: message });
    }
  };

  return (
    <>
      <div className="content-section flex-col-gap">
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--gap)', alignItems: 'stretch' }}>
        
        <div className="flex-col-gap" style={{ height: '100%' }}>
          <div className="dash-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '480px' }}>
            <div>
              <span className="label-micro" style={{ display: 'block', textAlign: 'center', opacity: 0.6 }}>Active Session Profile</span>
              
              <div className="flex-col-center" style={{ margin: '2.5rem 0', textAlign: 'center' }}>
                <div 
                  style={{ 
                    width: '72px', 
                    height: '72px', 
                    borderRadius: '50%', 
                    background: 'var(--item-bg)', 
                    border: '1px solid var(--line-soft)',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    marginBottom: '1rem'
                  }}
                >
                  <i className="bx bx-user" style={{ fontSize: '2.25rem', opacity: 0.7 }}></i>
                </div>
                <h2 className="title-main" style={{ fontSize: '1.75rem', textTransform: 'none', margin: '0' }}>{displayName}</h2>
                <span className={`velocity-badge ${role === 'staff' ? 'velocity-low' : 'velocity-medium'}`} style={{ marginTop: '0.75rem', letterSpacing: '0.05em' }}>
                  {userRole}
                </span>


              </div>
            </div>

            <div className="flex-col-gap" style={{ gap: '0.5rem', marginTop: 'auto' }}>
              <div className="flex-row-gap" style={{ width: '100%', gap: '0.5rem' }}>
                <button className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => {
                  clearUsernameForm();
                  setIsUsernameModalOpen(true);
                }}>
                  <i className="bx bx-user-circle" style={{ marginRight: '6px' }}></i> Change Username
                </button>
                <button className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => {
                  clearPasswordForm();
                  setIsPasswordModalOpen(true);
                }}>
                  <i className="bx bx-lock-alt" style={{ marginRight: '6px' }}></i> Change Password
                </button>
              </div>
              {role === 'admin' && (
                <button className="olive-button btn-outline w-full" onClick={() => {
                  clearCreateUserForm();
                  setIsCreateUserModalOpen(true);
                }}>
                  <i className="bx bx-user-plus" style={{ marginRight: '6px' }}></i> Add New User
                </button>
              )}
              <button className="olive-button btn-danger w-full" onClick={onLogout}>
                <i className="bx bx-log-out" style={{ marginRight: '6px' }}></i> Log Out Operator
              </button>
            </div>
          </div>
        </div>

        <div className="flex-col-gap" style={{ height: '100%' }}>
          <div className="dash-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
            <div className="flex-row-between mb-3" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div className="flex-row-center" style={{ gap: '0.5rem' }}>
                <i className="bx bx-history" style={{ fontSize: '1.25rem' }}></i>
                <span className="label-micro" style={{ fontSize: '12px' }}>
                  Session Audit History ({filteredMovements.length})
                </span>
              </div>
              
              <div className="flex-row-gap" style={{ gap: '4px' }}>
                <button 
                  className={`olive-button btn-outline label-micro ${filterType === 'ALL' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: '9px', textTransform: 'none', background: filterType === 'ALL' ? 'var(--ink)' : 'transparent', color: filterType === 'ALL' ? 'var(--bg)' : 'inherit' }}
                  onClick={() => setFilterType('ALL')}
                >
                  All ({totalActions})
                </button>
                <button 
                  className={`olive-button btn-outline label-micro ${filterType === 'IN' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: '9px', textTransform: 'none', background: filterType === 'IN' ? 'var(--success)' : 'transparent', color: filterType === 'IN' ? '#fff' : 'inherit' }}
                  onClick={() => setFilterType('IN')}
                >
                  Stock In ({inCount})
                </button>
                <button 
                  className={`olive-button btn-outline label-micro ${filterType === 'OUT' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: '9px', textTransform: 'none', background: filterType === 'OUT' ? 'var(--accent)' : 'transparent', color: filterType === 'OUT' ? '#fff' : 'inherit' }}
                  onClick={() => setFilterType('OUT')}
                >
                  Stock Out ({outCount})
                </button>
              </div>
            </div>

            <div className="form-group mb-3">
              <input 
                type="text" 
                className="form-input" 
                placeholder="Search audit entries by item name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ fontSize: '12px', padding: '0.5rem 0.75rem' }}
              />
            </div>

            <div className="flex-col-gap dash-card-list" style={{ flex: 1, maxHeight: '420px', overflowY: 'auto', gap: '0.5rem' }}>
              {filteredMovements.length > 0 ? (
                filteredMovements.map(m => {
                  const item = inventory.find(i => i.id === m.itemId);
                  const isMovement = 'qty' in m;
                  const isIn = isMovement && m.type === 'IN';
                  const actionLabel = isMovement ? m.type : m.action;
                  const localDateTimestamp = new Date(`${m.date}T00:00:00`).getTime();
                  const legacyUtcDateTimestamp = new Date(`${m.date}T00:00:00Z`).getTime();
                  const movementTimestamp = m.timestamp === legacyUtcDateTimestamp
                    ? localDateTimestamp
                    : (m.timestamp || localDateTimestamp);
                  const dateFormatted = new Date(movementTimestamp)
                    .toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    .toUpperCase();
                  const isConfirmingThis = confirmUndoId === m.id;

                  return (
                    <div 
                      key={m.id} 
                      className="flex-row-between border-soft p-3 hover-bg" 
                      style={{ 
                        gap: '0.75rem', 
                        padding: '0.5rem 0.75rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--item-bg)'
                      }}
                    >
                      <div className="flex-col-start" style={{ flex: 1, minWidth: 0, gap: '0.25rem' }}>
                        <div className="flex-row-center" style={{ gap: '0.5rem', flexWrap: 'wrap', lineHeight: 1.2 }}>
                          <span 
                            className="label-micro font-mono" 
                            style={{ 
                              textTransform: 'none', 
                              fontWeight: 600,
                              textOverflow: 'ellipsis', 
                              overflow: 'hidden', 
                              whiteSpace: 'nowrap',
                              fontSize: '12px',
                              opacity: 1
                            }}
                          >
                            {'itemName' in m ? m.itemName : item?.name || m.itemId}
                          </span>
                          <span className={`status-chip ${actionLabel === 'IN' || actionLabel === 'ADD' ? 'status-optimal' : 'status-critical'}`} style={{ padding: '1px 6px', fontSize: '8px' }}>
                            {actionLabel}
                          </span>
                        </div>
                        
                        <div className="flex-row-center" style={{ gap: '0.75rem', fontSize: '10px', lineHeight: 1.2 }}>
                          <span className="font-mono opacity-50">ID: {m.itemId}</span>
                          <span className="font-mono opacity-40">Ref: {m.id}</span>
                        </div>
                      </div>

                      <div className="flex-row-center" style={{ gap: '0.75rem', flexShrink: 0 }}>
                        <div className="flex-col-end" style={{ textAlign: 'right' }}>
                          <span className={`label-micro font-mono ${isIn ? 'text-success' : 'text-accent'}`} style={{ fontWeight: 'bold', fontSize: '13px' }}>
                            {isMovement ? `${isIn ? '+' : '-'}${m.qty}` : actionLabel}
                          </span>
                          <span className="label-micro font-mono text-micro opacity-50" style={{ fontSize: '9px' }}>
                            {dateFormatted}
                          </span>
                        </div>

                        {isMovement && onUndoMovement && (
                          isConfirmingThis ? (
                            <div className="flex-row-center" style={{ gap: '4px' }}>
                              <button 
                                onClick={() => handleUndo(m.id)}
                                title="Confirm Undo"
                                className="olive-button btn-danger label-micro"
                                style={{ padding: '2px 6px', fontSize: '9px', textTransform: 'none' }}
                              >
                                Confirm
                              </button>
                              <button 
                                onClick={() => setConfirmUndoId(null)}
                                className="olive-button btn-outline label-micro"
                                style={{ padding: '2px 6px', fontSize: '9px', textTransform: 'none' }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => setConfirmUndoId(m.id)}
                              title="Undo Transaction"
                              style={{
                                background: 'rgba(239, 68, 68, 0.05)',
                                border: '1px solid rgba(239, 68, 68, 0.15)',
                                borderRadius: '3px',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                color: 'var(--accent)',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
                                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.05)';
                                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
                              }}
                            >
                              <i className="bx bx-undo" style={{ fontSize: '12px' }}></i>
                              <span className="label-micro" style={{ fontSize: '9px', textTransform: 'none', color: 'inherit' }}>
                                Undo
                              </span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex-col-center" style={{ padding: '3rem 1rem', textAlign: 'center', opacity: 0.4, flex: 1, justifyContent: 'center' }}>
                  <i className="bx bx-receipt" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}></i>
                  <p className="label-micro" style={{ textTransform: 'none' }}>
                    {searchQuery ? 'No audit entries match your search criteria' : 'No audit history movements recorded in this session'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>

    <div className={`modal-overlay ${isUsernameModalOpen ? 'active' : ''}`}>
      <div className="modal-content mini">
        <div className="modal-header">
          <span className="label-micro">Change Username</span>
          <button className="close-modal" onClick={() => { clearUsernameForm(); setIsUsernameModalOpen(false); }}><i className="bx bx-x"></i></button>
        </div>
        <form onSubmit={handleUsernameSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="newUsername">New Username</label>
            <input id="newUsername" className="form-input" type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Enter new username" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="usernameCurrentPassword">Current Password</label>
            <input id="usernameCurrentPassword" className="form-input" type="password" value={usernamePassword} onChange={(e) => setUsernamePassword(e.target.value)} placeholder="Enter current password" />
          </div>

          {usernameFeedback && (
            <p className={`label-micro ${usernameFeedback.type === 'error' ? 'text-accent' : 'text-success'}`} style={{ margin: 0 }}>
              {usernameFeedback.message}
            </p>
          )}

          <div className="flex-row-gap" style={{ width: '100%' }}>
            <button type="button" className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => { clearUsernameForm(); setIsUsernameModalOpen(false); }}>Cancel</button>
            <button type="submit" className="olive-button" style={{ flex: 1 }}>Save</button>
          </div>
        </form>
      </div>
    </div>

    <div className={`modal-overlay ${isCreateUserModalOpen ? 'active' : ''}`}>
      <div className="modal-content mini">
        <div className="modal-header">
          <span className="label-micro">Add New User</span>
          <button className="close-modal" onClick={() => { clearCreateUserForm(); setIsCreateUserModalOpen(false); }}><i className="bx bx-x"></i></button>
        </div>
        <form onSubmit={handleCreateUserSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="createUserName">Username</label>
            <input id="createUserName" className="form-input" type="text" value={createUserName} onChange={(e) => setCreateUserName(e.target.value)} placeholder="Enter username" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="createUserPassword">Password</label>
            <input id="createUserPassword" className="form-input" type="password" value={createUserPassword} onChange={(e) => setCreateUserPassword(e.target.value)} placeholder="Create password" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="createUserRole">Role</label>
            <select id="createUserRole" className="form-input" value={createUserRole} onChange={(e) => setCreateUserRole(e.target.value as UserRole)}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {createUserFeedback && (
            <p className={`label-micro ${createUserFeedback.type === 'error' ? 'text-accent' : 'text-success'}`} style={{ margin: 0 }}>
              {createUserFeedback.message}
            </p>
          )}

          <div className="flex-row-gap" style={{ width: '100%' }}>
            <button type="button" className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => { clearCreateUserForm(); setIsCreateUserModalOpen(false); }}>Cancel</button>
            <button type="submit" className="olive-button" style={{ flex: 1 }}>Create</button>
          </div>
        </form>
      </div>
    </div>

    <div className={`modal-overlay ${isPasswordModalOpen ? 'active' : ''}`}>
      <div className="modal-content mini">
        <div className="modal-header">
          <span className="label-micro">Change Password</span>
          <button className="close-modal" onClick={() => { clearPasswordForm(); setIsPasswordModalOpen(false); }}><i className="bx bx-x"></i></button>
        </div>
        <form onSubmit={handlePasswordSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="currentPassword">Current Password</label>
            <input id="currentPassword" className="form-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="newPassword">New Password</label>
            <input id="newPassword" className="form-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input id="confirmPassword" className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" />
          </div>

          {passwordFeedback && (
            <p className={`label-micro ${passwordFeedback.type === 'error' ? 'text-accent' : 'text-success'}`} style={{ margin: 0 }}>
              {passwordFeedback.message}
            </p>
          )}

          <div className="flex-row-gap" style={{ width: '100%' }}>
            <button type="button" className="olive-button btn-outline" style={{ flex: 1 }} onClick={() => { clearPasswordForm(); setIsPasswordModalOpen(false); }}>Cancel</button>
            <button type="submit" className="olive-button" style={{ flex: 1 }}>Save</button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};

