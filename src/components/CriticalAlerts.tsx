import React, { useEffect, useRef, useState } from 'react';
import { Item, Movement } from '../types';
import { getRop } from '../inventoryMetrics';

// Items the user has already seen in the alert panel. Stored per browser.
const SEEN_KEY = 'skyrun_seen_critical_ids';

function readSeen(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be blocked. The red dot then returns on the next visit, which is harmless.
  }
}

interface CriticalAlertsProps {
  criticalItems: Item[];
  movements: Movement[];
  onOpenItem: (id: string) => void;
}

export const CriticalAlerts: React.FC<CriticalAlertsProps> = ({ criticalItems, movements, onOpenItem }) => {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [seen, setSeen] = useState<string[]>(readSeen);
  const [newIds, setNewIds] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(false);

  const isVisible = hovered || pinned;
  const criticalIds = criticalItems.map((item) => item.id);
  const criticalKey = criticalIds.join('|');
  const unseenIds = criticalIds.filter((id) => !seen.includes(id));

  // An item that stops being critical is forgotten, so it counts as new if it becomes critical again.
  useEffect(() => {
    setSeen((previous) => {
      const next = previous.filter((id) => criticalIds.includes(id));
      if (next.length === previous.length) return previous;
      writeSeen(next);
      return next;
    });
    // criticalKey summarises criticalIds; it changes exactly when the list does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criticalKey]);

  // Opening the panel marks which items are new; closing it marks everything as seen.
  useEffect(() => {
    if (isVisible && !wasVisible.current) {
      setNewIds(unseenIds);
    }
    if (!isVisible && wasVisible.current) {
      setSeen(criticalIds);
      writeSeen(criticalIds);
    }
    wasVisible.current = isVisible;
    // Runs when the panel opens or closes; the lists it reads are current at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // A click outside the alert closes a pinned panel.
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [pinned]);

  const close = () => {
    setPinned(false);
    setHovered(false);
  };

  const sorted = [...criticalItems].sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
  const count = criticalItems.length;

  return (
    <div
      className="crit"
      ref={wrapRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isVisible) close();
      }}
    >
      <button
        type="button"
        className={`crit-button${count > 0 ? ' has-alerts' : ''}`}
        aria-expanded={isVisible}
        aria-controls="crit-panel"
        onClick={() => setPinned((value) => !value)}
      >
        <i className="bx bx-bell" aria-hidden="true"></i>
        <span className="crit-label">Critical alerts</span>
        {count > 0 && <span className="crit-count">{count}</span>}
        {unseenIds.length > 0 && !isVisible && <span className="crit-dot" aria-hidden="true"></span>}
        {unseenIds.length > 0 && !isVisible && (
          <span className="sr-only">{unseenIds.length} new critical alert{unseenIds.length === 1 ? '' : 's'}</span>
        )}
      </button>

      {isVisible && (
        <div id="crit-panel" className="crit-panel" role="region" aria-label="Critical alerts">
          <div className="crit-panel-head">
            <p className="crit-panel-title">Critical alerts</p>
            <p className="crit-panel-sub">
              {count === 0
                ? 'Nothing needs attention right now.'
                : `${count} item${count === 1 ? '' : 's'} at or below the reorder point`}
            </p>
          </div>

          {count === 0 ? (
            <div className="crit-empty">
              <i className="bx bx-check-circle" aria-hidden="true"></i>
              <span>Every item is above its reorder point.</span>
            </div>
          ) : (
            <ul className="crit-list">
              {sorted.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="crit-item"
                    onClick={() => {
                      close();
                      onOpenItem(item.id);
                    }}
                  >
                    <span className="crit-item-main">
                      <span className="crit-item-name">{item.name}</span>
                      <span className="crit-item-sub">
                        {item.id} · Reorder point {Math.round(getRop(item, movements)).toLocaleString()}
                      </span>
                    </span>
                    <span className="crit-item-qty">{item.quantity.toLocaleString()} left</span>
                    {newIds.includes(item.id) && <span className="crit-new">New</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
