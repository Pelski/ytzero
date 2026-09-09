export function isPublicSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}
