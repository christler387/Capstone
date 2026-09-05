import React, { useState } from 'react';
import { Movement, Item, UserRole } from '../types';

// ============================================================================
// COMPONENT CONTRACT & PROPS
// ============================================================================
interface UserProfileProps {
  user: string;
  role?: UserRole;
  movements: Movement[];
  inventory: Item[];
  onLogout: () => void;
  onGoToDashboard: () => void;
  onUndoMovement?: (id: string) => void;
  onSwitchRole?: (role: UserRole, name: string) => void;
}

// ============================================================================
// USER PROFILE & AUDIT TRAIL VIEW
// ============================================================================
export const UserProfile: React.FC<UserProfileProps> = ({ 
  user, 
  role = 'staff',
  movements, 
  inventory, 
  onLogout, 
  onGoToDashboard,
  onUndoMovement,
  onSwitchRole
}) => {
  // ==========================================================================
  // 1. FILTER & CONFIRMATION STATE
  // ==========================================================================
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);

  // ==========================================================================
  // 2. COMPUTED METRICS & AUDIT LOGS
  // ==========================================================================
  const displayName = (role === 'staff' && user.toLowerCase().includes('admin')) ? 'Warehouse Staff' : user;
  const userRole = (role === 'admin' || (role !== 'staff' && user.toLowerCase().includes('admin'))) 
    ? 'SYSTEM ROOT (ADMIN)' 
    : 'OPERATIONAL STAFF';

  const totalActions = movements.length;
  const inCount = movements.filter(m => m.type === 'IN').length;
  const outCount = movements.filter(m => m.type === 'OUT').length;
  const totalQtyMoved = movements.reduce((sum, m) => sum + m.qty, 0);

  const filteredMovements = movements
    .filter(m => {
      if (filterType !== 'ALL' && m.type !== filterType) return false;
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const item = inventory.find(i => i.id === m.itemId);
      const itemName = item?.name.toLowerCase() || '';
      const itemId = m.itemId.toLowerCase();
      const movementId = m.id.toLowerCase();
      return itemName.includes(query) || itemId.includes(query) || movementId.includes(query);
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  // ==========================================================================
  // 3. ACTION HANDLERS
  // ==========================================================================
  const handleUndo = (id: string) => {
    if (onUndoMovement) {
      onUndoMovement(id);
      setConfirmUndoId(null);
    }
  };

  return (
    <div className="content-section flex-col-gap">
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--gap)', alignItems: 'stretch' }}>
        
        {/* Left Column: Profile Card & Session Diagnostics */}
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
              <button className="olive-button btn-danger w-full" onClick={onLogout}>
                <i className="bx bx-log-out" style={{ marginRight: '6px' }}></i> Log Out Operator
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Audit History Ledger */}
        <div className="flex-col-gap" style={{ height: '100%' }}>
          <div className="dash-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: '480px' }}>
            {/* Audit History Header */}
            <div className="flex-row-between mb-3" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div className="flex-row-center" style={{ gap: '0.5rem' }}>
                <i className="bx bx-history" style={{ fontSize: '1.25rem' }}></i>
                <span className="label-micro" style={{ fontSize: '12px' }}>
                  Session Audit History ({filteredMovements.length})
                </span>
              </div>
              
              {/* Filter Tabs */}
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

            {/* Search Input for Audit History */}
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

            {/* Audit Log Entries List */}
            <div className="flex-col-gap dash-card-list" style={{ flex: 1, maxHeight: '420px', overflowY: 'auto', gap: '0.5rem' }}>
              {filteredMovements.length > 0 ? (
                filteredMovements.map(m => {
                  const item = inventory.find(i => i.id === m.itemId);
                  const isIn = m.type === 'IN';
                  const dateFormatted = new Date(m.timestamp || m.date)
                    .toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    .toUpperCase();
                  const isConfirmingThis = confirmUndoId === m.id;

                  return (
                    <div 
                      key={m.id} 
                      className="flex-row-between border-soft p-3 hover-bg" 
                      style={{ 
                        gap: '0.75rem', 
                        borderRadius: 'var(--radius)',
                        background: 'var(--item-bg)'
                      }}
                    >
                      <div className="flex-col-start" style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex-row-center" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
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
                            {item?.name || m.itemId}
                          </span>
                          <span className={`status-chip ${isIn ? 'status-optimal' : 'status-critical'}`} style={{ padding: '1px 6px', fontSize: '8px' }}>
                            {m.type}
                          </span>
                        </div>
                        
                        <div className="flex-row-center mt-1" style={{ gap: '0.75rem', fontSize: '10px' }}>
                          <span className="font-mono opacity-50">ID: {m.itemId}</span>
                          <span className="font-mono opacity-40">Ref: {m.id}</span>
                        </div>
                      </div>

                      <div className="flex-row-center" style={{ gap: '0.75rem', flexShrink: 0 }}>
                        <div className="flex-col-end" style={{ textAlign: 'right' }}>
                          <span className={`label-micro font-mono ${isIn ? 'text-success' : 'text-accent'}`} style={{ fontWeight: 'bold', fontSize: '13px' }}>
                            {isIn ? '+' : '-'}{m.qty}
                          </span>
                          <span className="label-micro font-mono text-micro opacity-50" style={{ fontSize: '9px' }}>
                            {dateFormatted}
                          </span>
                        </div>

                        {onUndoMovement && (
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
  );
};

