import { Item, Movement } from './types';

const DEFAULT_ORDERING_COST = 100;
const DEFAULT_HOLDING_RATE = 0.2;
const DEFAULT_LEAD_TIME_DAYS = 7;

export function getAnnualDemand(item: Item, movements: Movement[]): number {
  const itemMovements = movements.filter(m => m.itemId === item.id && m.type === 'OUT');
  if (itemMovements.length === 0) return 0;
  const dates = itemMovements.map(m => new Date(m.date).getTime()).filter(Number.isFinite);
  const spanDays = dates.length > 1
    ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / 86400000)
    : 365;
  const totalOut = itemMovements.reduce((sum, movement) => sum + movement.qty, 0);
  return totalOut * 365 / spanDays;
}

export function getEoq(item: Item, movements: Movement[]): number {
  const annualDemand = getAnnualDemand(item, movements);
  const orderingCost = item.orderingCost ?? DEFAULT_ORDERING_COST;
  const holdingCost = item.holdingCost && item.holdingCost > 0
    ? item.holdingCost
    : item.price * DEFAULT_HOLDING_RATE;
  if (annualDemand <= 0 || orderingCost <= 0 || holdingCost <= 0) return 0;
  return Math.sqrt((2 * annualDemand * orderingCost) / holdingCost);
}

export function getAverageMonthlyDemand(item: Item, movements: Movement[]): number {
  return getAnnualDemand(item, movements) / 12;
}

export function getRop(item: Item, movements: Movement[]): number {
  const monthlyDemand = getAverageMonthlyDemand(item, movements);
  const leadTimeDays = item.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const leadTimeMonths = leadTimeDays / 30;
  return monthlyDemand * leadTimeMonths + (item.safetyStock ?? 0);
}

export function isAtReorderPoint(item: Item, movements: Movement[]): boolean {
  return item.quantity < getRop(item, movements);
}

export function getReorderQuantity(item: Item, movements: Movement[]): number {
  return Math.max(0, Math.ceil(getRop(item, movements) - item.quantity));
}