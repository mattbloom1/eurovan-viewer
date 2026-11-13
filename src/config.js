// Static configuration: palettes, presets and defaults.

export const PAINTS = [
  { id: 'reflex-silver', name: 'Reflex Silver', hex: '#b9bdc0', finish: 'metallic' },
  { id: 'candy-white', name: 'Candy White', hex: '#efefea', finish: 'gloss' },
  { id: 'black-magic', name: 'Black Magic Pearl', hex: '#141416', finish: 'metallic' },
  { id: 'racing-green', name: 'Racing Green', hex: '#1d3a2a', finish: 'metallic' },
  { id: 'bamboo-green', name: 'Bamboo Green', hex: '#6f7d58', finish: 'metallic' },
  { id: 'indigo-blue', name: 'Indigo Blue', hex: '#1f2b4a', finish: 'metallic' },
  { id: 'jazz-blue', name: 'Jazz Blue', hex: '#2f4f86', finish: 'metallic' },
  { id: 'colorado-red', name: 'Colorado Red', hex: '#7a1d1f', finish: 'metallic' },
  { id: 'mojave-beige', name: 'Mojave Beige', hex: '#b9a888', finish: 'metallic' },
  { id: 'wheat-beige', name: 'Wheat Beige', hex: '#d6c7a2', finish: 'gloss' },
];

export const PAINT_FINISHES = {
  metallic: { label: 'Metallic', metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06 },
  gloss: { label: 'Solid gloss', metalness: 0.0, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.05 },
  matte: { label: 'Matte', metalness: 0.0, roughness: 0.78, clearcoat: 0.0, clearcoatRoughness: 0.5 },
};

// Woods: colours in sRGB hex. `lines` = grain lines per texture tile, `tile` = metres per texture tile.
export const WOODS = [
  { id: 'birch', name: 'Baltic birch', base: '#e4d1aa', dark: '#c4a375', lines: 22, warp: 0.35, contrast: 0.32, rough: 0.62, edge: ['#ecdcb8', '#b4925f'], ply: true },
  { id: 'oak', name: 'White oak', base: '#c99f68', dark: '#8f6638', lines: 14, warp: 0.65, contrast: 0.6, fleck: true, rough: 0.55, edge: ['#d9b57f', '#8f6638'], ply: true },
  { id: 'walnut', name: 'Walnut', base: '#6e4b33', dark: '#3a2617', lines: 16, warp: 0.55, contrast: 0.65, rough: 0.5, edge: ['#8a6446', '#3a2617'], ply: true },
  { id: 'bamboo', name: 'Bamboo', base: '#d9b77b', dark: '#a8814b', lines: 44, warp: 0.08, contrast: 0.35, nodes: true, rough: 0.5, edge: ['#e2c48d', '#a8814b'], ply: true },
  { id: 'white', name: 'White laminate', base: '#eeece6', dark: '#e2dfd7', lines: 6, warp: 0.2, contrast: 0.06, rough: 0.42, edge: ['#e8e6e0', '#e8e6e0'], ply: false },
  { id: 'charcoal', name: 'Charcoal laminate', base: '#3e4042', dark: '#303234', lines: 6, warp: 0.2, contrast: 0.12, rough: 0.45, edge: ['#36383a', '#36383a'], ply: false },
];

export const DOOR_COLORS = [
  { id: 'forest', name: 'Forest green', hex: '#2f4a37' },
  { id: 'sage', name: 'Sage', hex: '#9aab8a' },
  { id: 'navy', name: 'Navy', hex: '#24324b' },
  { id: 'cream', name: 'Cream', hex: '#ece2c9' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3a3d3f' },
  { id: 'terracotta', name: 'Terracotta', hex: '#b7633f' },
  { id: 'wood', name: 'Natural wood', hex: null },
];

// Upholstery palettes: roles map onto the BO_* soft-goods materials.
export const UPHOLSTERY = [
  { id: 'default', name: 'Original', charcoal: '#3b3b3e', mustard: '#c39a32', rust: '#a3482a', linen: '#e8e0cc', duvet: '#d8ccb2', felt: '#8a8783', stripe: ['#e8e0cc', '#a3482a', '#3b3b3e', '#c39a32'] },
  { id: 'desert', name: 'Desert', charcoal: '#8c6c50', mustard: '#d9b179', rust: '#c0693b', linen: '#f0e5cf', duvet: '#e3d2b3', felt: '#b6a285', stripe: ['#f0e5cf', '#c0693b', '#8c6c50', '#d9b179'] },
  { id: 'forest', name: 'Forest', charcoal: '#2e3d33', mustard: '#7f8f4e', rust: '#8a5a34', linen: '#e4e0cf', duvet: '#cdd2bb', felt: '#5d6b5a', stripe: ['#e4e0cf', '#2e3d33', '#7f8f4e', '#8a5a34'] },
  { id: 'coastal', name: 'Coastal blue', charcoal: '#2b3d55', mustard: '#6f97b3', rust: '#d6a35a', linen: '#ece8dd', duvet: '#d6dde0', felt: '#98a6af', stripe: ['#ece8dd', '#2b3d55', '#6f97b3', '#d6a35a'] },
  { id: 'mono', name: 'Monochrome', charcoal: '#2e2e30', mustard: '#8a8a8a', rust: '#555557', linen: '#e6e6e3', duvet: '#d3d3cf', felt: '#77777a', stripe: ['#e6e6e3', '#2e2e30', '#8a8a8a', '#555557'] },
];

export const SEAT_COLORS = [
  { id: 'orig', name: 'Factory grey', hex: '#5b5e64' },
  { id: 'black', name: 'Black', hex: '#2a2a2c' },
  { id: 'tan', name: 'Tan', hex: '#8b745a' },
  { id: 'blue', name: 'Blue', hex: '#3a465d' },
  { id: 'match', name: 'Match upholstery', hex: null },
];

export const FLOORS = [
  { id: 'oak', name: 'Oak plank', kind: 'plank', base: '#b98b58', dark: '#8a6238', vary: 0.1 },
  { id: 'grey', name: 'Grey plank', kind: 'plank', base: '#a29d94', dark: '#7d786f', vary: 0.07 },
  { id: 'walnut', name: 'Dark walnut', kind: 'plank', base: '#5c3e2b', dark: '#36241a', vary: 0.1 },
  { id: 'checker', name: 'Checker vinyl', kind: 'checker', a: '#ebe7de', b: '#202022' },
];

export const BUILDOUT_NAMES = {
  BO_Kitchen_Desk: 'Kitchen & desk',
  BO_Swivel_Seat_Table: 'Swivel seat & table',
  BO_Closet: 'Closet',
  BO_Electrics: 'Electrics',
  BO_Bed_Base: 'Bed base',
  BO_Bed_SeatMode: 'Bed (seat mode)',
  BO_Bed_FlatMode: 'Bed (flat mode)',
  BO_Gear_Garage: 'Gear garage',
  BO_Overhead_Lockers_Lighting: 'Overhead lockers & lighting',
  BO_PopTop_Solar_Fan: 'Pop-top solar & fan',
  BO_Finishes_Safety: 'Finishes & safety',
  BO_Props: 'Props',
  BO_Plan_Labels: 'Plan labels',
  BO_Monitor_Travel: 'Monitor (travel)',
  BO_Rear_Closet: 'Rear closet',
  BO_Electrical_Cables: 'Electrical cables',
  BO_Concept_R3L: 'Concept: R3L',
  BO_Concept_DI: 'Concept: DI',
  BO_Fasteners: 'Fasteners',
  BO_Hitch_Carrier: 'Hitch cargo tray',
};
// Collections hidden by default (clutter): matched against the node name.
export const BUILDOUT_DEFAULT_OFF = [/Plan_Labels/i];

// Fallback pivot definitions used when the manifest is missing or incomplete.
const D = Math.PI / 180;
export const PIVOT_DEFAULTS = {
  Door_L_Pivot: { type: 'hinge', axis: [0, 1, 0], open: -65 * D, label: 'Driver door' },
  Door_R_Pivot: { type: 'hinge', axis: [0, 1, 0], open: 65 * D, label: 'Passenger door' },
  Slider_Pivot: { type: 'slide', axis: [0, 0, -1], open: 0.95, out: [-1, 0, 0], out_dist: 0.12, label: 'Sliding door' },
  Tailgate_Pivot: { type: 'hinge', axis: [1, 0, 0], open: 85 * D, label: 'Tailgate' },
  PopTop_Pivot: { type: 'hinge', axis: [1, 0, 0], open: -28 * D, label: 'Pop-top' },
};

export const DEFAULTS = {
  paint: '#b9bdc0',
  finish: 'metallic',
  wood: 'birch',
  door: 'forest',
  doorHex: '#2f4a37',
  uph: 'default',
  seat: 'orig',
  seatHex: '#5b5e64',
  floor: 'oak',
  buildout: true,
  interior: true,
  xray: false,
  hidden: [], // buildout collections switched off
  hour: 14,
  headlights: false,
  cabin: true,
};
