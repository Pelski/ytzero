import { Grid2X2, Grid3X3, Square } from "lucide-react";
import { api } from "./api";

export type GridSize = "sm" | "md" | "lg";

export const GRID_SIZE_STORAGE_KEY = "gridSize";

export const GRID_SIZES: { id: GridSize; icon: React.ReactNode; labelKey: "gridSmall" | "gridMedium" | "gridLarge" }[] = [
  { id: "sm", icon: <Grid3X3 size={15} />, labelKey: "gridSmall" },
  { id: "md", icon: <Grid2X2 size={15} />, labelKey: "gridMedium" },
  { id: "lg", icon: <Square size={15} />, labelKey: "gridLarge" },
];

export function readGridSize(): GridSize {
  const value = localStorage.getItem(GRID_SIZE_STORAGE_KEY);
  return value === "sm" || value === "md" || value === "lg" ? value : "sm";
}

export function persistGridSize(size: GridSize) {
  localStorage.setItem(GRID_SIZE_STORAGE_KEY, size);
  api.updateSettings({ grid_size: size }).catch(() => {});
}
