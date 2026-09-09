import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, CircleHelp, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { api, type AccessControlPolicySnapshot, type AccessControlProfile, type AccessControlSnapshot, type PermissionGroup, type ProfilePermissionArea } from "../../api";
import { useI18n, type I18nKey } from "../../i18n";
import { Badge, Button, Dialog, IconButton, Input, PermissionMatrix, SelectMenu, Text, TriStateSwitch, type TriStateSwitchValue } from "../ui";
import Tooltip from "../Tooltip";
import Popconfirm from "../Popconfirm";
import "./ProfileAccessSettings.css";

export const CUSTOM_PERMISSION_ROLE = "custom" as const;
export const ADMINISTRATOR_PERMISSION_ROLE = "administrator" as const;
export type PermissionRoleValue = number | typeof CUSTOM_PERMISSION_ROLE | typeof ADMINISTRATOR_PERMISSION_ROLE;

const OPTIONS: { id: ProfilePermissionArea; key: I18nKey; hint: I18nKey }[] = [
  { id: "channels", key: "profilePermissionChannels", hint: "profilePermissionChannelsHint" },
  { id: "followed_playlists", key: "profilePermissionFollowedPlaylists", hint: "profilePermissionFollowedPlaylistsHint" },
  { id: "imports", key: "profilePermissionImports", hint: "profilePermissionImportsHint" },
  { id: "tags", key: "profilePermissionTags", hint: "profilePermissionTagsHint" },
  { id: "filters", key: "profilePermissionFilters", hint: "profilePermissionFiltersHint" },
  { id: "playlists", key: "profilePermissionPlaylists", hint: "profilePermissionPlaylistsHint" },
  { id: "appearance", key: "profilePermissionAppearance", hint: "profilePermissionAppearanceHint" },
  { id: "feed", key: "profilePermissionFeed", hint: "profilePermissionFeedHint" },
  { id: "navigation", key: "profilePermissionNavigation", hint: "profilePermissionNavigationHint" },
  { id: "playback", key: "profilePermissionPlayback", hint: "profilePermissionPlaybackHint" },
  { id: "plugins", key: "profilePermissionPlugins", hint: "profilePermissionPluginsHint" },
  { id: "profiles", key: "profilePermissionProfiles", hint: "profilePermissionProfilesHint" },
  { id: "public_sharing", key: "profilePermissionPublicSharing", hint: "profilePermissionPublicSharingHint" },
];

type RoleMatrixRow = PermissionGroup | {
  id: "new";
  name: string;
  permissions: ProfilePermissionArea[];
} | {
  id: typeof ADMINISTRATOR_PERMISSION_ROLE;
  name: string;
  permissions: ProfilePermissionArea[];
};

export interface ProfileAccessController {
  data: AccessControlSnapshot | null;
  canEditAdministrators: boolean;
  displayGroupName: (group: PermissionGroup) => string;
  groupOptions: { value: number; label: string }[];
  roleOptions: { value: PermissionRoleValue; label: string; separatorBefore?: boolean; disabled?: boolean }[];
  reload: () => Promise<void>;
  reportError: (error: unknown) => void;
  roleValue: (profile: AccessControlProfile) => PermissionRoleValue;
  setProfileRole: (profile: AccessControlProfile, value: PermissionRoleValue) => Promise<void>;
  applyPolicyData: (data: AccessControlPolicySnapshot) => void;
}

export function useProfileAccessControl(showToast: (message: string) => void, enabled: boolean, canEditAdministrators: boolean): ProfileAccessController {
  const { t } = useI18n();
  const [data, setData] = useState<AccessControlSnapshot | null>(null);
  const applyPolicyData = useCallback((policy: AccessControlPolicySnapshot) => {
    setData((current) => current ? { ...current, ...policy } : current);
  }, []);
  const reportError = useCallback((error: unknown) => showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`), [showToast, t]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setData(await api.accessControl()); } catch (error) { reportError(error); }
  }, [enabled, reportError]);
  useEffect(() => { void reload(); }, [reload]);

  const displayGroupName = useCallback((group: PermissionGroup) => {
    if (group.is_system && group.name === "Standard") return t("permissionGroupStandard");
    if (group.is_system && group.name === "Restricted") return t("permissionGroupRestricted");
    if (group.name === "Migrated policy") return t("permissionGroupMigrated");
    return group.name;
  }, [t]);
  const groupOptions = useMemo(() => data?.groups.map((group) => ({ value: group.id, label: displayGroupName(group) })) ?? [], [data, displayGroupName]);
  const roleOptions = useMemo(() => [
    { value: ADMINISTRATOR_PERMISSION_ROLE, label: t("profileAdministrator"), disabled: !canEditAdministrators },
    ...groupOptions,
    { value: CUSTOM_PERMISSION_ROLE, label: t("permissionRoleCustom"), separatorBefore: true },
  ] satisfies { value: PermissionRoleValue; label: string; separatorBefore?: boolean; disabled?: boolean }[], [canEditAdministrators, groupOptions, t]);
  const roleValue = useCallback((profile: AccessControlProfile): PermissionRoleValue => profile.is_admin ? ADMINISTRATOR_PERMISSION_ROLE : Object.keys(profile.access.overrides).length > 0 ? CUSTOM_PERMISSION_ROLE : profile.access.group_id, []);
  const setProfileRole = useCallback(async (profile: AccessControlProfile, value: PermissionRoleValue) => {
    if (profile.is_primary || value === ADMINISTRATOR_PERMISSION_ROLE && !canEditAdministrators) return;
    try {
      if (value === ADMINISTRATOR_PERMISSION_ROLE) {
        if (!profile.is_admin) await api.setProfileAdministrator(profile.id, true);
      } else {
        if (profile.is_admin) await api.setProfileAdministrator(profile.id, false);
        if (value === CUSTOM_PERMISSION_ROLE) {
        const overrides = Object.fromEntries(OPTIONS.map((option) => [option.id, profile.access.effective.includes(option.id) ? "allow" : "deny"])) as Partial<Record<ProfilePermissionArea, "allow" | "deny">>;
        await api.updateProfileAccess(profile.id, profile.access.group_id, overrides);
        } else {
          await api.updateProfileAccess(profile.id, value, {});
        }
      }
      await reload();
    } catch (error) { reportError(error); }
  }, [canEditAdministrators, reload, reportError]);

  return { data, canEditAdministrators, displayGroupName, groupOptions, roleOptions, reload, reportError, roleValue, setProfileRole, applyPolicyData };
}

export function ProfileAccessDialogs({ controller, groupsOpen, onGroupsOpenChange, matrixOpen, onMatrixOpenChange }: {
  controller: ProfileAccessController;
  groupsOpen: boolean;
  onGroupsOpenChange: (open: boolean) => void;
  matrixOpen: boolean;
  onMatrixOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data } = controller;
  const [newName, setNewName] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [newPermissions, setNewPermissions] = useState<ProfilePermissionArea[]>([]);
  const [query, setQuery] = useState("");
  const stateLabels: Record<TriStateSwitchValue, string> = { inherit: t("permissionStateGroup"), allow: t("permissionStateAllow"), deny: t("permissionStateDeny") };
  const filteredProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? data?.profiles.filter((profile) => profile.name.toLocaleLowerCase().includes(normalized)) ?? [] : data?.profiles ?? [];
  }, [data, query]);
  if (!data) return null;

  const saveGroupPermission = async (group: PermissionGroup, permission: ProfilePermissionArea, allowed: boolean) => {
    const permissions = allowed ? [...new Set([...group.permissions, permission])] : group.permissions.filter((item) => item !== permission);
    try { controller.applyPolicyData(await api.updatePermissionGroup(group.id, permissions)); } catch (error) { controller.reportError(error); }
  };
  const setRole = async (profile: AccessControlProfile, value: PermissionRoleValue) => {
    await controller.setProfileRole(profile, value);
  };
  const roleHeader = (label: string, hint: string) => <span className="profile-role-column-header"><span>{label}</span><Tooltip text={hint} pos="bottom" portal><span className="profile-role-column-help" tabIndex={0} aria-label={hint}><CircleHelp /></span></Tooltip></span>;
  const moveRole = async (groupId: number, targetIndex: number) => {
    const ids = data.groups.map((group) => group.id);
    const fromIndex = ids.indexOf(groupId);
    if (fromIndex < 0 || targetIndex < 0 || targetIndex >= ids.length || fromIndex === targetIndex) return;
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(targetIndex, 0, moved);
    try { controller.applyPolicyData(await api.reorderPermissionGroups(ids)); } catch (error) { controller.reportError(error); }
  };
  const deleteRole = async (group: PermissionGroup, replacementGroupId: number) => {
    try {
      await api.deletePermissionGroup(group.id, replacementGroupId);
      await controller.reload();
    } catch (error) { controller.reportError(error); }
  };
  const renderDeleteRole = (group: PermissionGroup) => {
    if (group.is_system) return null;
    const replacement = group.id === data.default_group_id
      ? data.groups.find((candidate) => candidate.id !== group.id)
      : data.groups.find((candidate) => candidate.id === data.default_group_id);
    if (!replacement) return null;
    return <Popconfirm message={t("deletePermissionRoleConfirm", { name: controller.displayGroupName(group), defaultRole: controller.displayGroupName(replacement) })} onConfirm={() => deleteRole(group, replacement.id)}><IconButton size="sm" label={t("deletePermissionRole")} icon={<Trash2 />} /></Popconfirm>;
  };
  const roleRows: RoleMatrixRow[] = [
    { id: ADMINISTRATOR_PERMISSION_ROLE, name: t("profileAdministrator"), permissions: OPTIONS.map((option) => option.id) },
    ...(creatingRole ? [{ id: "new" as const, name: "", permissions: newPermissions }] : []),
    ...data.groups,
  ];

  return <>
    <Dialog open={groupsOpen} onOpenChange={(open) => { onGroupsOpenChange(open); if (!open) { setCreatingRole(false); setNewName(""); setNewPermissions([]); } }} title={t("permissionGroupsTitle")} closeLabel={t("close")} className="profile-groups-dialog">
      <Text tone="secondary">{t("permissionGroupsHint")}</Text>
      <div className="profile-role-toolbar">
        <Button leadingIcon={<Plus />} disabled={creatingRole} onClick={() => setCreatingRole(true)}>{t("createPermissionGroup")}</Button>
      </div>
      <PermissionMatrix
        rows={roleRows}
        columns={OPTIONS.map((option) => ({ id: option.id, label: roleHeader(t(option.key), t(option.hint)) }))}
        corner={roleHeader(t("permissionRole"), t("permissionRoleColumnHint"))}
        secondaryHeader={roleHeader(t("defaultPermissionRole"), t("defaultPermissionRoleHint"))}
        renderRow={(group) => group.id === "new" ? <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t("permissionGroupNamePlaceholder")} aria-label={t("permissionGroupNamePlaceholder")} size="sm" autoFocus /> : group.id === ADMINISTRATOR_PERMISSION_ROLE ? <span className="profile-role-admin-name"><ShieldCheck />{t("profileAdministrator")}</span> : <span className="profile-role-order-item"><span className="profile-role-name">{controller.displayGroupName(group)}</span><span className="profile-role-order-actions"><IconButton size="sm" label={t("moveUp")} icon={<ChevronUp />} disabled={data.groups[0]?.id === group.id} onClick={() => void moveRole(group.id, data.groups.findIndex((item) => item.id === group.id) - 1)} /><IconButton size="sm" label={t("moveDown")} icon={<ChevronDown />} disabled={data.groups[data.groups.length - 1]?.id === group.id} onClick={() => void moveRole(group.id, data.groups.findIndex((item) => item.id === group.id) + 1)} />{renderDeleteRole(group)}</span></span>}
        renderSecondary={(group) => group.id === ADMINISTRATOR_PERMISSION_ROLE ? <Badge variant="accent">{t("administratorFullAccess")}</Badge> : group.id === "new" ? <span className="profile-role-create-actions"><Button size="sm" variant="primary" disabled={!newName.trim()} onClick={async () => {
          try {
            controller.applyPolicyData(await api.createPermissionGroup(newName.trim(), newPermissions));
            setCreatingRole(false);
            setNewName("");
            setNewPermissions([]);
          } catch (error) { controller.reportError(error); }
        }}>{t("save")}</Button><IconButton size="sm" label={t("cancel")} icon={<X />} onClick={() => { setCreatingRole(false); setNewName(""); setNewPermissions([]); }} /></span> : group.id === data.default_group_id ? <Badge variant="accent">{t("permissionRoleDefault")}</Badge> : <Button size="sm" onClick={async () => { try { controller.applyPolicyData(await api.setDefaultPermissionGroup(group.id)); } catch (error) { controller.reportError(error); } }}>{t("setAsDefaultRole")}</Button>}
        renderCell={(group, columnId) => {
          const permission = columnId as ProfilePermissionArea;
          const checked = group.permissions.includes(permission);
          const administrator = group.id === ADMINISTRATOR_PERMISSION_ROLE;
          const roleName = group.id === "new" ? t("createPermissionGroup") : administrator ? t("profileAdministrator") : controller.displayGroupName(group);
          return <TriStateSwitch className={administrator ? "profile-role-admin-permission" : undefined} ariaLabel={`${roleName}: ${t(OPTIONS.find((option) => option.id === permission)?.key ?? "profilePermissionsTitle")}`} value={checked ? "allow" : "deny"} labels={stateLabels} showLabels={false} showInherit={false} disabled={administrator} onChange={(next) => {
            const allowed = next === "allow";
            if (group.id === "new") setNewPermissions((current) => allowed ? [...new Set([...current, permission])] : current.filter((item) => item !== permission));
            else if (group.id !== ADMINISTRATOR_PERMISSION_ROLE) void saveGroupPermission(group, permission, allowed);
          }} />;
        }}
      />
    </Dialog>

    <Dialog open={matrixOpen} onOpenChange={onMatrixOpenChange} title={t("permissionMatrixTitle")} closeLabel={t("close")} className="profile-permissions-dialog">
      <Text tone="secondary">{t("permissionMatrixHint")}</Text>
      <PermissionMatrix
        rows={filteredProfiles}
        columns={OPTIONS.map((option) => ({ id: option.id, label: t(option.key) }))}
        corner={<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("permissionUserSearch")} aria-label={t("permissionUserSearch")} size="sm" />}
        secondaryHeader={t("permissionRole")}
        rowDisabled={(profile) => profile.is_admin || controller.roleValue(profile) !== CUSTOM_PERMISSION_ROLE}
        renderRow={(profile) => <span className="profile-permission-user">{profile.name}{profile.is_primary ? <Badge variant="accent" size="sm">{t("primaryProfile")}</Badge> : profile.is_admin && <Badge variant="accent" size="sm">{t("profileAdministrator")}</Badge>}</span>}
        renderSecondary={(profile) => profile.is_primary ? <span className="profile-permission-admin-role"><ShieldCheck />{t("profileAdministrator")}</span> : <SelectMenu
          value={controller.roleValue(profile)} options={controller.roleOptions} label={`${t("permissionRole")}: ${profile.name}`} size="sm" floating align="start"
          onChange={(value) => void setRole(profile, value)}
        />}
        renderCell={(profile, columnId) => {
          const permission = columnId as ProfilePermissionArea;
          const custom = controller.roleValue(profile) === CUSTOM_PERMISSION_ROLE;
          const inheritedValue: TriStateSwitchValue = profile.access.effective.includes(permission) ? "allow" : "deny";
          const value: TriStateSwitchValue = profile.is_admin ? "allow" : custom ? profile.access.overrides[permission] ?? "inherit" : inheritedValue;
          return <TriStateSwitch
            value={value} labels={stateLabels} showLabels={false} disabled={profile.is_admin || !custom} ariaLabel={`${profile.name}: ${t(OPTIONS.find((option) => option.id === permission)?.key ?? "profilePermissionsTitle")}`}
            onChange={(nextValue) => {
              const overrides = { ...profile.access.overrides };
              if (nextValue === "inherit") delete overrides[permission]; else overrides[permission] = nextValue;
              void api.updateProfileAccess(profile.id, profile.access.group_id, overrides).then(controller.reload).catch(controller.reportError);
            }}
          />;
        }}
      />
    </Dialog>
  </>;
}
