import React, { useEffect, useRef, useState } from "react";
import { Item } from "../types";
import { BarcodeScanner } from "./BarcodeScanner";

interface ItemFormProps {
  item?: Partial<Item>;
  onSave: (data: Item) => void | Promise<void>;
  onCancel: () => void;
  readOnly?: boolean;
}

type ItemFormData = Omit<Partial<Item>, "safetyStock"> & {
  safetyStock?: number | "";
  imageFileName?: string;
};

const getImageFileName = (image?: string) => {
  if (!image || image.startsWith("data:")) return "";

  const encodedFileName = image.split(/[?#]/, 1)[0].split("/").pop();
  if (!encodedFileName) return "";

  let fileName = encodedFileName;
  try {
    fileName = decodeURIComponent(encodedFileName);
  } catch {
    return encodedFileName;
  }

  return fileName.replace(
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i,
    "",
  );
};

const RACK_LOCATIONS = Array.from({ length: 12 }, (_, aisleIndex) =>
  Array.from({ length: 3 }, (_, rackIndex) =>
    `${String.fromCharCode(65 + aisleIndex)}-${String(rackIndex + 1).padStart(2, "0")}`,
  ),
).flat();

export const ItemForm: React.FC<ItemFormProps> = ({
  item,
  onSave,
  onCancel,
  readOnly = false,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFileName, setImageFileName] = useState(() =>
    getImageFileName(item?.image),
  );
  const [formData, setFormData] = useState<ItemFormData>({
    id: "",
    name: "",
    barcode: "",
    category: "",
    rack: "",
    quantity: 0,
    price: 0,
    image: "",
    level: "L1",
    size: "MEDIUM",
    weight: "MEDIUM",
    demand: "MEDIUM",
    compatibleVehicles: "",
    orderingCost: 100,
    holdingCost: 0,
    leadTimeDays: 7,
    safetyStock: 10,
    ...item,
  });

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [error]);

  useEffect(() => {
    setImageFileName(getImageFileName(item?.image));
  }, [item?.image]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { id } = e.target;
    const value =
      id === "edit-category" ? e.target.value.toUpperCase() : e.target.value;
    const field = id.replace("edit-", "");
    setError(null);
    setFormData((prev) => ({
      ...prev,
      [field]: [
        "quantity",
        "price",
        "orderingCost",
        "holdingCost",
        "leadTimeDays",
        "safetyStock",
      ].includes(field)
        ? field === "safetyStock" && value === ""
          ? ""
          : parseFloat(value)
        : value,
    }));
  };

  const handleBarcodeScanned = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      barcode: value,
    }));
    setIsScannerOpen(false);
    setError(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Please select an image smaller than 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setFormData((prev) => ({
          ...prev,
          image: reader.result as string,
          imageFileName: file.name,
        }));
        setImageFileName(file.name);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (saving) return;

    const id = (formData.id ?? "").trim();
    const name = (formData.name ?? "").trim();
    const category = (formData.category ?? "").trim();
    const barcode = (formData.barcode ?? "").trim();

    if (!id || !name || !category || !barcode) {
      setError(
        "Please fill in all required fields (Item ID, Part Identification, Barcode, and Category).",
      );
      return;
    }

    const replenishmentFields = [
      "orderingCost",
      "holdingCost",
      "leadTimeDays",
      "safetyStock",
    ] as const;
    const missingReplenishment = replenishmentFields.some((field) => {
      const value = Number(formData[field]);
      return (
        formData[field] === undefined ||
        formData[field] === null ||
        Number.isNaN(value) ||
        value < 0
      );
    });

    if (missingReplenishment) {
      setError(
        "Please complete all replenishment settings (Ordering Cost, Holding Cost, Lead Time, and Safety Stock).",
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ ...formData, id, name, category, barcode } as Item);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the item. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const hasUnlistedRack = Boolean(
    formData.rack && !RACK_LOCATIONS.includes(formData.rack),
  );

  return (
    <div className="flex-col-gap">
      {readOnly && (
        <div
          className="label-micro opacity-70"
          style={{
            fontSize: "11px",
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--line)",
            background: "var(--bg-card)",
            borderRadius: "var(--radius)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <i className="bx bx-lock-alt"></i> Read-Only View (Staff Mode)
        </div>
      )}

      {error && (
        <div
          ref={errorRef}
          className="font-mono alert-text"
          style={{
            fontSize: "11px",
            padding: "0.75rem",
            border: "1px solid var(--accent)",
            background: "rgba(255, 68, 68, 0.05)",
            borderRadius: "var(--radius)",
          }}
        >
          <i
            className="bx bx-error-circle"
            style={{ marginRight: "6px", verticalAlign: "middle" }}
          ></i>
          {error}
        </div>
      )}

      <div className="form-group">
        <label className="label-micro">
          Item ID {!readOnly && <span className="text-accent">*</span>}
        </label>
        <input
          type="text"
          id="edit-id"
          className="form-input font-mono"
          value={formData.id}
          onChange={handleChange}
          disabled={readOnly}
          required
        />
      </div>
      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro form-label-part-identification">
            Part Identification{" "}
            {!readOnly && <span className="text-accent">*</span>}
          </label>
          <input
            type="text"
            id="edit-name"
            className="form-input"
            value={formData.name}
            onChange={handleChange}
            disabled={readOnly}
            required
          />
        </div>

{/* Barcode input and scanner */}
        <div className="form-group">
          <label className="label-micro">
            Barcode {!readOnly && <span className="text-accent">*</span>}
          </label>

          <div className="flex-row-gap">
            <input
              type="text"
              id="edit-barcode"
              className="form-input"
              value={formData.barcode || ""}
              onChange={handleChange}
              disabled={readOnly}
              required={!readOnly}
            />

            {!readOnly && (
              <button
                type="button"
                className={`barcode-scan-toggle ${isScannerOpen ? "active" : ""}`}
                onClick={() => setIsScannerOpen((prev) => !prev)}
                title="Scan barcode"
              >
                <i className={`bx ${isScannerOpen ? "bx-x" : "bx-barcode-reader"}`}></i>
              </button>
            )}
          </div>

          {isScannerOpen && (
            <div style={{ marginTop: "12px" }}>
              <BarcodeScanner onScanSuccess={handleBarcodeScanned} />
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="label-micro">
            Category {!readOnly && <span className="text-accent">*</span>}
          </label>
          <input
            type="text"
            id="edit-category"
            className="form-input"
            value={formData.category || ""}
            onChange={handleChange}
            disabled={readOnly}
            required
            placeholder="Enter category"
          />
        </div>
      </div>
      <div className="form-group">
        <label className="label-micro">
          Replenishment Settings{" "}
          {!readOnly && <span className="text-accent">*</span>}
        </label>
        <div className="grid-4 border-soft-no-pad p-0">
          <div className="form-group">
            <label className="label-micro">
              Ordering Cost (₱){" "}
              {!readOnly && <span className="text-accent">*</span>}
            </label>
            <input
              type="number"
              id="edit-orderingCost"
              className="form-input font-mono"
              value={formData.orderingCost ?? 100}
              onChange={handleChange}
              min="0"
              step="0.01"
              required={!readOnly}
              disabled={readOnly}
            />
          </div>
          <div className="form-group">
            <label className="label-micro">
              Holding Cost / Year (₱){" "}
              {!readOnly && <span className="text-accent">*</span>}
            </label>
            <input
              type="number"
              id="edit-holdingCost"
              className="form-input font-mono"
              value={formData.holdingCost ?? 0}
              onChange={handleChange}
              min="0"
              step="0.01"
              required={!readOnly}
              disabled={readOnly}
            />
          </div>
          <div className="form-group">
            <label className="label-micro">
              Lead Time (Days){" "}
              {!readOnly && <span className="text-accent">*</span>}
            </label>
            <input
              type="number"
              id="edit-leadTimeDays"
              className="form-input font-mono"
              value={formData.leadTimeDays ?? 7}
              onChange={handleChange}
              min="0"
              step="1"
              required={!readOnly}
              disabled={readOnly}
            />
          </div>
          <div className="form-group">
            <label className="label-micro">
              Safety Stock {!readOnly && <span className="text-accent">*</span>}
            </label>
            <input
              type="number"
              id="edit-safetyStock"
              className="form-input font-mono"
              value={formData.safetyStock ?? 10}
              onChange={handleChange}
              min="0"
              step="1"
              required={!readOnly}
              disabled={readOnly}
            />
          </div>
        </div>
      </div>

      <div className="grid-3 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Size</label>
          <select
            id="edit-size"
            className="form-input"
            value={formData.size || "MEDIUM"}
            onChange={handleChange}
            disabled={readOnly}
          >
            <option value="SMALL">Small</option>
            <option value="MEDIUM">Medium</option>
            <option value="LARGE">Large</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label-micro">Weight</label>
          <select
            id="edit-weight"
            className="form-input"
            value={formData.weight || "MEDIUM"}
            onChange={handleChange}
            disabled={readOnly}
          >
            <option value="LIGHT">Light</option>
            <option value="MEDIUM">Medium</option>
            <option value="HEAVY">Heavy</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label-micro">Demand</label>
          <select
            id="edit-demand"
            className="form-input"
            value={formData.demand || "MEDIUM"}
            onChange={handleChange}
            disabled={readOnly}
          >
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>

      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">Rack Location</label>
          <select
            id="edit-rack"
            className="form-input"
            value={formData.rack || ""}
            onChange={handleChange}
            disabled={readOnly}
          >
            <option value="">Select a rack</option>
            {hasUnlistedRack && (
              <option value={formData.rack}>{formData.rack} (current)</option>
            )}
            {RACK_LOCATIONS.map((rack) => (
              <option key={rack} value={rack}>
                {rack}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="label-micro">Level</label>
          <select
            id="edit-level"
            className="form-input"
            value={formData.level}
            onChange={handleChange}
            disabled={readOnly}
          >
            <option value="L1">L1 (Bottom)</option>
            <option value="L2">L2</option>
            <option value="L3">L3</option>
            <option value="L4">L4 (Top)</option>
          </select>
        </div>
      </div>

      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">
            Quantity {!readOnly && <span className="text-accent">*</span>}
          </label>
          <input
            type="number"
            id="edit-quantity"
            className="form-input font-mono"
            value={formData.quantity}
            onChange={handleChange}
            min="0"
            disabled={readOnly}
            required
          />
        </div>

        <div className="form-group">
          <label className="label-micro">
            Price (₱) {!readOnly && <span className="text-accent">*</span>}
          </label>
          <input
            type="number"
            id="edit-price"
            className="form-input font-mono"
            value={formData.price}
            onChange={handleChange}
            min="0"
            step="0.01"
            disabled={readOnly}
            required
          />
        </div>
      </div>
      
      <div className="form-group">
        <label className="label-micro">IMAGE</label>
        <input
          type="file"
          id="edit-image-file"
          accept="image/*"
          onChange={handleImageUpload}
          disabled={readOnly}
          ref={imageInputRef}
          style={{ display: "none" }}
        />
        <div className="flex-row-gap">
          <input
            type="text"
            className="form-input"
            value={imageFileName}
            placeholder="No image selected"
            aria-label="Image file name"
            readOnly
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            className="olive-button btn-outline"
            onClick={() => imageInputRef.current?.click()}
            disabled={readOnly}
          >
            Choose Image
          </button>
        </div>
      </div>
      <div className="form-group">
        <label className="label-micro">Compatible Vehicles</label>
        <input
          type="text"
          id="edit-compatibleVehicles"
          className="form-input"
          value={formData.compatibleVehicles || ""}
          onChange={handleChange}
          placeholder="e.g. Toyota Civic, Honda Altis"
          disabled={readOnly}
        />
      </div>

      <div className="flex-row-gap mt-4">
        {readOnly ? (
          <button
            className="olive-button"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Close
          </button>
        ) : (
          <>
            <button
              className="olive-button btn-outline"
              style={{ flex: 1 }}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="olive-button"
              style={{ flex: 1 }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Item"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
