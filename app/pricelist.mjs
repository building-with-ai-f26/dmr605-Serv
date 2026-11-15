// The set price list: the 20 commonest small repairs, each at one fixed price.
// The owner never sees a quote. Serv matches the tenant's problem to one of these lines.
// Prices are placeholders for the sprint (Nov 16 to Dec 13) and are set by hand, never by the AI.

export const TRADES = ['plumbing', 'electrical', 'heating', 'handyman'];

export const PRICE_LIST = [
  { id: 'faucet-leak', trade: 'plumbing', priceUsd: 145, label: 'Fix a dripping or leaking faucet' },
  { id: 'toilet-running', trade: 'plumbing', priceUsd: 135, label: 'Fix a running toilet (fill valve or flapper)' },
  { id: 'toilet-clog', trade: 'plumbing', priceUsd: 150, label: 'Clear a clogged toilet' },
  { id: 'drain-clog', trade: 'plumbing', priceUsd: 165, label: 'Clear a clogged sink or tub drain' },
  { id: 'sink-leak', trade: 'plumbing', priceUsd: 160, label: 'Fix a leak under a sink (trap or supply line)' },
  { id: 'showerhead', trade: 'plumbing', priceUsd: 110, label: 'Replace a showerhead or tub spout' },
  { id: 'no-hot-water', trade: 'plumbing', priceUsd: 175, label: 'Find out why there is no hot water (water heater visit)' },
  { id: 'radiator', trade: 'heating', priceUsd: 140, label: 'Fix a cold, leaking or banging radiator (valve or bleed)' },
  { id: 'outlet-switch', trade: 'electrical', priceUsd: 150, label: 'Replace a dead outlet or light switch' },
  { id: 'gfci', trade: 'electrical', priceUsd: 165, label: 'Install or replace a GFCI outlet (kitchen or bath)' },
  { id: 'light-fixture', trade: 'electrical', priceUsd: 175, label: 'Replace a light fixture' },
  { id: 'breaker-trip', trade: 'electrical', priceUsd: 185, label: 'Find out why a breaker keeps tripping' },
  { id: 'buzzer', trade: 'electrical', priceUsd: 160, label: 'Fix a doorbell or buzzer' },
  { id: 'smoke-co', trade: 'handyman', priceUsd: 120, label: 'Install or replace smoke and CO detectors (up to 3)' },
  { id: 'door-lock', trade: 'handyman', priceUsd: 160, label: 'Replace or rekey a door lock' },
  { id: 'door-stick', trade: 'handyman', priceUsd: 120, label: 'Fix a sticking door or loose hinge' },
  { id: 'drywall-patch', trade: 'handyman', priceUsd: 180, label: 'Patch a hole in a wall (up to 1 square foot)' },
  { id: 'caulk', trade: 'handyman', priceUsd: 150, label: 'Re-caulk a tub or shower' },
  { id: 'window-stuck', trade: 'handyman', priceUsd: 170, label: 'Fix a stuck window or broken sash cord' },
  { id: 'cabinet', trade: 'handyman', priceUsd: 110, label: 'Fix a cabinet door or drawer' },
];

export function findPriceItem(id) {
  return PRICE_LIST.find((item) => item.id === id) ?? null;
}
