export type ItemCategory = 'tool' | 'material' | 'food' | 'plant' | 'misc';

export interface ItemDef {
  name: string;
  category: ItemCategory;
  /** Weight in kilograms per unit. */
  weight: number;
  stackable?: boolean;
  /** Restores this much hunger (0..1) when eaten. */
  food?: number;
  /** Restores this much thirst (0..1) per drink. */
  drink?: number;
  /** Container capacity in drinks; the item carries `charges` of them. */
  charges?: number;
  /** Damage taken per real hour while lying on the ground; defaults by category. */
  decay?: number;
  description?: string;
}

/** Ground decay per hour by category: food rots in about half an hour, tools last most of a day. */
const CATEGORY_DECAY: Record<ItemCategory, number> = { food: 200, plant: 100, material: 25, tool: 12, misc: 12 };

export const ITEM_DEFS: Record<string, ItemDef> = {
  shovel: { name: 'Shovel', category: 'tool', weight: 3, description: 'A shovel for digging, flattening and packing dirt.' },
  pickaxe: { name: 'Pickaxe', category: 'tool', weight: 4, description: 'A pickaxe for mining rock.' },
  hatchet: { name: 'Hatchet', category: 'tool', weight: 2, description: 'A small axe for felling trees.' },
  carving_knife: { name: 'Carving knife', category: 'tool', weight: 0.5, description: 'A knife for carving wood.' },
  chisel: { name: 'Stone chisel', category: 'tool', weight: 1, description: 'A chisel for shaping stone.' },
  mallet: { name: 'Mallet', category: 'tool', weight: 1.5, description: 'Plans buildings and drives wooden walls together.' },
  trowel: { name: 'Trowel', category: 'tool', weight: 1, description: 'Lays bricks, mortar and stone floors.' },
  saw: { name: 'Saw', category: 'tool', weight: 1.5, description: 'Cuts logs into planks and timbers.' },
  rake: { name: 'Rake', category: 'tool', weight: 1.5, description: 'Tills grass and dirt into a field, ready for sowing.' },
  butchering_knife: { name: 'Butchering knife', category: 'tool', weight: 1, description: 'A broad blade for butchering corpses. Yields more from a carcass than bare hands.' },
  clay_bowl: { name: 'Clay bowl', category: 'tool', weight: 0.6, description: 'A fired bowl. Stews and compotes are cooked in it over a campfire.' },
  deed_stake: { name: 'Deed stake', category: 'misc', weight: 1, decay: 4, description: 'A shaft whittled to a point and notched for a claim. Plant it to found a settlement where you stand: 11 by 11 tiles around a token. You may hold one deed at a time.' },
  crate_log: { name: 'Log crate', category: 'misc', weight: 30, decay: 6, description: 'A rough crate that holds 30 things. Place it on any spot of a tile.' },
  crate_plank: { name: 'Plank crate', category: 'misc', weight: 15, decay: 6, description: 'A neat crate that holds 60 things. Place it on any spot of a tile.' },
  water_skin: { name: 'Water skin', category: 'misc', weight: 0.5, drink: 0.35, charges: 5, description: 'Holds water for the road. Fill it at any shore.' },
  dirt: { name: 'Dirt', category: 'material', weight: 20, stackable: true, description: 'A pile of dirt. Drop it to raise the ground.' },
  sand: { name: 'Sand', category: 'material', weight: 20, stackable: true },
  clay: { name: 'Clay', category: 'material', weight: 2, stackable: true },
  peat: { name: 'Peat', category: 'material', weight: 2, stackable: true },
  tar: { name: 'Tar', category: 'material', weight: 2, stackable: true },
  rock_shards: { name: 'Rock shards', category: 'material', weight: 20, stackable: true, decay: 5, description: 'Chunks of rock. Paves gravel, builds cobblestone walls or becomes bricks.' },
  slate_shards: { name: 'Slate shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  marble_shards: { name: 'Marble shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  sandstone_shards: { name: 'Sandstone shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  stone_brick: { name: 'Stone brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  slate_brick: { name: 'Slate brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  marble_brick: { name: 'Marble brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  sandstone_brick: { name: 'Sandstone brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  clay_brick: { name: 'Clay brick', category: 'material', weight: 3, stackable: true, decay: 6 },
  adobe: { name: 'Adobe', category: 'material', weight: 3, stackable: true, decay: 10, description: 'Clay and grass pressed into a block.' },
  mortar: { name: 'Mortar', category: 'material', weight: 2, stackable: true, decay: 40 },
  silver_lump: { name: 'Silver lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  gold_lump: { name: 'Gold lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  log: { name: 'Log', category: 'material', weight: 24, stackable: true, decay: 18 },
  plank: { name: 'Plank', category: 'material', weight: 2, stackable: true, decay: 20 },
  timber: { name: 'Timber', category: 'material', weight: 6, stackable: true, decay: 18 },
  fur: { name: 'Fur', category: 'material', weight: 1, stackable: true, decay: 16, description: 'A soft pelt taken from a butchered wildermon.' },
  leather: { name: 'Leather', category: 'material', weight: 1.5, stackable: true, decay: 12, description: 'Hide cured enough to work with.' },
  bone: { name: 'Bone', category: 'material', weight: 1, stackable: true, decay: 8 },
  gland: { name: 'Gland', category: 'material', weight: 0.2, stackable: true, decay: 90, description: 'A small scent gland. Rare, and prized by alchemists.' },
  shaft: { name: 'Shaft', category: 'material', weight: 1, stackable: true, decay: 20, description: 'A straight length of wood, carved from a log. Handles for tools and rails for fences.' },
  thatch: { name: 'Thatch', category: 'material', weight: 0.5, stackable: true, decay: 60 },
  sprout: { name: 'Sprout', category: 'plant', weight: 0.1, stackable: true, decay: 160, description: 'Plant it on grass or dirt to grow a tree. Wilts quickly if left lying around.' },
  blueberry: { name: 'Blueberries', category: 'food', weight: 0.1, stackable: true, food: 0.08 },
  raspberry: { name: 'Raspberries', category: 'food', weight: 0.1, stackable: true, food: 0.08 },
  strawberry: { name: 'Strawberries', category: 'food', weight: 0.1, stackable: true, food: 0.08 },
  lingonberry: { name: 'Lingonberries', category: 'food', weight: 0.1, stackable: true, food: 0.06 },
  acorn: { name: 'Acorn', category: 'food', weight: 0.05, stackable: true, food: 0.02 },
  nuts: { name: 'Nuts', category: 'food', weight: 0.1, stackable: true, food: 0.05 },
  meat: { name: 'Meat', category: 'food', weight: 0.5, stackable: true, food: 0.18, decay: 160, description: 'Raw meat from a butchered wildermon. Cook it at a campfire and it feeds you twice over.' },
  cooked_meat: { name: 'Cooked meat', category: 'food', weight: 0.4, stackable: true, food: 0.35, decay: 90 },
  baked_potato: { name: 'Baked potato', category: 'food', weight: 0.2, stackable: true, food: 0.22, decay: 90 },
  roast_onion: { name: 'Roast onion', category: 'food', weight: 0.15, stackable: true, food: 0.16, decay: 90 },
  roast_nuts: { name: 'Roasted nuts', category: 'food', weight: 0.1, stackable: true, food: 0.12, decay: 40 },
  berry_compote: { name: 'Berry compote', category: 'food', weight: 0.3, stackable: true, food: 0.3, decay: 60, description: 'Berries stewed down in a bowl over a fire.' },
  stew: { name: 'Stew', category: 'food', weight: 0.6, stackable: true, food: 0.75, decay: 70, description: 'Meat and vegetables simmered together. The best meal a campfire can make.' },
  mixed_grass: { name: 'Mixed grass', category: 'material', weight: 0.1, stackable: true, decay: 120 },
  sage: { name: 'Sage', category: 'plant', weight: 0.05, stackable: true, food: 0.01 },
  basil: { name: 'Basil', category: 'plant', weight: 0.05, stackable: true, food: 0.01 },
  thyme: { name: 'Thyme', category: 'plant', weight: 0.05, stackable: true, food: 0.01 },
  mint: { name: 'Mint', category: 'plant', weight: 0.05, stackable: true, food: 0.01 },
  rosemary: { name: 'Rosemary', category: 'plant', weight: 0.05, stackable: true, food: 0.01 },
  // Crop seeds, gathered in the wild and sown on a tilled field.
  onion_seed: { name: 'Onion seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  carrot_seed: { name: 'Carrot seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  cabbage_seed: { name: 'Cabbage seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  potato_seed: { name: 'Seed potatoes', category: 'plant', weight: 0.1, stackable: true, decay: 40 },
  wheat_seed: { name: 'Wheat seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  corn_seed: { name: 'Corn seeds', category: 'plant', weight: 0.03, stackable: true, decay: 40 },
  sage_seed: { name: 'Sage seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  basil_seed: { name: 'Basil seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  thyme_seed: { name: 'Thyme seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  mint_seed: { name: 'Mint seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  rosemary_seed: { name: 'Rosemary seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  cotton_seed: { name: 'Cotton seeds', category: 'plant', weight: 0.05, stackable: true, decay: 40 },
  wemp_seed: { name: 'Wemp seeds', category: 'plant', weight: 0.05, stackable: true, decay: 40 },
  potato: { name: 'Potato', category: 'food', weight: 0.2, stackable: true, food: 0.1 },
  carrot: { name: 'Carrot', category: 'food', weight: 0.12, stackable: true, food: 0.08 },
  cabbage: { name: 'Cabbage', category: 'food', weight: 0.4, stackable: true, food: 0.12 },
  wheat: { name: 'Wheat', category: 'food', weight: 0.1, stackable: true, food: 0.05 },
  corn: { name: 'Corn', category: 'food', weight: 0.2, stackable: true, food: 0.11 },
  cotton: { name: 'Cotton', category: 'material', weight: 0.1, stackable: true, decay: 30 },
  wemp: { name: 'Wemp fibre', category: 'material', weight: 0.1, stackable: true, decay: 30 },
  onion: { name: 'Onion', category: 'food', weight: 0.15, stackable: true, food: 0.06 },
  corpse: { name: 'Corpse', category: 'misc', weight: 12, decay: 90, description: 'A dead wildermon. Butcher it for meat, fur, leather, bones and glands before it rots.' },
};

export interface Item {
  uid: number;
  id: string;
  ql: number;
  dmg: number;
  count: number;
  /** Free text qualifier such as a wood or tree species. */
  extra?: string;
  /** Remaining drinks in a container. */
  charges?: number;
}

export function itemDef(id: string): ItemDef {
  return ITEM_DEFS[id] ?? { name: id, category: 'misc', weight: 1 };
}

/** Damage per real hour for an item lying on the ground; better quality holds up longer. */
export function groundDecayRate(item: Item): number {
  const def = itemDef(item.id);
  const base = def.decay ?? CATEGORY_DECAY[def.category];
  return base * Math.max(0.3, 1.4 - item.ql / 120);
}

export function itemName(item: Item): string {
  const def = itemDef(item.id);
  let name = item.extra ? `${def.name} (${item.extra.toLowerCase()})` : def.name;
  if (def.charges) name += ` (${item.charges ?? 0}/${def.charges})`;
  return name;
}

export class Inventory {
  items: Item[] = [];
  onChange?: () => void;
  /** Next item uid; shared with items lying on the ground so uids never collide. */
  nextUid = 1;

  constructor(items?: Item[], nextUid?: number) {
    if (items) {
      this.items = items;
      this.nextUid = Math.max(nextUid ?? 1, items.reduce((m, it) => Math.max(m, it.uid), 0) + 1);
    }
  }

  add(id: string, opts: { ql?: number; count?: number; extra?: string } = {}): Item {
    const def = itemDef(id);
    const count = opts.count ?? 1;
    const ql = Math.max(1, Math.min(100, opts.ql ?? 20));
    const item: Item = { uid: this.nextUid++, id, ql, dmg: 0, count, extra: opts.extra };
    if (def.charges) item.charges = def.charges;
    return this.addItem(item);
  }

  /** Put an existing item into the inventory, merging it into a matching stack. */
  addItem(item: Item): Item {
    const def = itemDef(item.id);
    if (item.uid >= this.nextUid) this.nextUid = item.uid + 1;
    if (def.stackable) {
      const existing = this.items.find((it) => it.id === item.id && it.extra === item.extra && it.uid !== item.uid);
      if (existing) {
        existing.ql = (existing.ql * existing.count + item.ql * item.count) / (existing.count + item.count);
        existing.count += item.count;
        this.onChange?.();
        return existing;
      }
    }
    this.items.push(item);
    this.onChange?.();
    return item;
  }

  /** Take `count` units out as a separate item (the whole item when it has no more than that). */
  take(uid: number, count = 1): Item | null {
    const idx = this.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return null;
    const item = this.items[idx];
    if (count >= item.count) {
      this.items.splice(idx, 1);
      this.onChange?.();
      return item;
    }
    item.count -= count;
    this.onChange?.();
    return { ...item, uid: this.nextUid++, count };
  }

  /** Removes `count` units of an item; returns false when there were not enough. */
  remove(uid: number, count = 1): boolean {
    const idx = this.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return false;
    const item = this.items[idx];
    if (item.count < count) return false;
    item.count -= count;
    if (item.count <= 0) this.items.splice(idx, 1);
    this.onChange?.();
    return true;
  }

  /** Consume `count` of the first matching item id (optionally with a specific extra). */
  consume(id: string, count = 1, extra?: string): boolean {
    const item = this.items.find((it) => it.id === id && (extra === undefined || it.extra === extra) && it.count >= count);
    if (!item) return false;
    return this.remove(item.uid, count);
  }

  find(id: string, extra?: string): Item | undefined {
    return this.items.find((it) => it.id === id && (extra === undefined || it.extra === extra));
  }

  get(uid: number): Item | undefined {
    return this.items.find((it) => it.uid === uid);
  }

  has(id: string): boolean {
    return this.items.some((it) => it.id === id);
  }

  count(id: string): number {
    return this.items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
  }

  /** Best quality tool of a kind, or undefined. */
  tool(id: string): Item | undefined {
    let best: Item | undefined;
    for (const it of this.items) if (it.id === id && (!best || it.ql > best.ql)) best = it;
    return best;
  }

  totalWeight(): number {
    return this.items.reduce((sum, it) => sum + itemDef(it.id).weight * it.count, 0);
  }
}
