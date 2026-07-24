let maintenanceReason: string | null = null;

export function maintenanceActive(): boolean {
  return maintenanceReason !== null;
}

export function acquireMaintenance(reason: string): () => void {
  if (maintenanceReason) throw new Error(`maintenance already active: ${maintenanceReason}`);
  maintenanceReason = reason;
  let released = false;
  return () => {
    if (!released) maintenanceReason = null;
    released = true;
  };
}
