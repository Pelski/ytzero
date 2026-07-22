import { createContext } from "react";

export const PopoverBranchContext = createContext<string[]>([]);

export function isInPopoverBranch(target: EventTarget | null, popoverId: string): boolean {
  if (!(target instanceof Element)) return false;
  const branch = target.closest<HTMLElement>("[data-popover-branch]")?.dataset.popoverBranch;
  return branch?.split(" ").includes(popoverId) ?? false;
}
