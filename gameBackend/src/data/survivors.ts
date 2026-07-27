import { SurvivorTemplate } from '../types';

/**
 * Full survivor roster. Draft pool is drawn randomly from this list.
 * Stats are placeholders — tune HP and baseThreat once the sim reveals balance issues.
 * Passives are descriptions only; mechanics are not yet implemented.
 */
export const ALL_SURVIVORS: SurvivorTemplate[] = [
  // ── Brawlers (high threat, average HP) ──────────────────────────────────
  { id: 'marcus',  name: 'Marcus',  maxHp: 3, baseThreat: 3 },
  { id: 'anya',    name: 'Anya',    maxHp: 2, baseThreat: 4, passive: 'Berserker: deals +1 damage when below half HP' },
  { id: 'torres',  name: 'Torres',  maxHp: 2, baseThreat: 4 },
  { id: 'dex',     name: 'Dex',     maxHp: 2, baseThreat: 4, passive: 'Ambush: +1 threat when attacking a full-health target' },
  { id: 'vex',     name: 'Vex',     maxHp: 1, baseThreat: 5, passive: 'Glass Cannon: dies on any damage' },
  { id: 'priya',   name: 'Priya',   maxHp: 2, baseThreat: 3 },
  { id: 'ryo',     name: 'Ryo',     maxHp: 2, baseThreat: 3, passive: 'Counter: +1 threat when defending' },

  // ── Tanks (high HP, lower threat) ───────────────────────────────────────
  { id: 'finn',    name: 'Finn',    maxHp: 4, baseThreat: 2, passive: 'Tough: ignores first damage each conflict' },
  { id: 'lily',    name: 'Lily',    maxHp: 4, baseThreat: 1 },
  { id: 'beth',    name: 'Beth',    maxHp: 4, baseThreat: 1, passive: 'Field Medic: at upkeep, heals 1 HP to an adjacent survivor if meds available' },
  { id: 'viktor',  name: 'Viktor',  maxHp: 3, baseThreat: 1, passive: 'Sentinel: defending survivors in compound get +1 threat' },

  // ── Scavengers (average HP and threat, scavenge bonuses) ────────────────
  { id: 'sofia',   name: 'Sofia',   maxHp: 3, baseThreat: 1, passive: 'Scavenger: reveals 1 extra card when looting' },
  { id: 'nadia',   name: 'Nadia',   maxHp: 3, baseThreat: 1, passive: 'Light Fingers: carry +1 item when looting' },
  { id: 'sam',     name: 'Sam',     maxHp: 3, baseThreat: 1 },
  { id: 'kim',     name: 'Kim',     maxHp: 3, baseThreat: 2, passive: 'Efficient: scavenging costs no food' },

  // ── Balanced ────────────────────────────────────────────────────────────
  { id: 'ray',     name: 'Ray',     maxHp: 3, baseThreat: 2 },
  { id: 'dana',    name: 'Dana',    maxHp: 3, baseThreat: 2 },
  { id: 'chen',    name: 'Chen',    maxHp: 3, baseThreat: 2 },
  { id: 'omar',    name: 'Omar',    maxHp: 3, baseThreat: 2, passive: 'Trader: trade action costs no food' },
  { id: 'zara',    name: 'Zara',    maxHp: 3, baseThreat: 2 },
  { id: 'jack',    name: 'Jack',    maxHp: 3, baseThreat: 2, passive: 'Crafter: crafting costs -5 materials' },
  { id: 'mia',     name: 'Mia',     maxHp: 3, baseThreat: 2 },
  { id: 'cole',    name: 'Cole',    maxHp: 3, baseThreat: 2 },
  { id: 'iris',    name: 'Iris',    maxHp: 3, baseThreat: 2, passive: 'Medic: meds heal +1 extra HP' },
];
