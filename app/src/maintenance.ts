let maintenanceReason: string | null = null;
let activeMutations = 0;
const idleWaiters = new Set<() => void>();

export function maintenanceActive(): boolean {
  return maintenanceReason !== null;
}

export function maintenanceStatus(): { active: boolean; reason: string | null; activeMutations: number } {
  return { active: maintenanceActive(), reason: maintenanceReason, activeMutations };
}

function notifyIdle(): void {
  if (activeMutations !== 0) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

/** Register a mutating operation. NULL means maintenance has already started. */
export function beginMutation(): (() => void) | null {
  if (maintenanceActive()) return null;
  activeMutations++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeMutations = Math.max(0, activeMutations - 1);
    notifyIdle();
  };
}

export async function acquireMaintenance(reason: string): Promise<() => void> {
  if (maintenanceReason) throw new Error(`maintenance already active: ${maintenanceReason}`);
  maintenanceReason = reason;
  if (activeMutations > 0) {
    await new Promise<void>((resolve) => idleWaiters.add(resolve));
  }
  let released = false;
  return () => {
    if (!released) maintenanceReason = null;
    released = true;
  };
}
