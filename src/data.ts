import { Item, Movement } from './types';

export const SEED_DATA: Item[] = [
  { "id": "STK-001", "name": "Ceramic Brake Pads (Set)", "category": "BRAKES", "barcode": "4801234567890", "quantity": 25, "price": 2450.00, "rack": "A-01", "level": "L2", "size": "MEDIUM", "weight": "MEDIUM", "demand": "HIGH", "compatibleVehicles": "Toyota Vios 2014-2020, Honda City 2012-2019" },
  { "id": "STK-002", "name": "High Performance Rotors", "category": "BRAKES", "barcode": "4801234567891", "quantity": 12, "price": 4200.00, "rack": "B-04", "level": "L1", "size": "LARGE", "weight": "HEAVY", "demand": "MEDIUM", "compatibleVehicles": "Mitsubishi Lancer EX, Subaru WRX" },
  { "id": "STK-003", "name": "Synthetic Oil Filter", "category": "ENGINE", "barcode": "4801234567892", "quantity": 85, "price": 450.00, "rack": "A-02", "level": "L4", "size": "SMALL", "weight": "LIGHT", "demand": "HIGH", "compatibleVehicles": "Toyota Corolla Altis, Mitsubishi Mirage" },
  { "id": "STK-004", "name": "Iridium Spark Plugs", "category": "ENGINE", "barcode": "4801234567893", "quantity": 120, "price": 350.00, "rack": "A-03", "level": "L4", "size": "SMALL", "weight": "LIGHT", "demand": "HIGH", "compatibleVehicles": "Honda Civic, Suzuki Swift" },
  { "id": "STK-005", "name": "Gas-Charged Shock Absorber", "category": "SUSPENSION", "barcode": "4801234567894", "quantity": 18, "price": 3800.00, "rack": "B-02", "level": "L2", "size": "MEDIUM", "weight": "MEDIUM", "demand": "MEDIUM", "compatibleVehicles": "Hyundai Accent, Kia Rio" },
  { "id": "STK-006", "name": "Front Control Arm Left", "category": "SUSPENSION", "barcode": "4801234567895", "quantity": 6, "price": 5200.00, "rack": "B-01", "level": "L1", "size": "MEDIUM", "weight": "HEAVY", "demand": "LOW", "compatibleVehicles": "Nissan Almera, Mazda 3" },
  { "id": "STK-007", "name": "LED Headlight Bulb H4", "category": "ELECTRICAL", "barcode": "4801234567896", "quantity": 40, "price": 1200.00, "rack": "A-04", "level": "L3", "size": "SMALL", "weight": "LIGHT", "demand": "HIGH", "compatibleVehicles": "Universal H4 Sockets (Vios, Mirage, Wigo)" },
  { "id": "STK-008", "name": "120A High Output Alternator", "category": "ELECTRICAL", "barcode": "4801234567897", "quantity": 4, "price": 9500.00, "rack": "C-01", "level": "L1", "size": "MEDIUM", "weight": "HEAVY", "demand": "LOW", "compatibleVehicles": "Toyota Fortuner, Hilux D-4D" },
  { "id": "STK-009", "name": "Front Fender Panel", "category": "BODY", "barcode": "4801234567898", "quantity": 5, "price": 4500.00, "rack": "C-02", "level": "L3", "size": "LARGE", "weight": "MEDIUM", "demand": "LOW", "compatibleVehicles": "Honda Civic EF/EG/EK" },
  { "id": "STK-010", "name": "Rear Bumper Cover", "category": "BODY", "barcode": "4801234567899", "quantity": 3, "price": 6800.00, "rack": "D-03", "level": "L1", "size": "LARGE", "weight": "HEAVY", "demand": "LOW", "compatibleVehicles": "Toyota Wigo 2017-2022" },
  { "id": "STK-011", "name": "ATF Transmission Fluid", "category": "TRANSMISSION", "barcode": "4801234567900", "quantity": 60, "price": 850.00, "rack": "A-05", "level": "L2", "size": "MEDIUM", "weight": "MEDIUM", "demand": "HIGH", "compatibleVehicles": "Toyota, Honda, Mitsubishi Automatic Transmissions" },
  { "id": "STK-012", "name": "Heavy Duty Clutch Kit", "category": "TRANSMISSION", "barcode": "4801234567901", "quantity": 8, "price": 12500.00, "rack": "D-01", "level": "L1", "size": "LARGE", "weight": "HEAVY", "demand": "MEDIUM", "compatibleVehicles": "Mitsubishi Triton/L200, Isuzu D-Max" }
];

export const SEED_MOVEMENTS: Movement[] = [
  { id: 'MOV-1001', itemId: 'STK-004', type: 'OUT', qty: 45, date: '2026-08-10', timestamp: 1786358400000 },
  { id: 'MOV-1002', itemId: 'STK-003', type: 'OUT', qty: 35, date: '2026-08-11', timestamp: 1786444800000 },
  { id: 'MOV-1003', itemId: 'STK-001', type: 'OUT', qty: 28, date: '2026-08-12', timestamp: 1786531200000 },
  { id: 'MOV-1004', itemId: 'STK-011', type: 'OUT', qty: 25, date: '2026-08-12', timestamp: 1786532000000 },
  { id: 'MOV-1005', itemId: 'STK-007', type: 'OUT', qty: 20, date: '2026-08-13', timestamp: 1786617600000 },
  { id: 'MOV-1006', itemId: 'STK-004', type: 'OUT', qty: 20, date: '2026-08-13', timestamp: 1786618000000 },
  { id: 'MOV-1007', itemId: 'STK-005', type: 'OUT', qty: 10, date: '2026-08-13', timestamp: 1786620000000 },
  { id: 'MOV-1008', itemId: 'STK-002', type: 'OUT', qty: 8, date: '2026-08-14', timestamp: 1786704000000 },
  { id: 'MOV-1009', itemId: 'STK-012', type: 'OUT', qty: 6, date: '2026-08-14', timestamp: 1786705000000 },
  { id: 'MOV-1010', itemId: 'STK-006', type: 'OUT', qty: 1, date: '2026-08-14', timestamp: 1786706000000 },
  { id: 'MOV-1011', itemId: 'STK-009', type: 'OUT', qty: 1, date: '2026-08-14', timestamp: 1786707000000 }
];

