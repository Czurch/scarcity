# Scarcity — Game Design Document

You are the Director of a colony of Survivors. Collect Resources to keep your Survivors alive and be the last colony standing.

---

## Resources

| Resource | Purpose |
|---|---|
| Water | Sustenance — satisfies a survivor's round upkeep (no wellFed bonus) |
| Food | Sustenance — satisfies upkeep **and** grants wellFed (+1 Threat next round); also costs 1 per active Action |
| Meds | Restores Survivor Health *(mechanic not yet implemented)* |
| Wood | Crafting material for weapons, equipment, and structures |
| Metal | Crafting material for weapons, equipment, and structures |
| Ammo | Required for guns to apply their Threat bonus |

---

## Survivors

Each Survivor is a unique character with the following stats:

- **Health** — 3 HP by default; reaches 0 → Survivor dies
- **Threat** — combat skill; determines conflict outcomes
- **Passive** — a unique ability tied to specific scenarios *(descriptions exist; mechanics not yet implemented)*
- **Item Slots** — 2 base slots, expandable with Backpack (+1) or Hand Cart (+2); each slot holds one Weapon, Equipment piece, or Resource stack

### Sustenance (upkeep)

At the end of each round the Director allocates Food, Water, or nothing to each Survivor:

- **Food** — removes Starving debuff; grants **wellFed** (+1 Threat next round)
- **Water** — removes Starving debuff; no bonus
- **Nothing** — Survivor gains/keeps the **Starving** debuff and takes **-1 HP**

### Squads

When more than one Survivor moves to the same location or attacks the same target, they form a Squad. Squads hold the **cumulative Threat** of all members and cannot be split until the end of the round.

---

## The Map

9 locations, each with a finite loot deck that does not replenish. Each scavenge reveals `(survivors sent) + 2 + (equipped Flashlights)` cards; the group keeps `survivors sent` cards and returns the rest to the bottom of the deck.

| Location | Resources |
|---|---|
| Mini Mart | Water, Food, Meds |
| Police Station | Weapons, Ammo, Metal |
| Reservoir | Water |
| Mall | All resources |
| Hospital | Meds, Food, Water |
| Woods | Wood, Food, Water |
| Commercial | Metal, Wood, Food, Water |
| Residential | All resources |
| Grocery | Food, Water |

---

## Game Flow

### 1. Survivor Draft

A random pool of survivors (5 × player count, drawn from 24 unique templates) is laid out. Turn order is determined randomly. Each player selects one Survivor per turn until every player has **4 Survivors**.

### 2. Main Round Loop

#### Select Actions

Each Survivor declares one action. The Director may first **manage inventory** — moving Weapons and Equipment between Survivors — before assigning actions. Active actions (Scavenge, Attack, Craft, Trade) each cost **1 Food**.

| Action | Food Cost | Notes |
|---|---|---|
| Scavenge | 1 | Send to a location to gather loot |
| Attack | 1 | Send to raid another colony's compound |
| Defend | 0 | Stays at compound; adds Threat +1 bonus to compound defense |
| Rest | 0 | Survivor recovers; optionally consumes Food to heal +1 HP |
| Craft | 1 | Build a weapon, equipment, or structure *(not yet implemented)* |
| Trade | 1 | Visit the underground market *(not yet implemented)* |

#### Conflict Resolution

Conflict occurs when two or more players send Survivors to the same location, or when one player attacks another's compound.

- Each squad's **total Threat** is compared
- Highest Threat wins; ties are broken by rolling d6 (added to Threat) until one side leads
- Losers each take **-1 HP**

**Compound defense Threat** = sum of (each defending Survivor's Threat + 1) + structure bonuses. Resting Survivors contribute if an **Electric Fence Alarm** is built.

#### Looting

Winners of a location conflict choose which revealed cards to keep (up to carry capacity). Unchosen cards return to the bottom of the location deck.

Winners of a compound raid choose between:
- **Dealing damage** to a Defender Survivor
- **Looting resources** from the compound (up to carry capacity)

#### Upkeep

The Director allocates **Food**, **Water**, or **Nothing** to each Survivor individually. Survivors who receive neither gain the Starving debuff and take -1 HP. Survivors who ate Food are **wellFed** (+1 Threat) until the end of the next round.

#### End of Round

Any colony with 0 living Survivors is eliminated. Last colony standing wins.

---

## Items

### Weapons *(found in loot decks or crafted)*

| Weapon | Threat Bonus | Ammo Required | Craft Cost |
|---|---|---|---|
| Wooden Club | +1 | No | 10 Wood |
| Lead Pipe | +2 | No | 10 Metal |
| Pipe Gun | +4 | Yes | 40 Metal |
| Handgun | +3 | Yes | Not craftable |
| Rifle | +5 | Yes | Not craftable |

Guns provide no Threat bonus unless the Survivor also carries Ammo.

### Equipment *(found in loot decks or crafted)*

| Equipment | Effect | Craft Cost |
|---|---|---|
| Backpack | +1 item slot | 15 Wood |
| Hand Cart | +2 item slots | 25 Wood |
| Armor | Absorbs 1 damage from a conflict loss (consumed) | 20 Metal |
| Radio | One-use: relocate Survivors after intent declaration *(not yet implemented)* | 50 Metal |
| Flashlight | Reveals 1 extra card when scavenging. Does not occupy an item slot | 2 Metal + 1 Wood |

### Structures *(built at compound)*

| Structure | Compound Threat | Effect | Craft Cost |
|---|---|---|---|
| Bunk | — | +1 Survivor colony capacity | 10 Wood |
| Spike Trap | +1 | — | 15 Wood |
| Spring Trap | +1 | Guaranteed -1 HP to each attacking Survivor regardless of outcome | 10 Metal |
| Ramparts | +2 | — | 25 Wood |
| Electric Fence Alarm | +2 | Resting Survivors contribute their Threat to defense | 25 Metal |
| Rain Catch | — | +1 Water every other round | 5 Wood + 5 Metal |
| Small Garden | — | +1 Food every round | 10 Wood + 1 Food |

---

## Survivor Roster

24 unique Survivors in four archetypes:

**Brawlers** (high Threat, lower HP): Marcus, Anya *(Berserker)*, Torres, Dex *(Ambush)*, Vex *(Glass Cannon)*, Priya, Ryo *(Counter)*

**Tanks** (high HP, lower Threat): Finn *(Tough)*, Lily, Beth *(Field Medic)*, Viktor *(Sentinel)*

**Scavengers** (loot-focused passives): Sofia *(Scavenger)*, Nadia *(Light Fingers)*, Sam, Kim *(Efficient)*

**Balanced**: Ray, Dana, Chen, Omar *(Trader)*, Zara, Jack *(Crafter)*, Mia, Cole, Iris *(Medic)*

*All passive abilities have descriptions but mechanics are not yet implemented.*

---

## Planned / Not Yet Implemented

| Feature | Status |
|---|---|
| Crafting resolution | Declared as an action; resolution not implemented |
| Trading / underground market | Stub only |
| Random events (during scavenge) | Not started |
| Passive abilities | Descriptions only; no mechanics |
| Meds healing | Meds collected but not consumable |
| Radio effect | Defined; not implemented |
| Winner takes damage in conflict | Config flag exists (`winnerTakesDamage`); off by default |

---

## Simulator

A headless simulation mode runs fully automated games for balance testing. Four named strategy bots expose different playstyles:

| Strategy | Behaviour |
|---|---|
| Balanced | Adaptive needs-based scavenging; intermittently assigns armed Survivors to defend |
| Rusher | Ignores resources until critically starving; prioritises weapon-rich locations |
| Hoarder | Always prioritises Food and Water regardless of stock; ignores weapons |
| Raider | Balanced scavenging + strongest Survivor attacks the weakest opponent each round |

Run `npm run sim` for a balanced-only simulation, or `npm run sim-strats` for a strategy tournament (rotates strategies through all seat positions to eliminate positional bias).
