export const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function path(relative = "") {
  const normalized = relative.startsWith("/") ? relative : `/${relative}`;
  return `${base}${normalized}`;
}

export function asset(source: string) {
  if (/^https?:\/\//.test(source)) return source;
  return path(source);
}
