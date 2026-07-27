import { useEffect, useState } from "react";
import { AlertTriangle, ArchiveRestore, CheckCircle2, Database, LoaderCircle } from "lucide-react";
import { api, type DatabaseStatus } from "../api";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, ButtonLink, Field, Input, SettingRow, Text } from "./ui";
import "./DatabaseSettings.css";

export default function DatabaseSettings({ showToast }: { showToast: (message: string) => void }) {
  const { language } = useI18n();
  const tx = (en: string, pl: string, de: string) => language === "pl" ? pl : language === "de" ? de : en;
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.databaseStatus().then(setStatus).catch((error) => showToast(error.message));
  useEffect(() => { void load(); }, []);

  const migrate = async () => {
    setBusy(true);
    try {
      const result = await api.migrateDatabaseToPostgres(targetUrl.trim());
      showToast(tx(
        `Copied ${result.rows} rows. Set DATABASE_URL and restart.`,
        `Skopiowano ${result.rows} rekordów. Ustaw DATABASE_URL i uruchom aplikację ponownie.`,
        `${result.rows} Datensätze kopiert. DATABASE_URL setzen und neu starten.`,
      ));
      setTargetUrl("");
      await load();
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api.confirmDatabaseMigration();
      setStatus(result.status);
      showToast(tx("PostgreSQL migration confirmed.", "Migracja PostgreSQL potwierdzona.", "PostgreSQL-Migration bestätigt."));
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <SettingRow className="database-settings" label={tx("Database", "Baza danych", "Datenbank")}><LoaderCircle className="spin" size={16} /></SettingRow>;

  return (
    <SettingRow
      className="database-settings"
      align="start"
      label={tx("Database", "Baza danych", "Datenbank")}
      description={tx("The active database engine and safe migration workflow.", "Aktywny silnik bazy i bezpieczna migracja.", "Aktive Datenbank und sichere Migration.")}
    >
      <div className="database-settings__content">
        <div className="database-settings__status">
          <Badge>{status.engine === "sqlite" ? "SQLite" : "PostgreSQL"}</Badge>
          <Text tone="secondary">{status.location}</Text>
        </div>
        {status.state === "unexpected_change" && (
          <Alert variant="danger" title={tx("Unexpected database change", "Wykryto nieoczekiwaną zmianę bazy", "Unerwarteter Datenbankwechsel") }>
            {tx(`Previously used ${status.previousEngine}. Verify the configuration before writing data.`, `Poprzednio używano ${status.previousEngine}. Sprawdź konfigurację przed zapisem danych.`, `Zuvor wurde ${status.previousEngine} verwendet. Konfiguration vor Schreibvorgängen prüfen.`)}
          </Alert>
        )}
        {status.state === "migration_ready" && (
          <Alert variant="success" icon={<CheckCircle2 />} title={tx("Migrated database detected", "Wykryto zmigrowaną bazę", "Migrierte Datenbank erkannt") }>
            <div style={{ display: "grid", gap: 8 }}>
              <span>{tx("The migration receipt was found. Confirm this PostgreSQL database as active.", "Znaleziono potwierdzenie migracji. Potwierdź tę bazę PostgreSQL jako aktywną.", "Der Migrationsbeleg wurde gefunden. Diese PostgreSQL-Datenbank bestätigen.")}</span>
              <Button variant="primary" onClick={confirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}{tx("Confirm database", "Potwierdź bazę", "Datenbank bestätigen")}</Button>
            </div>
          </Alert>
        )}
        {status.engine === "sqlite" && status.state === "current" && (
          <div className="database-settings__migration">
            <Alert variant="warning" icon={<AlertTriangle />} title={tx("Create a backup before migrating", "Przed migracją wykonaj kopię zapasową", "Vor der Migration ein Backup erstellen")}>
              <div className="database-settings__warning-content">
                <span>{tx("Migration changes the database backend. Export a current backup before continuing so your portable data can be restored if anything goes wrong.", "Migracja zmienia silnik bazy danych. Przed kontynuowaniem wyeksportuj aktualną kopię, aby w razie problemów móc przywrócić przenośne dane.", "Die Migration wechselt das Datenbank-Backend. Vorher ein aktuelles Backup exportieren, damit portable Daten bei Problemen wiederhergestellt werden können.")}</span>
                <ButtonLink size="sm" to="/restore" leadingIcon={<ArchiveRestore size={14} />}>{tx("Open backup and restore", "Otwórz kopię zapasową i przywracanie", "Sichern und wiederherstellen öffnen")}</ButtonLink>
              </div>
            </Alert>
            <Field label={tx("PostgreSQL connection URL", "Adres połączenia PostgreSQL", "PostgreSQL-Verbindungs-URL")} hint={tx("The target must be empty. The URL is used only for this migration and is never saved.", "Docelowa baza musi być pusta. Adres jest używany tylko podczas migracji i nie jest zapisywany.", "Das Ziel muss leer sein. Die URL wird nur für die Migration verwendet und nicht gespeichert.")}>
              <div className="database-settings__connection">
                <Input type="password" autoComplete="off" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="postgresql://user:password@host/database" />
                <Button variant="primary" onClick={migrate} disabled={busy || !/^postgres(?:ql)?:\/\//i.test(targetUrl.trim())}>{busy ? <LoaderCircle className="spin" size={15} /> : <Database size={15} />}{tx("Migrate", "Migruj", "Migrieren")}</Button>
              </div>
            </Field>
          </div>
        )}
      </div>
    </SettingRow>
  );
}
