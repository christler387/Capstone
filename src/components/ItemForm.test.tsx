import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemForm } from "./ItemForm";

describe("ItemForm", () => {
  it("allows a category to be entered as free text", () => {
    const { container } = render(
      <ItemForm onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const categoryInput = container.querySelector(
      "#edit-category",
    ) as HTMLInputElement;

    expect(categoryInput.tagName).toBe("INPUT");
    fireEvent.change(categoryInput, { target: { value: "accessories" } });
    expect(categoryInput).toHaveValue("ACCESSORIES");
  });

  it("allows safety stock to be cleared and replaced while editing", () => {
    const { container } = render(
      <ItemForm onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const safetyStockInput = container.querySelector(
      "#edit-safetyStock",
    ) as HTMLInputElement;

    fireEvent.change(safetyStockInput, { target: { value: "" } });
    expect(safetyStockInput).toHaveValue(null);

    fireEvent.change(safetyStockInput, { target: { value: "1" } });
    expect(safetyStockInput).toHaveValue(1);
  });

  it("offers warehouse rack locations in a dropdown", () => {
    const { container } = render(
      <ItemForm onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const rackSelect = container.querySelector(
      "#edit-rack",
    ) as HTMLSelectElement;

    expect(rackSelect.tagName).toBe("SELECT");
    expect(rackSelect).toHaveDisplayValue("Select a rack");
    expect(rackSelect.options).toHaveLength(37);
    expect(rackSelect.querySelector('option[value="A-01"]')).not.toBeNull();
    expect(rackSelect.querySelector('option[value="L-03"]')).not.toBeNull();

    fireEvent.change(rackSelect, { target: { value: "A-01" } });
    expect(rackSelect).toHaveValue("A-01");
  });

  it("keeps an existing rack value that is not a standard warehouse slot", () => {
    const { container } = render(
      <ItemForm
        item={{ rack: "A1" }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const rackSelect = container.querySelector(
      "#edit-rack",
    ) as HTMLSelectElement;

    expect(rackSelect).toHaveValue("A1");
    expect(rackSelect.querySelector('option[value="A1"]')).toHaveTextContent(
      "A1 (current)",
    );
  });
});
