import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WarehouseMap } from "./WarehouseMap";

describe("WarehouseMap", () => {
  it("optimizes uncategorized items into the Misc aisles, including high-demand items", async () => {
    const onBulkUpdate = vi.fn();
    const inventory = [
      {
        id: "001",
        name: "Uncategorized part",
        category: "",
        rack: "A-01",
        quantity: 1,
        price: 10,
        demand: "HIGH" as const,
      },
      {
        id: "002",
        name: "Custom category part",
        category: "Accessories",
        rack: "A-02",
        quantity: 1,
        price: 10,
        demand: "HIGH" as const,
      },
    ];
    render(
      <WarehouseMap
        inventory={inventory}
        movements={[]}
        onEditItem={vi.fn()}
        onAddItem={vi.fn()}
        onBulkUpdate={onBulkUpdate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /analyze & optimize layout/i }),
    );

    expect(await screen.findByText("L-02")).toBeInTheDocument();
    expect(screen.getByText("K-03")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /apply relocations \(2\)/i }),
    );

    expect(onBulkUpdate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "001", rack: "L-02" }),
        expect.objectContaining({ id: "002", rack: "K-03" }),
      ]),
    );
  });
});
