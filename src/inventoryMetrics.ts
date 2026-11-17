import { Item } from './types';

// Reorder figures come from the server, which works them out from the stock-out history in the database.
export interface ReorderMetric {
  totalOut: number;
  eoq: number;
  rop: number;
  reorderQty: number;
}

let metricsById = new Map<string, ReorderMetric>();

export function setReorderMetrics(list: Array<ReorderMetric & { id: string }>): void {
  metricsById = new Map(list.map(({ id, ...metric }) => [id, metric]));
}

export function getReorderMetric(item: Pick<Item, 'id'>): ReorderMetric | undefined {
  return metricsById.get(item.id);
}

// Local cost: the purchase cost (item.price) less the supplier discount in percent.
export function getLocalCost(item: { price?: number; discount?: number }): number {
  const discount = Math.min(100, Math.max(0, Number(item.discount) || 0));
  return (Number(item.price) || 0) * (1 - discount / 100);
}

// Total: quantity on hand times local cost. This is the stock value shown in the inventory.
export function getStockTotal(item: { price?: number; discount?: number; quantity?: number }): number {
  return getLocalCost(item) * (Number(item.quantity) || 0);
}

// Until the figures arrive, nothing is flagged for reorder.
export function getEoq(item: Item): number {
  return getReorderMetric(item)?.eoq ?? 0;
}

export function getRop(item: Item): number {
  return getReorderMetric(item)?.rop ?? 0;
}

export function isAtReorderPoint(item: Item): boolean {
  return item.quantity < getRop(item);
}

export function getReorderQuantity(item: Item): number {
  return getReorderMetric(item)?.reorderQty ?? 0;
}
