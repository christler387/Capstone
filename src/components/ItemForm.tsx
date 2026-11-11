import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Item, ItemDescriptorField } from "../types";
import { ScannerDialog } from "./ScannerDialog";
import { Combobox, normalizeDescriptor } from "./Combobox";

// Typed fields that suggest values already saved on other items.
const DESCRIPTOR_FIELDS: ItemDescriptorField[] = ["category", "brand", "model", "color", "unitOfMeasure", "supplier"];

interface ItemFormProps {
  item?: Partial<Item>;
  existingItems?: Item[];
  onSave: (data: Item) => void | Promise<void>;
  onCancel: () => void;
  readOnly?: boolean;
  // Every rack code in the warehouse layout, for the Rack Location dropdown.
  rackLocations?: string[];
  // Each rack with the floor it sits on, so the Floor dropdown can narrow the rack choices.
  rackFloors?: { code: string; floorId: number; floorName: string }[];
  // Every floor in the layout, including floors that have no racks yet.
  floors?: { id: number; name: string }[];
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

// A picture address the user can open: a web link or a picture uploaded to this site.
const isWebAddress = (value: string) => /^(https?:\/\/|\/api\/uploads\/)/i.test(value.trim());

// Fields that must be filled in before saving. Everything else (barcode, rack, brand, type, model,
// part no., color, unit) is optional. Dropdowns always have a value, so they are not listed.
const REQUIRED_FIELD_LABELS: Partial<Record<keyof ItemFormData, string>> = {
  id: "Item ID",
  name: "Part Identification",
  category: "Category",
  quantity: "Quantity",
  price: "Price",
  compatibleVehicles: "Compatible vehicles",
  orderingCost: "Ordering cost",
  holdingCost: "Holding cost",
  leadTimeDays: "Lead time",
  safetyStock: "Safety stock",
};

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (typeof value === "number" && Number.isNaN(value));

const missingRequiredKeys = (data: ItemFormData) =>
  (Object.keys(REQUIRED_FIELD_LABELS) as Array<keyof ItemFormData>).filter((key) => isEmptyValue(data[key]));

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the picture.")));
    reader.onerror = () => reject(new Error("Could not read the picture."));
    reader.readAsDataURL(file);
  });

export const ItemForm: React.FC<ItemFormProps> = ({
  item,
  existingItems = [],
  onSave,
  onCancel,
  readOnly = false,
  rackLocations = [],
  rackFloors = [],
  floors = [],
}) => {
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  // Required fields are marked only after the user tries to save, so a new form does not start red.
  const [showMissing, setShowMissing] = useState(false);
  const isMissing = (key: keyof ItemFormData) => showMissing && isEmptyValue(formData[key]);
  const missingClass = (key: keyof ItemFormData) => (isMissing(key) ? " is-missing" : "");
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
    weight: "MEDIUM",
    demand: "MEDIUM",
    compatibleVehicles: "",
    orderingCost: 100,
    holdingCost: 0,
    leadTimeDays: 7,
    safetyStock: 10,
    unitOfMeasure: "PCS",
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

  // A saved picture has a full web address the user can copy. A new upload gets its address when the item is saved.
  const pendingImage = Boolean(formData.image && formData.image.startsWith("data:"));
  const savedImageUrl =
    formData.image && !pendingImage && isWebAddress(formData.image)
      ? new URL(formData.image.trim(), window.location.origin).href
      : "";

  const previewUrl = uploadingImage ? "" : pendingImage ? formData.image ?? "" : savedImageUrl;

  const copyImageUrl = async () => {
    try {
      await navigator.clipboard.writeText(savedImageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the link. Select the address and copy it by hand.");
    }
  };

  // Suggestions for each typed field are the values already saved on items.
  // A new value can always be typed; once an item with it is saved, it is suggested too.
  const descriptorOptions = useMemo(() => {
    const options = {} as Record<ItemDescriptorField, string[]>;
    for (const field of DESCRIPTOR_FIELDS) {
      const values = new Set<string>();
      for (const existing of existingItems) {
        const value = normalizeDescriptor(String(existing[field] ?? ""));
        if (value) values.add(value);
      }
      options[field] = Array.from(values).sort();
    }
    return options;
  }, [existingItems]);

  const setDescriptor = (field: ItemDescriptorField, value: string) => {
    setError(null);
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // The input for a typed field with suggestions. The label is rendered by the caller.
  const renderDescriptorField = (
    field: ItemDescriptorField,
    label: string,
    placeholder: string,
    isRequired = false,
  ) => (
    <>
      <Combobox
        id={`edit-${field}`}
        label={label}
        value={(formData[field] as string) || ""}
        onValueChange={(value) => setDescriptor(field, value)}
        options={descriptorOptions[field]}
        placeholder={placeholder}
        disabled={readOnly}
        invalid={isRequired && isMissing(field)}
        required={isRequired && !readOnly}
      />
      {isRequired && isMissing(field) && <span className="field-missing-text">Required</span>}
    </>
  );

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
        ? (field === "safetyStock" || field === "srp") && value === ""
          ? ""
          : parseFloat(value)
        : value,
    }));
  };

  const handleBarcodeScanned = (value: string) => {
    const barcode = value.trim();
    const duplicateBarcode = existingItems.some(
      (existingItem) =>
        existingItem.id !== item?.id &&
        (existingItem.barcode ?? "").trim() === barcode,
    );
    if (duplicateBarcode) {
       return false;
    }

    setFormData((prev) => ({
      ...prev,
      barcode,
    }));
    setIsScannerOpen(false);
    setError(null);
    return true;
  };

  const toggleScanner = () => setIsScannerOpen((prev) => !prev);
  const closeScanner = useCallback(() => setIsScannerOpen(false), []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    // Save the picture right away so the form gets its web address before the item is saved.
    setUploadingImage(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, imageFileName: file.name }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "The picture could not be uploaded.");
      setFormData((prev) => ({ ...prev, image: data.url }));
      setImageFileName(file.name);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The picture could not be uploaded.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (saving || uploadingImage) return;

    const id = (formData.id ?? "").trim();
    const name = (formData.name ?? "").trim();
    const category = normalizeDescriptor(formData.category ?? "");
    const barcode = (formData.barcode ?? "").trim();
    // Typed fields are stored in one style, even if Enter submitted before the field lost focus.
    const descriptors = Object.fromEntries(
      DESCRIPTOR_FIELDS.filter((field) => field !== "category").map((field) => [
        field,
        normalizeDescriptor(String(formData[field] ?? "")),
      ]),
    );

    const missingRequired = missingRequiredKeys(formData);
    if (missingRequired.length > 0) {
      setShowMissing(true);
      setError(`Please fill in: ${missingRequired.map((key) => REQUIRED_FIELD_LABELS[key]).join(", ")}.`);
      const firstMissing = missingRequired[0];
      document.getElementById(firstMissing === "image" ? "edit-image-url" : `edit-${String(firstMissing)}`)?.focus();
      return;
    }
    setShowMissing(false);

    // The barcode is optional. Only check for duplicates when one was entered.
    const duplicateBarcode =
      barcode !== "" &&
      existingItems.some(
        (existingItem) =>
          existingItem.id !== item?.id &&
          (existingItem.barcode ?? "").trim() === barcode,
      );
    if (duplicateBarcode) {
      setError("That barcode is already registered to another item.");
      return;
    }

    const picture = (formData.image ?? "").trim();
    if (picture && !picture.startsWith("data:") && !isWebAddress(picture)) {
      setError("The picture address must start with https:// or http://.");
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
      await onSave({ ...formData, ...descriptors, id, name, category, barcode } as Item);
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
    formData.rack && !rackLocations.includes(formData.rack),
  );

  // The floor the item is on: the one the user picked, otherwise the floor of its current rack.
  const floorOptions: [number, string][] = floors.length > 0
    ? floors.map((floor) => [floor.id, floor.name])
    : Array.from(new Map(rackFloors.map((rack) => [rack.floorId, rack.floorName])).entries());
  const currentFloorId =
    selectedFloorId ??
    rackFloors.find((rack) => rack.code === formData.rack)?.floorId ??
    floorOptions[0]?.[0] ??
    null;
  // Racks on the chosen floor. Without floor data, fall back to the flat rack list.
  const racksOnFloor = rackFloors.length > 0
    ? rackFloors.filter((rack) => rack.floorId === currentFloorId).map((rack) => rack.code)
    : rackLocations;

  const chooseFloor = (floorId: number) => {
    setSelectedFloorId(floorId);
    const racksHere = rackFloors.filter((rack) => rack.floorId === floorId).map((rack) => rack.code);
    // Keep the rack if it is already on this floor. Otherwise clear it, since a rack is optional.
    if (formData.rack && !racksHere.includes(formData.rack)) {
      setFormData((prev) => ({ ...prev, rack: '' }));
    }
  };

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

      <div className="item-form-grid">
        <div className="item-form-col">
          <h3 className="item-form-section-title">Item details</h3>
      <div className="form-group">
        <label className="label-micro">
          Item ID {!readOnly && <span className="text-accent">*</span>}
        </label>
        <input
          type="text"
          id="edit-id"
          className={`form-input font-mono ${isMissing("id") ? "is-missing" : ""}`}
          value={formData.id}
          onChange={handleChange}
          disabled={readOnly}
          aria-invalid={isMissing("id")}
          required
        />
        {isMissing("id") && <span className="field-missing-text">Required</span>}
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
            className={`form-input ${isMissing("name") ? "is-missing" : ""}`}
            value={formData.name}
            onChange={handleChange}
            disabled={readOnly}
            aria-invalid={isMissing("name")}
            required
          />
          {isMissing("name") && <span className="field-missing-text">Required</span>}
        </div>

{/* Barcode input and scanner */}
        <div className="form-group">
          <label className="label-micro">
            Barcode <span className="field-optional">optional</span>
          </label>

          <div className="flex-row-gap">
            <input
              type="text"
              id="edit-barcode"
              className="form-input"
              value={formData.barcode || ""}
              onChange={handleChange}
              disabled={readOnly}
              placeholder="Scan or type, or leave blank"
            />

            {!readOnly && (
              <button
                type="button"
                className={`item-barcode-scan-button ${isScannerOpen ? "active" : ""}`}
                onClick={toggleScanner}
                title="Scan barcode"
              >
                <i className={`bx ${isScannerOpen ? "bx-x" : "bx-barcode-reader"}`}></i>
              </button>
            )}
          </div>
        </div>

        {isScannerOpen && (
          <ScannerDialog onScanSuccess={handleBarcodeScanned} onClose={closeScanner} />
        )}

      </div>
      <div className="grid-3 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro">
            Category {!readOnly && <span className="text-accent">*</span>}
          </label>
          {renderDescriptorField("category", "Category", "Type or pick", true)}
        </div>
        <div className="form-group">
          <label className="label-micro">
            Brand
          </label>
          {renderDescriptorField("brand", "Brand", "")}
        </div>
        <div className="form-group">
          <label className="label-micro">
            Model
          </label>
          {renderDescriptorField("model", "Model", "")}
        </div>
        <div className="form-group">
          <label className="label-micro">
            Part no.
          </label>
          <input
            type="text"
            id="edit-partNumber"
            className="form-input"
            value={formData.partNumber || ""}
            onChange={handleChange}
            disabled={readOnly}
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label className="label-micro">
            Color
          </label>
          {renderDescriptorField("color", "Color", "")}
        </div>
        <div className="form-group">
          <label className="label-micro">
            Unit
          </label>
          {renderDescriptorField("unitOfMeasure", "Unit of measure", "")}
        </div>
      </div>
      <div className="form-group">
        <label className="label-micro">Compatible Vehicles</label>
        <input
          type="text"
          id="edit-compatibleVehicles"
          className={`form-input${missingClass("compatibleVehicles")}`}
          aria-invalid={isMissing("compatibleVehicles")}
          value={formData.compatibleVehicles || ""}
          onChange={handleChange}
          placeholder="e.g. Toyota Civic, Honda Altis"
          disabled={readOnly}
        />
        {isMissing("compatibleVehicles") && <span className="field-missing-text">Required</span>}
      </div>
      <div className="form-group picture-field">
        <div className="picture-field-head">
          <label className="label-micro" htmlFor="edit-image-url">
            Picture <span className="field-optional">optional</span>
          </label>
          <span className="picture-field-note">JPG, PNG, WebP or GIF, up to 5 MB</span>
        </div>
        <input
          type="file"
          id="edit-image-file"
          accept="image/*"
          onChange={handleImageUpload}
          disabled={readOnly}
          ref={imageInputRef}
          style={{ display: "none" }}
        />

        <div className="picture-field-body">
          <div className={`picture-preview ${previewUrl ? "" : "is-empty"}`}>
            {previewUrl ? (
              <img src={previewUrl} alt="Item picture preview" referrerPolicy="no-referrer" />
            ) : (
              <i className="bx bx-image-add" aria-hidden="true"></i>
            )}
          </div>

          <div className="picture-field-controls">
            <div className="picture-url-input">
              <i className="bx bx-link" aria-hidden="true"></i>
              <input
                id="edit-image-url"
                type="text"
                value={
                  uploadingImage
                    ? "Uploading picture…"
                    : pendingImage
                      ? `${imageFileName || "Picture"} (choose it again for a link)`
                      : formData.image ?? ""
                }
                placeholder="Paste a picture link, or upload a file"
                disabled={readOnly || uploadingImage}
                readOnly={pendingImage}
                onChange={(event) => {
                  setFormData((prev) => ({ ...prev, image: event.target.value }));
                  setError(null);
                }}
              />
              {formData.image && !readOnly && !uploadingImage && (
                <button
                  type="button"
                  className="inv-icon-btn"
                  aria-label="Remove picture"
                  title="Remove picture"
                  onClick={() => setFormData((prev) => ({ ...prev, image: "" }))}
                >
                  <i className="bx bx-x" aria-hidden="true"></i>
                </button>
              )}
            </div>

            <div className="picture-actions">
              <button
                type="button"
                className="picture-action"
                onClick={() => imageInputRef.current?.click()}
                disabled={readOnly || uploadingImage}
              >
                <i className="bx bx-upload" aria-hidden="true"></i>
                Upload file
              </button>
              {savedImageUrl && (
                <button type="button" className="picture-action" onClick={copyImageUrl}>
                  <i className={`bx ${copied ? "bx-check" : "bx-copy"}`} aria-hidden="true"></i>
                  {copied ? "Copied" : "Copy link"}
                </button>
              )}
              {savedImageUrl && (
                <a className="picture-action" href={savedImageUrl} target="_blank" rel="noreferrer">
                  <i className="bx bx-link-external" aria-hidden="true"></i>
                  Open
                </a>
              )}
            </div>

            {pendingImage && (
              <span className="image-url-hint">This picture is in an older format. Upload it again to get a link.</span>
            )}
          </div>
        </div>
      </div>
        </div>
        <div className="item-form-col">
          <h3 className="item-form-section-title">Stock and location</h3>
      <div className="grid-2 border-soft-no-pad p-0" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1.15fr)' }}>
        <div className="form-group">
          <label className="label-micro" htmlFor="edit-floor">Floor</label>
          <select
            id="edit-floor"
            className="form-input"
            value={currentFloorId ?? ""}
            onChange={(event) => chooseFloor(Number(event.target.value))}
            disabled={readOnly || floorOptions.length === 0}
          >
            {floorOptions.map(([floorId, floorName]) => (
              <option key={floorId} value={floorId}>{floorName}</option>
            ))}
          </select>
        </div>

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
            {racksOnFloor.length === 0 && (
              <option value="" disabled>No racks on this floor yet</option>
            )}
            {racksOnFloor.map((rack) => (
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
            className={`form-input font-mono${missingClass("quantity")}`}
            aria-invalid={isMissing("quantity")}
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
            className={`form-input font-mono${missingClass("price")}`}
            aria-invalid={isMissing("price")}
            value={formData.price}
            onChange={handleChange}
            min="0"
            step="0.01"
            disabled={readOnly}
            required
          />
        </div>
      </div>
      <div className="grid-2 border-soft-no-pad p-0">
        <div className="form-group">
          <label className="label-micro" htmlFor="edit-srp">
            SRP (₱) <span className="field-optional">optional</span>
          </label>
          <input
            type="number"
            id="edit-srp"
            className="form-input font-mono"
            value={formData.srp ?? ""}
            onChange={handleChange}
            min="0"
            step="0.01"
            placeholder="0.00"
            disabled={readOnly}
          />
        </div>

        <div className="form-group">
          <label className="label-micro">
            Supplier <span className="field-optional">optional</span>
          </label>
          {renderDescriptorField("supplier", "Supplier", "Type or pick")}
        </div>
      </div>
      <div className="grid-2 border-soft-no-pad p-0">
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
              className={`form-input font-mono${missingClass("orderingCost")}`}
              aria-invalid={isMissing("orderingCost")}
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
              className={`form-input font-mono${missingClass("holdingCost")}`}
              aria-invalid={isMissing("holdingCost")}
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
              className={`form-input font-mono${missingClass("leadTimeDays")}`}
              aria-invalid={isMissing("leadTimeDays")}
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
              className={`form-input font-mono${missingClass("safetyStock")}`}
              aria-invalid={isMissing("safetyStock")}
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
        </div>
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
              disabled={saving || uploadingImage}
            >
              {saving ? "Saving..." : "Save Item"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
