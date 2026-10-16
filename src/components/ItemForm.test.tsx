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
});
