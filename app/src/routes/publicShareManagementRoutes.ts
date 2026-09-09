import type { Context, Hono } from "hono";
import { hasPermission } from "../accessControl";
import {
  createPublicShare,
  deletePublicShare,
  isPublicShareResourceType,
  listManagedPublicShares,
  managedPublicShare,
  publicShareStatus,
  publicSharingEnabled,
  PublicShareError,
  rotatePublicShare,
  setPublicSharingEnabled,
  updatePublicShareLocalMedia,
  type PublicShareResourceType,
  type PublicShareRow,
} from "../publicSharing";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean; permissionGroupUuid?: string } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

interface PublicShareManagementAccess {
  currentUserId: (context: ApiContext) => number;
  isAdmin: (context: ApiContext) => boolean;
}

function failure(c: ApiContext, error: unknown) {
  if (error instanceof PublicShareError) return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}

function publicBaseUrl(c: ApiContext): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    try { return new URL(configured).origin + new URL(configured).pathname.replace(/\/$/, ""); } catch {}
  }
  return new URL(c.req.url).origin;
}

async function serializeShare(c: ApiContext, share: PublicShareRow, enabled: boolean, includeOwner: boolean) {
  const status = await publicShareStatus(share, enabled);
  return {
    id: share.id,
    token: share.token,
    url: `${publicBaseUrl(c)}/share/${share.token}`,
    owner_user_id: share.owner_user_id,
    ...(includeOwner ? { owner_name: share.owner_name ?? "" } : {}),
    resource_type: share.resource_type,
    resource_id: share.resource_id,
    resource_title: status.resource?.title ?? share.resource_id,
    video_count: status.resource?.video_count ?? 0,
    allow_local_media: share.allow_local_media === 1,
    active: status.active,
    suspension_reason: status.reason,
    created_at: share.created_at,
    updated_at: share.updated_at,
  };
}

export function registerPublicShareManagementRoutes(api: Api, access: PublicShareManagementAccess): void {
  const { currentUserId, isAdmin } = access;

  const canUseSharing = async (c: ApiContext) => isAdmin(c)
    || hasPermission(currentUserId(c), "public_sharing", false, c.get("permissionGroupUuid"));

  const canManage = (c: ApiContext, share: PublicShareRow) => isAdmin(c) || share.owner_user_id === currentUserId(c);

  api.get("/public-shares", async (c) => {
    if (!await canUseSharing(c)) return c.json({ error: "permission denied" }, 403);
    const resourceTypeValue = c.req.query("resource_type");
    const resourceId = c.req.query("resource_id")?.trim();
    if (resourceTypeValue && !isPublicShareResourceType(resourceTypeValue)) return c.json({ error: "invalid resource type" }, 400);
    const administrator = isAdmin(c);
    const enabled = await publicSharingEnabled();
    // Resource-scoped queries drive the inline editor and always refer to the
    // active profile's own link. Administrators manage links owned by other
    // profiles from the unfiltered Sharing settings list.
    const resourceScoped = Boolean(resourceTypeValue && resourceId);
    const shares = await listManagedPublicShares(currentUserId(c), administrator && !resourceScoped, {
      resourceType: resourceTypeValue as PublicShareResourceType | undefined,
      resourceId: resourceId || undefined,
    });
    c.header("Cache-Control", "private, no-store");
    return c.json({
      policy: { enabled, can_manage: administrator },
      shares: await Promise.all(shares.map((share) => serializeShare(c, share, enabled, administrator))),
    });
  });

  api.put("/public-shares/policy", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
    const body = await c.req.json().catch(() => ({})) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be boolean" }, 400);
    await setPublicSharingEnabled(body.enabled);
    return c.json({ policy: { enabled: body.enabled, can_manage: true } });
  });

  api.post("/public-shares", async (c) => {
    if (!await canUseSharing(c)) return c.json({ error: "permission denied" }, 403);
    const body = await c.req.json().catch(() => ({})) as { resource_type?: unknown; resource_id?: unknown };
    if (!isPublicShareResourceType(body.resource_type) || (typeof body.resource_id !== "string" && typeof body.resource_id !== "number")) {
      return c.json({ error: "invalid resource" }, 400);
    }
    const resourceId = String(body.resource_id).trim();
    if (!resourceId || resourceId.length > 160) return c.json({ error: "invalid resource" }, 400);
    try {
      const share = await createPublicShare(currentUserId(c), body.resource_type, resourceId);
      const enabled = await publicSharingEnabled();
      c.header("Cache-Control", "private, no-store");
      return c.json({ share: await serializeShare(c, share, enabled, false) }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  api.patch("/public-shares/:id", async (c) => {
    if (!await canUseSharing(c)) return c.json({ error: "permission denied" }, 403);
    const share = await managedPublicShare(c.req.param("id"));
    if (!share) return c.json({ error: "not found" }, 404);
    if (!canManage(c, share)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => ({})) as { allow_local_media?: unknown };
    if (typeof body.allow_local_media !== "boolean") return c.json({ error: "allow_local_media must be boolean" }, 400);
    const result = await updatePublicShareLocalMedia(share.id, body.allow_local_media);
    if (!result.share) return c.json({ error: "not found" }, 404);
    const enabled = await publicSharingEnabled();
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: await serializeShare(c, result.share, enabled, false), rotated: result.rotated });
  });

  api.post("/public-shares/:id/rotate", async (c) => {
    if (!await canUseSharing(c)) return c.json({ error: "permission denied" }, 403);
    const current = await managedPublicShare(c.req.param("id"));
    if (!current || !canManage(c, current)) return c.json({ error: "not found" }, 404);
    const share = await rotatePublicShare(current.id);
    if (!share) return c.json({ error: "not found" }, 404);
    const enabled = await publicSharingEnabled();
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: await serializeShare(c, share, enabled, false) });
  });

  api.delete("/public-shares/:id", async (c) => {
    if (!await canUseSharing(c)) return c.json({ error: "permission denied" }, 403);
    const current = await managedPublicShare(c.req.param("id"));
    if (!current || !canManage(c, current)) return c.json({ error: "not found" }, 404);
    await deletePublicShare(current.id);
    return c.json({ ok: true });
  });
}
