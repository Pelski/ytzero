import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { api, type ManagedPublicShare, type PublicShareResourceType } from "../api";
import { useI18n } from "../i18n";
import Popconfirm from "./Popconfirm";
import { Alert, Badge, Button, FormActions, IconButton, Inline, Input, LocalToast, Popover, SettingRow, Stack, Switch, Text } from "./ui";
import "./PublicShareControl.css";

export function publicShareStatusLabel(share: ManagedPublicShare, t: ReturnType<typeof useI18n>["t"]): string {
  if (share.active) return t("publicShareActive");
  if (share.suspension_reason === "policy_disabled") return t("publicSharePolicyDisabled");
  if (share.suspension_reason === "permission_suspended") return t("publicSharePermissionSuspended");
  if (share.suspension_reason === "resource_unavailable") return t("publicShareResourceUnavailable");
  return t("publicShareSuspended");
}

export function PublicShareEditor({ share, pending = false, settingsLayout = false, showStatus = true, showLinkLabel = true, onChange, onDelete }: {
  share: ManagedPublicShare;
  pending?: boolean;
  settingsLayout?: boolean;
  showStatus?: boolean;
  showLinkLabel?: boolean;
  onChange: (share: ManagedPublicShare) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const disabled = pending || working;

  const perform = async (task: () => Promise<ManagedPublicShare>, success?: string) => {
    setWorking(true);
    setFeedback(null);
    try {
      const updated = await task();
      onChange({ ...updated, owner_name: updated.owner_name ?? share.owner_name });
      if (success) setFeedback(success);
    } catch {
      setFeedback(t("publicShareError"));
    } finally {
      setWorking(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.url);
      setFeedback(t("publicShareCopied"));
    } catch {
      setFeedback(t("publicShareError"));
    }
  };

  const linkControl = <Inline wrap={false} className="public-share-editor__url">
    <Input readOnly value={share.url} aria-label={t("publicShareAction")} />
    <IconButton icon={<Copy />} label={t("publicShareCopy")} onClick={() => void copy()} />
  </Inline>;
  const localMediaControl = <Switch
    checked={share.allow_local_media}
    disabled={disabled}
    ariaLabel={t("publicShareLocalMedia")}
    onCheckedChange={(allowed) => void perform(
      () => api.updatePublicShareLocalMedia(share.id, allowed).then((result) => result.share),
      allowed ? t("publicShareTokenRotated") : undefined,
    )}
  />;
  const actions = <>
    <Popconfirm message={t("publicShareRotateConfirm")} confirmVariant="primary" onConfirm={() => void perform(() => api.rotatePublicShare(share.id).then((result) => result.share), t("publicShareTokenRotated"))}>
      <Button size="sm" disabled={disabled} leadingIcon={<RefreshCw />}>{t("publicShareRotate")}</Button>
    </Popconfirm>
    <Popconfirm message={t("publicShareRevokeConfirm")} onConfirm={() => {
      setWorking(true);
      void api.deletePublicShare(share.id).then(onDelete).catch(() => setFeedback(t("publicShareError"))).finally(() => setWorking(false));
    }}>
      <Button size="sm" variant="danger" disabled={disabled} leadingIcon={<Trash2 />}>{t("publicShareRevoke")}</Button>
    </Popconfirm>
  </>;

  if (settingsLayout) return <div className="public-share-editor public-share-editor--settings">
    {feedback && <Alert variant={feedback === t("publicShareError") ? "danger" : "success"}>{feedback}</Alert>}
    <SettingRow align="start" className="public-share-editor__link-row" label={t("publicShareAction")}>
      {linkControl}
    </SettingRow>
    <SettingRow label={t("publicShareLocalMedia")} description={t("publicShareLocalMediaHint")}>
      {localMediaControl}
    </SettingRow>
    <FormActions>{actions}</FormActions>
  </div>;

  return <Stack gap={3} className="public-share-editor">
    {showStatus && <Inline justify="between">
      <Badge variant={share.active ? "success" : "warning"}>{publicShareStatusLabel(share, t)}</Badge>
      {feedback && <LocalToast variant={feedback === t("publicShareError") ? "danger" : "default"}>{feedback}</LocalToast>}
    </Inline>}
    {!showStatus && feedback && <LocalToast variant={feedback === t("publicShareError") ? "danger" : "default"}>{feedback}</LocalToast>}
    {showLinkLabel && <span className="public-share-editor__label">{t("publicShareAction")}</span>}
    {linkControl}
    <Switch
      checked={share.allow_local_media}
      disabled={disabled}
      label={t("publicShareLocalMedia")}
      description={t("publicShareLocalMediaHint")}
      onCheckedChange={(allowed) => void perform(
        () => api.updatePublicShareLocalMedia(share.id, allowed).then((result) => result.share),
        allowed ? t("publicShareTokenRotated") : undefined,
      )}
    />
    <Inline justify="end">
      {actions}
    </Inline>
  </Stack>;
}

export default function PublicShareControl({ resourceType, resourceId, compact = false, embedded = false }: {
  resourceType: PublicShareResourceType;
  resourceId: string | number;
  compact?: boolean;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [policyEnabled, setPolicyEnabled] = useState(false);
  const [share, setShare] = useState<ManagedPublicShare | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.publicShares({ resource_type: resourceType, resource_id: resourceId });
      setPolicyEnabled(result.policy.enabled);
      setShare(result.shares[0] ?? null);
      setVisible(true);
    } catch {
      setVisible(false);
    }
  }, [resourceId, resourceType]);

  useEffect(() => { void load(); }, [load]);
  if (!visible) return null;

  const create = async () => {
    setWorking(true);
    setError(false);
    try { setShare((await api.createPublicShare(resourceType, resourceId)).share); }
    catch { setError(true); }
    finally { setWorking(false); }
  };

  const content = <Stack gap={3} className={`public-share-control${embedded ? " public-share-control--embedded" : ""}`}>
    <Text as="div" size="sm" className="public-share-control__title"><Link2 /><strong>{t("publicShareAction")}</strong></Text>
    {!policyEnabled && <Alert variant="warning">{t("publicShareDisabledByAdmin")}</Alert>}
    {error && <Alert variant="danger">{t("publicShareError")}</Alert>}
    {share ? <PublicShareEditor share={share} pending={working} showLinkLabel={!embedded} onChange={setShare} onDelete={() => setShare(null)} /> : <Button variant="primary" disabled={!policyEnabled || working} onClick={() => void create()}>{t("publicShareCreate")}</Button>}
  </Stack>;

  if (embedded) return content;

  return <Popover
    align="end"
    placement="auto"
    open={open}
    onOpenChange={setOpen}
    className="public-share-control__popover"
    trigger={compact
      ? <IconButton icon={<Link2 />} label={t("publicShareAction")} variant={open ? "secondary" : "default"} />
      : <Button leadingIcon={<Link2 />} variant={open ? "secondary" : "default"}>{t("publicShareAction")}</Button>}
  >
    {content}
  </Popover>;
}
