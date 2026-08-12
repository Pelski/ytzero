import { http } from "./apiHttp";
import type { TubeArchivistStatus } from "./pluginTypes";

export type { TubeArchivistStatus } from "./pluginTypes";

export const tubeArchivistApi = {
  config: () => http<TubeArchivistStatus>("/plugins/tubearchivist/config"),
  updateConfig: (body: { baseUrl?: string; token?: string; clearToken?: boolean }) =>
    http<TubeArchivistStatus>("/plugins/tubearchivist/config", { method: "PUT", body: JSON.stringify(body) }),
  test: () => http<{ ok: true; version: string | null }>("/plugins/tubearchivist/test", { method: "POST", body: "{}" }),
  sync: () => http<{ ok: true; imported: number; pages: number }>("/plugins/tubearchivist/sync", { method: "POST", body: "{}" }),
};
