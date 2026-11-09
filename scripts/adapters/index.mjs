import * as chinesebqb from './chinesebqb.mjs';

/** Only adapters listed here AND marked approved in config/collect-sources.json will run. */
export const ADAPTERS = {
  [chinesebqb.id]: chinesebqb,
};

export function getAdapter(id) {
  return ADAPTERS[id] || null;
}

export function listAdapterIds() {
  return Object.keys(ADAPTERS);
}
