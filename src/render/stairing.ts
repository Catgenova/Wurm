/**
 * What a flight of stairs is built as, in each material.
 *
 * A masonry stair is a solid flight: every step a block laid on the one
 * under it, its side the wall it is built of, cut to the steps, its treads
 * the stone the wall is dressed in, standing a nosing proud of the risers.
 * Brick is laid in two courses to a riser and trodden on stone; cobblestone
 * and slate and stone brick and sandstone on their own dressings; marble all
 * white; adobe in the coat, its edges rolled. A timber stair is carpentry:
 * sawn boards on cut strings for plank, oak on closed strings for
 * timbercraft, and split logs on two whole ones for log. The metals are a
 * stone flight clad in plate.
 *
 * Where a side of it stands open to the room, it is railed as its house
 * would rail it: iron on the plain masonries, a stone balustrade on marble,
 * gilt on the metals, a parapet of the coat on adobe, balusters on the
 * carpentry and a peeled pole on the logs.
 */
type RGB = readonly [number, number, number];

export interface StairStyle {
  /** How the flight is built: solid masonry, a cut string, a closed string, or logs. */
  build: 'solid' | 'string' | 'closed' | 'log';
  /** The top of a tread, the light along its nosing, and whether it stands a nosing proud of the riser. */
  tread: RGB;
  nose: RGB;
  proud: boolean;
  /** The face of a riser, the joints in it, and how it is laid: courses to a riser, and joints to a tile across. */
  riser: RGB;
  joint: RGB;
  courses: number;
  across: number;
  /** A tread's own joints to a tile across: where one slab or board of it ends and the next begins. */
  slabs: number;
  /** The strings of a timber stair: their face and the light along their top. */
  string: RGB;
  stringHi: RGB;
  /** The ink round everything. */
  line: RGB;
  /** How its open side is railed, and in what. */
  rail: 'iron' | 'stone' | 'gilt' | 'parapet' | 'wood' | 'pole';
  post: RGB;
  bar: RGB;
  barHi: RGB;
}

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;

const IRON = { rail: 'iron' as const, post: hex('#4d4b57'), bar: hex('#4d4b57'), barHi: hex('#7c7a88') };

const STAIRS: Record<string, StairStyle> = {
  cobblestone: {
    build: 'solid', tread: hex('#ded5c4'), nose: hex('#efe8dc'), proud: true,
    riser: hex('#cbc0b0'), joint: hex('#a39f90'), courses: 1, across: 3, slabs: 2,
    string: hex('#cbc0b0'), stringHi: hex('#ddd4c6'), line: hex('#94896c'), ...IRON,
  },
  clay_bricks: {
    build: 'solid', tread: hex('#9491a1'), nose: hex('#aba8b8'), proud: true,
    riser: hex('#c47c6e'), joint: hex('#8e6f67'), courses: 2, across: 4, slabs: 2,
    string: hex('#c47c6e'), stringHi: hex('#d09080'), line: hex('#7e4a44'), ...IRON,
  },
  stone_brick: {
    build: 'solid', tread: hex('#d8cfbc'), nose: hex('#e7e0d2'), proud: true,
    riser: hex('#aeb2c0'), joint: hex('#8c8e9c'), courses: 1, across: 2, slabs: 2,
    string: hex('#aeb2c0'), stringHi: hex('#c2c6d2'), line: hex('#6b6d7d'), ...IRON,
  },
  slate: {
    build: 'solid', tread: hex('#aeb0c4'), nose: hex('#c4c6d6'), proud: true,
    riser: hex('#4f5369'), joint: hex('#6a6c84'), courses: 2, across: 4, slabs: 2,
    string: hex('#4f5369'), stringHi: hex('#666a84'), line: hex('#34364a'), ...IRON,
  },
  sandstone: {
    build: 'solid', tread: hex('#ecd9be'), nose: hex('#f5ead8'), proud: true,
    riser: hex('#d6a494'), joint: hex('#b8917e'), courses: 1, across: 2, slabs: 2,
    string: hex('#e0c6a4'), stringHi: hex('#ecd9be'), line: hex('#9a7666'), ...IRON,
  },
  marble: {
    build: 'solid', tread: hex('#f1f3f5'), nose: hex('#ffffff'), proud: true,
    riser: hex('#e2e5e9'), joint: hex('#c3c7cd'), courses: 1, across: 1, slabs: 1,
    string: hex('#edeff1'), stringHi: hex('#f8f9fa'), line: hex('#9aa1ab'),
    rail: 'stone', post: hex('#eceef1'), bar: hex('#e2e5e9'), barHi: hex('#ffffff'),
  },
  clay_adobe: {
    build: 'solid', tread: hex('#e0d1b8'), nose: hex('#ebe0cc'), proud: false,
    riser: hex('#d0bb9f'), joint: hex('#bba286'), courses: 0, across: 0, slabs: 0,
    string: hex('#d0bb9f'), stringHi: hex('#e0d1b8'), line: hex('#8a6851'),
    rail: 'parapet', post: hex('#d0bb9f'), bar: hex('#d5c6ae'), barHi: hex('#e2d6c1'),
  },
  ornate_silver: {
    build: 'solid', tread: hex('#dfe2ea'), nose: hex('#eef1f6'), proud: true,
    riser: hex('#c6cad6'), joint: hex('#9da2b3'), courses: 1, across: 1, slabs: 1,
    string: hex('#c6cad6'), stringHi: hex('#dfe2ea'), line: hex('#626882'),
    rail: 'gilt', post: hex('#c4ccdc'), bar: hex('#c4ccdc'), barHi: hex('#eef1f6'),
  },
  ornate_gold: {
    build: 'solid', tread: hex('#ecd8a4'), nose: hex('#f6e8c0'), proud: true,
    riser: hex('#d9bf85'), joint: hex('#b2945c'), courses: 1, across: 1, slabs: 1,
    string: hex('#d9bf85'), stringHi: hex('#ecd8a4'), line: hex('#7d6440'),
    rail: 'gilt', post: hex('#e0c792'), bar: hex('#e0c792'), barHi: hex('#f6e8c0'),
  },
  plank: {
    build: 'string', tread: hex('#c9b395'), nose: hex('#dcc9ad'), proud: true,
    riser: hex('#b49e81'), joint: hex('#a18a6d'), courses: 0, across: 0, slabs: 2,
    string: hex('#8d7361'), stringHi: hex('#a78c78'), line: hex('#473935'),
    rail: 'wood', post: hex('#8d7361'), bar: hex('#a78c78'), barHi: hex('#c1a891'),
  },
  timbercraft: {
    build: 'closed', tread: hex('#a8896b'), nose: hex('#c4a687'), proud: true,
    riser: hex('#d7d1c1'), joint: hex('#bcb096'), courses: 0, across: 0, slabs: 1,
    string: hex('#725c52'), stringHi: hex('#8a7064'), line: hex('#42322f'),
    rail: 'wood', post: hex('#725c52'), bar: hex('#8a7064'), barHi: hex('#a38878'),
  },
  log: {
    build: 'log', tread: hex('#a58e78'), nose: hex('#c8ad8b'), proud: false,
    riser: hex('#6c5a57'), joint: hex('#a38a70'), courses: 0, across: 0, slabs: 0,
    string: hex('#98806c'), stringHi: hex('#b59e86'), line: hex('#473935'),
    rail: 'pole', post: hex('#98806c'), bar: hex('#a58e78'), barHi: hex('#c2a98f'),
  },
};

/** How a flight of `material` is built; anything without a style of its own is built as plank. */
export const stairStyle = (material: string): StairStyle => STAIRS[material] ?? STAIRS.plank;

/**
 * A ladder, which is planks whatever the house: sawn pine, its stiles a
 * step darker than its rungs, the light along the rounds of both.
 */
export const LADDER = {
  stile: hex('#b09474'),
  stileHi: hex('#d2bb9c'),
  rung: hex('#c4a886'),
  rungHi: hex('#e0ccb0'),
  line: hex('#5f4b3f'),
};
