import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { tubeArchivistApi, type TubeArchivistStatus } from "../../tubeArchivistApi";
import { Alert, Button, Field, FormActions, Input, SettingRow, SettingsSection } from "../ui";

export function TubeArchivistSettings({ canManage }: { canManage: boolean }) {
  const { language } = useI18n();
  const pl = language === "pl";
  const [status, setStatus] = useState<TubeArchivistStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | "clear" | null>(null);

  const reload = async () => {
    const next = await tubeArchivistApi.config();
    setStatus(next);
    setBaseUrl(next.baseUrl);
  };
  useEffect(() => { void reload().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, []);

  const run = async (kind: "save" | "test" | "sync" | "clear") => {
    setBusy(kind); setMessage(null);
    try {
      if (kind === "save") {
        const next = await tubeArchivistApi.updateConfig({ baseUrl, ...(token.trim() ? { token } : {}) });
        setStatus(next); setToken("");
        setMessage(pl ? "Konfiguracja zapisana." : "Configuration saved.");
      } else if (kind === "clear") {
        const next = await tubeArchivistApi.updateConfig({ clearToken: true });
        setStatus(next); setToken("");
        setMessage(pl ? "Token został usunięty." : "Token removed.");
      } else if (kind === "test") {
        const result = await tubeArchivistApi.test();
        setMessage(`${pl ? "Połączenie działa" : "Connection works"}${result.version ? ` — TubeArchivist ${result.version}` : "."}`);
      } else {
        const result = await tubeArchivistApi.sync();
        await reload();
        setMessage(pl ? `Zaimportowano ${result.imported} filmów.` : `Imported ${result.imported} videos.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  return <SettingsSection
    title={pl ? "Połączenie z TubeArchivist" : "TubeArchivist connection"}
    description={pl ? "Biblioteka pojawi się automatycznie w istniejącym feedzie — plugin nie dodaje osobnej strony." : "The library appears automatically in the existing feed; the plugin does not add a separate page."}
  >
    {message && <Alert variant="info">{message}</Alert>}
    <SettingRow label={pl ? "Adres serwera" : "Server URL"} description="http(s)://host:port">
      <Field>
        <Input aria-label={pl ? "Adres TubeArchivist" : "TubeArchivist URL"} type="url" value={baseUrl} disabled={!canManage || busy !== null} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://tubearchivist:8000" />
      </Field>
    </SettingRow>
    <SettingRow label="API token" description={status?.tokenConfigured ? (pl ? "Token jest skonfigurowany. Puste pole zachowa obecną wartość." : "A token is configured. Leaving this blank preserves it.") : (pl ? "Token nie jest jeszcze skonfigurowany." : "No token is configured yet.")}>
      <Field>
        <Input aria-label="TubeArchivist API token" type="password" value={token} disabled={!canManage || busy !== null} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" />
      </Field>
    </SettingRow>
    {status?.configured && <Alert variant={status.lastError ? "warning" : "info"}>
      {pl ? "Filmy lokalne" : "Local videos"}: {status.itemCount}
      {status.lastSyncedAt ? ` · ${pl ? "ostatnia synchronizacja" : "last sync"}: ${new Date(status.lastSyncedAt).toLocaleString()}` : ""}
      {status.lastError ? ` · ${status.lastError}` : ""}
    </Alert>}
    <FormActions>
      {status?.tokenConfigured && <Button variant="danger" disabled={!canManage || busy !== null} onClick={() => void run("clear")}>{busy === "clear" ? "…" : (pl ? "Usuń token" : "Remove token")}</Button>}
      <Button disabled={!canManage || busy !== null || !status?.configured} onClick={() => void run("test")}>{busy === "test" ? "…" : (pl ? "Testuj połączenie" : "Test connection")}</Button>
      <Button disabled={!canManage || busy !== null || !status?.configured} onClick={() => void run("sync")}>{busy === "sync" ? "…" : (pl ? "Synchronizuj teraz" : "Sync now")}</Button>
      <Button variant="primary" disabled={!canManage || busy !== null || !baseUrl.trim()} onClick={() => void run("save")}>{busy === "save" ? "…" : (pl ? "Zapisz" : "Save")}</Button>
    </FormActions>
  </SettingsSection>;
}
