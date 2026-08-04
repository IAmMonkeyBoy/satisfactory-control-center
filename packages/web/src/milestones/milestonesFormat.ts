import type { MilestoneIngredient } from "@scc/shared";

/** How far an ingredient is toward its milestone cost, clamped to 100 — a
 *  save can in principle over-pay (submitting more than the exact minimum
 *  isn't possible in-game, but nothing here should render past a full bar
 *  if it ever happened). */
export function ingredientPercent(ingredient: MilestoneIngredient): number {
  if (ingredient.targetAmount <= 0) return 100;
  return Math.min(100, Math.round((ingredient.amount / ingredient.targetAmount) * 100));
}

export function formatHardDrives(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "hard drive" : "hard drives"} waiting`;
}

export function formatAlternates(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "alternate" : "alternates"} unlocked`;
}
