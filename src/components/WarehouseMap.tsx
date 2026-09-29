import React, { useState, useEffect } from "react";
import { Item, Movement } from "../types";
import { Modal } from "./Modal";
import { isAtReorderPoint } from "../inventoryMetrics";

const ZONES = [
  {
    id: "A",
    name: "AISLE A: High Demand",
    desc: "Fast-Moving / High Pick Velocity",
    racks: 8,
    color: "#3B82F6",
  },
  {
    id: "B",
    name: "AISLE B: Mechanical & Brakes",
    desc: "Engine, Brakes & Suspension",
    racks: 8,
    color: "#A855F7",
  },
  {
    id: "C",
    name: "AISLE C: Electrical & Body",
    desc: "Sensors, Panels & Accessories",
    racks: 8,
    color: "#14B8A6",
  },
  {
    id: "D",
    name: "AISLE D: Bulk & Heavy Goods",
    desc: "Heavy Assemblies & Bulk Stock",
    racks: 8,
    color: "#F43F5E",
  },
];

interface WarehouseMapProps {
  inventory: Item[];
  movements: Movement[];
  onEditItem: (id: string) => void;
  onAddItem: (rack?: string) => void;
  onBulkUpdate: (newInventory: Item[]) => void;
  initialRack?: string | null;
  onClearInitialRack?: () => void;
  userRole?: "admin" | "staff";
}

export const WarehouseMap: React.FC<WarehouseMapProps> = ({
  inventory,
  movements,
  onEditItem,
  onAddItem,
  onBulkUpdate,
  initialRack,
  onClearInitialRack,
  userRole = "staff",
}) => {
  const [selectedRack, setSelectedRack] = useState<{
    zoneId: string;
    rackId: string;
  } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<
    | {
        id: string;
        name: string;
        category: string;
        demand: "HIGH" | "MEDIUM" | "LOW";
        oldRack: string;
        newRack: string;
        demandReason: string;
      }[]
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const normalizeRack = (r: string | undefined) =>
    r ? r.replace(/-/g, "").toUpperCase() : "";

  const getStockOutQty = (item: Item): number => {
    return movements
      .filter((m) => m.itemId === item.id && m.type === "OUT")
      .reduce((sum, m) => sum + m.qty, 0);
  };

  const getItemDemand = (item: Item): "HIGH" | "MEDIUM" | "LOW" => {
    const stockOutQty = getStockOutQty(item);
    if (stockOutQty >= 15) return "HIGH";
    if (stockOutQty >= 4) return "MEDIUM";
    if (stockOutQty > 0) return "LOW";
    return item.demand || "LOW";
  };

  const runOptimization = async () => {
    setIsOptimizing(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const proposals = inventory.map((item) => {
        const demand = getItemDemand(item);
        const stockOutQty = getStockOutQty(item);
        const itemSeed = item.id
          .split("")
          .reduce((acc, char) => acc + char.charCodeAt(0), 0);

        let targetZone = "B";
        let targetRackNum = 1;
        let demandReason = "";

        if (demand === "HIGH") {
          targetZone = "A";
          targetRackNum = 1 + (itemSeed % 8);
          demandReason = `High Demand (${stockOutQty} units stocked out) → Aisle A (R0${targetRackNum}) dedicated fast-pick slot`;
        } else if (demand === "LOW") {
          const cat = item.category.toUpperCase();
          if (cat.includes("ELECTRICAL") || cat.includes("BODY")) {
            targetZone = "C";
          } else if (
            cat.includes("TRANSMISSION") ||
            cat.includes("BULK") ||
            cat.includes("HEAVY")
          ) {
            targetZone = "D";
          } else {
            targetZone = "B";
          }
          targetRackNum = 5 + (itemSeed % 4);
          demandReason = `Low Demand (${stockOutQty} units stocked out) → Aisle ${targetZone} (R0${targetRackNum}) deep buffer storage`;
        } else {
          const cat = item.category.toUpperCase();
          if (cat.includes("ELECTRICAL") || cat.includes("BODY")) {
            targetZone = "C";
          } else if (
            cat.includes("TRANSMISSION") ||
            cat.includes("BULK") ||
            cat.includes("HEAVY")
          ) {
            targetZone = "D";
          } else {
            targetZone = "B";
          }
          targetRackNum = 1 + (itemSeed % 4);
          demandReason = `Medium Demand (${stockOutQty} units stocked out) → Aisle ${targetZone} (R0${targetRackNum}) standard picking slot`;
        }

        const suggestedRack = `${targetZone}-${String(targetRackNum).padStart(2, "0")}`;

        return {
          id: item.id,
          name: item.name,
          category: item.category,
          demand,
          oldRack: item.rack || "NONE",
          newRack: suggestedRack,
          demandReason,
        };
      });

      const relocationsNeeded = proposals.filter(
        (p) => normalizeRack(p.oldRack) !== normalizeRack(p.newRack),
      );

      setOptimizationResult(relocationsNeeded);
    } catch (err) {
      console.error(err);
      setError("Failed to run layout optimization.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const applyOptimization = () => {
    if (!optimizationResult) return;
    const newInventory = inventory.map((item) => {
      const opt = optimizationResult.find((o) => o.id === item.id);
      if (opt) {
        return {
          ...item,
          rack: opt.newRack,
        };
      }
      return item;
    });
    onBulkUpdate(newInventory);
    setOptimizationResult(null);
  };

  useEffect(() => {
    if (initialRack) {
      const zoneId = initialRack.charAt(0).toUpperCase();
      setSelectedRack({ zoneId, rackId: initialRack });
      if (onClearInitialRack) onClearInitialRack();
    }
  }, [initialRack, onClearInitialRack]);

  const aisleData = ["A", "B", "C", "D"].map((id) => {
    const aisleItems = inventory.filter((i) =>
      (i.rack || "").toUpperCase().startsWith(id),
    );
    const sizeCapacity = { SMALL: 0.25, MEDIUM: 1, LARGE: 2 } as const;
    const totalQty = aisleItems.reduce(
      (sum, item) => sum + item.quantity * sizeCapacity[item.size || "MEDIUM"],
      0,
    );
    const uniqueItems = aisleItems.length;
    const maxCapacity = 1000;
    const density = Math.min(100, Math.round((totalQty / maxCapacity) * 100));
    let statusClass = "status-optimal";
    let statusText = "Optimal";

    if (density > 80) {
      statusClass = "status-critical";
      statusText = "Overloaded";
    } else if (density > 50) {
      statusClass = "status-warning";
      statusText = "Moderate";
    }
    return { id, totalQty, uniqueItems, density, statusClass, statusText };
  });

  const InspectionModal = () => {
    if (!selectedRack) return null;
    return (
      <div className="modal-overlay active clean-modal">
        <div className="modal-content clean">
          <div className="rack-inspection-header">
            <div className="rack-inspection-icon-wrap">
              <i className="bx bxs-layer"></i>
            </div>
            <div className="rack-inspection-title-wrap">
              <h2>Rack Inspection</h2>
              <div className="rack-inspection-subtitle">
                Cell Ident: {selectedRack.zoneId}-R
                {selectedRack.rackId.split("-")[1]}
              </div>
            </div>
            <button
              className="close-preview-btn"
              onClick={() => setSelectedRack(null)}
            >
              <i className="bx bx-x"></i>
            </button>
          </div>
          <div className="inspection-main">
            <div className="aisle-info-row">
              <div className="aisle-badge">Aisle {selectedRack.rackId}</div>
            </div>
            <div className="level-container">
              {["L4", "L3", "L2", "L1"].map((lvl, idx) => {
                const rackItems = inventory.filter(
                  (i) =>
                    normalizeRack(i.rack) ===
                    normalizeRack(selectedRack.rackId),
                );
                const levelItems = rackItems.filter((i, itemIdx) =>
                  i.level ? i.level === lvl : itemIdx % 4 === 3 - idx,
                );
                return (
                  <div key={lvl} className="level-row-modern">
                    <div className="level-label-modern">{lvl}</div>
                    <div
                      className={`level-belt ${levelItems.length > 0 ? "occupied-belt" : ""}`}
                    >
                      {levelItems.map((i) => (
                        <div
                          key={i.id}
                          className={`item-token ${isAtReorderPoint(i, movements) ? "low-stock-alert" : ""}`}
                          style={{ cursor: "pointer" }}
                          onClick={() => onEditItem(i.id)}
                        >
                          <div
                            className="flex-col"
                            style={{ alignItems: "center" }}
                          >
                            <span className="item-token-label">{i.name}</span>
                            <span style={{ fontSize: "8px", opacity: 0.5 }}>
                              {i.id}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="content-section">
      {error && (
        <div className="dash-card mb-4 border-accent p-3 text-accent label-micro text-center">
          {error}
        </div>
      )}

      <div className="warehouse-layout-container">
        <div className="warehouse-map-grid">
          {ZONES.map((zone) => {
            const zoneItems = inventory.filter((i) =>
              normalizeRack(i.rack).startsWith(zone.id),
            );
            const pickingLabelText =
              zone.id === "A"
                ? "High Demand Only"
                : zone.id === "B"
                  ? "High Demand Only"
                  : zone.id === "C"
                    ? "Slow Demand Only"
                    : "Slow Demand Only";
            return (
              <div key={zone.id} className="zone-cell">
                <div className="zone-top-header">
                  <div className="aisle-title">AISLE {zone.id}</div>
                  <div className="picking-label">{pickingLabelText}</div>
                </div>
                <div className="rack-container">
                  {Array.from({ length: zone.racks }).map((_, i) => {
                    const rackId = `${zone.id}-${String(i + 1).padStart(2, "0")}`;
                    const rackSpecificItems = zoneItems.filter(
                      (item) =>
                        normalizeRack(item.rack) === normalizeRack(rackId),
                    );
                    const isPrimary =
                      zone.id !== "A" &&
                      rackSpecificItems.some(
                        (item) => getItemDemand(item) === "HIGH",
                      );
                    const hasLowStock = rackSpecificItems.some((item) =>
                      isAtReorderPoint(item, movements),
                    );
                    return (
                      <div
                        key={rackId}
                        className={`rack ${isPrimary ? "primary" : ""} ${hasLowStock ? "low-stock-alert" : ""}`}
                        onClick={() =>
                          setSelectedRack({ zoneId: zone.id, rackId })
                        }
                      >
                        <div className="rack-icon">
                          {[1, 2, 3, 4].map((b) => (
                            <div key={b} className="rack-bar"></div>
                          ))}
                        </div>
                        <div className="rack-id">Rack {i + 1}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="location-analytics-container">
          <div className="dash-card">
            <div className="flex-row-between mb-2">
              <span className="label-micro">Aisle Density Analytics</span>
            </div>
            <div className="flex-col-gap" style={{ gap: "0.5rem" }}>
              {aisleData.map((a) => (
                <div key={a.id} className="aisle-analytics-card border-soft">
                  <div className="flex-row-between mb-1">
                    <span className="aisle-header-text">
                      AISLE {a.id} ({a.uniqueItems})
                    </span>
                    <span
                      className={`status-chip ${a.statusClass}`}
                      style={{ padding: "1px 6px", fontSize: "8px" }}
                    >
                      {a.statusText}
                    </span>
                  </div>
                  <div
                    className="density-bar-bg"
                    style={{ margin: "0.5rem 0" }}
                  >
                    <div
                      className="density-bar-fill"
                      style={{
                        width: `${a.density}%`,
                        background:
                          a.density > 80 ? "var(--accent)" : "var(--ink)",
                      }}
                    ></div>
                  </div>
                  <div className="flex-row-end">
                    <span
                      className="label-micro font-mono"
                      style={{ fontSize: "9px" }}
                    >
                      {a.density}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="warehouse-optimizer border-soft mt-4 p-4">
              <div className="flex-col mb-4">
                <span className="label-micro">
                  <i className="bx bx-bolt-circle"></i> WAREHOUSE LAYOUT
                  OPTIMIZER
                </span>
                <p
                  className="label-micro opacity-70 mt-1"
                  style={{ textTransform: "none", lineHeight: "1.4" }}
                >
                  Optimize layout by demand.
                </p>
              </div>
              <button
                className={`olive-button w-full ${isOptimizing ? "opacity-50" : ""}`}
                onClick={runOptimization}
                disabled={isOptimizing}
              >
                {isOptimizing ? (
                  <i className="bx bx-loader-alt bx-spin mr-2"></i>
                ) : (
                  <i className="bx bx-refresh mr-2"></i>
                )}
                Analyze & Optimize Layout
              </button>
            </div>
          </div>
        </div>
      </div>

      <InspectionModal />

      {optimizationResult && (
        <Modal
          isOpen={true}
          onClose={() => setOptimizationResult(null)}
          title="DEMAND-BASED LAYOUT OPTIMIZER"
          footer={
            <div className="flex-row-gap">
              <button
                className="olive-button btn-outline"
                onClick={() => setOptimizationResult(null)}
              >
                Discard
              </button>
              <button className="olive-button" onClick={applyOptimization}>
                Apply Relocations ({optimizationResult.length})
              </button>
            </div>
          }
        >
          <div className="flex-col-gap">
            <div
              className="flex-row-between mb-2 p-2 border-soft"
              style={{
                background: "var(--bg)",
                borderRadius: "6px",
                fontSize: "11px",
              }}
            >
              <span>
                <strong>{optimizationResult.length}</strong> items recommended
                for demand-based relocation
              </span>
              <span
                className="label-micro font-mono text-bold"
                style={{ color: "var(--ink)" }}
              >
                High Demand prioritized in Aisle A & Front Slots
              </span>
            </div>
            <div
              className="table-container"
              style={{ maxHeight: "420px", overflowY: "auto" }}
            >
              <div
                className="table-header table-grid"
                style={{
                  gridTemplateColumns: "2.2fr 1.2fr 1fr 1fr 2.6fr",
                  fontSize: "10px",
                }}
              >
                <span className="label-table">Item & Category</span>
                <span className="label-table">Demand</span>
                <span className="label-table">Current</span>
                <span className="label-table">Optimized</span>
                <span className="label-table">Demand Rationale</span>
              </div>
              <div className="table-body">
                {optimizationResult.map((res, idx) => (
                  <div
                    key={idx}
                    className="table-row table-grid"
                    style={{
                      gridTemplateColumns: "2.2fr 1.2fr 1fr 1fr 2.6fr",
                      fontSize: "10px",
                      alignItems: "center",
                    }}
                  >
                    <div className="flex-col" style={{ gap: "2px" }}>
                      <span className="text-bold">{res.name}</span>
                      <span
                        className="label-micro font-mono opacity-50"
                        style={{ fontSize: "8px" }}
                      >
                        {res.id} · {res.category}
                      </span>
                    </div>
                    <div>
                      <span
                        className={
                          res.demand === "HIGH"
                            ? "badge-demand-high"
                            : res.demand === "LOW"
                              ? "badge-demand-low"
                              : "badge-demand-med"
                        }
                      >
                        {res.demand === "HIGH"
                          ? "High Demand"
                          : res.demand === "LOW"
                            ? "Low Demand"
                            : "Medium Demand"}
                      </span>
                    </div>
                    <div
                      className="font-mono opacity-60"
                      style={{ fontSize: "11px" }}
                    >
                      <span>{res.oldRack}</span>
                    </div>
                    <div
                      className="font-mono text-bold"
                      style={{ fontSize: "11px" }}
                    >
                      <span className="text-success">{res.newRack}</span>
                    </div>
                    <div
                      className="flex-col"
                      style={{ gap: "2px", fontSize: "9px", lineHeight: "1.3" }}
                    >
                      <span className="opacity-90">{res.demandReason}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
