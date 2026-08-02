import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, type DownloadAutomationOptions, type DownloadRule, type DownloadRuleInput, type DownloadRulePreview } from "../api";
import { useI18n } from "../i18n";
import Popconfirm from "./Popconfirm";
import { Alert, Badge, Button, Checkbox, EmptyState, FormActions, IconButton, Input, InputGroup, MultiSelectMenu, OptionPicker, SegmentedControl, SelectMenu, SettingRow, SettingsSection, Switch, Textarea } from "./ui";
import { img } from "../img";
import "./DownloadAutomation.css";

const EMPTY_RULE: DownloadRuleInput = {
  name: "",
  enabled: true,
  source_mode: "selected",
  channel_ids: [],
  playlist_ids: [],
  include_keywords: [],
  exclude_keywords: [],
  keyword_mode: "any",
  match_field: "title",
  include_shorts: false,
  include_members_only: false,
  min_duration_seconds: 0,
  backfill_mode: "future",
  lookback_hours: 48,
};

function keywordText(values: string[]) { return values.join("\n"); }
function parseKeywords(value: string) { return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]; }
function polishForm(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

export default function DownloadAutomation() {
  const { language } = useI18n();
  const tx = (en: string, pl: string, de: string) => language === "pl" ? pl : language === "de" ? de : en;
  const [rules, setRules] = useState<DownloadRule[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [options, setOptions] = useState<DownloadAutomationOptions>({ channels: [], playlists: [] });
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DownloadRuleInput>(EMPTY_RULE);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [preview, setPreview] = useState<DownloadRulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRequest = useRef(0);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.downloadRules(), api.downloadAutomationOptions()])
      .then(([ruleResult, optionResult]) => { setRules(ruleResult.rules); setCanManage(ruleResult.can_manage); setOptions(optionResult); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(load, [load]);

  const sourceReady = draft.source_mode === "subscriptions" || draft.channel_ids.length > 0 || draft.playlist_ids.length > 0;
  const countNoun = (count: number, enOne: string, enMany: string, plOne: string, plFew: string, plMany: string, deOne: string, deMany: string) => language === "pl"
    ? polishForm(count, plOne, plFew, plMany)
    : language === "de" ? (count === 1 ? deOne : deMany) : (count === 1 ? enOne : enMany);
  const readyCount = preview?.ready ?? 0;
  const readyDisplay = `${preview?.limited ? tx("at least ", "co najmniej ", "mindestens ") : ""}${readyCount}`;
  const saveDisabled = saving || !sourceReady || !draft.name.trim() || (draft.enabled && (previewing || !preview));
  useEffect(() => {
    const requestId = ++previewRequest.current;
    setPreviewError("");
    if (editingId == null || !sourceReady) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      api.previewDownloadRule(draft)
        .then((result) => { if (previewRequest.current === requestId) setPreview(result); })
        .catch(() => {
          if (previewRequest.current !== requestId) return;
          setPreview(null);
          setPreviewError(language === "pl" ? "Nie udało się obliczyć podglądu. Sprawdź połączenie i spróbuj ponownie." : language === "de" ? "Die Vorschau konnte nicht berechnet werden. Prüfe die Verbindung und versuche es erneut." : "The preview could not be calculated. Check the connection and try again.");
        })
        .finally(() => { if (previewRequest.current === requestId) setPreviewing(false); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, editingId, language, sourceReady]);

  const channelOptions = useMemo(() => options.channels.map((channel) => ({ value: channel.channel_id, label: channel.title || channel.channel_id })), [options.channels]);
  const playlistOptions = useMemo(() => options.playlists.map((playlist) => ({ value: playlist.playlist_id, label: `${playlist.title} · ${playlist.channel_title}` })), [options.playlists]);

  const edit = (rule?: DownloadRule) => {
    setEditingId(rule?.id ?? "new");
    setDraft(rule ? { ...rule } : { ...EMPTY_RULE, name: tx("New download rule", "Nowa reguła pobierania", "Neue Download-Regel") });
    setIncludeText(keywordText(rule?.include_keywords ?? []));
    setExcludeText(keywordText(rule?.exclude_keywords ?? []));
    setError("");
  };

  const save = async () => {
    if (!sourceReady || !draft.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (editingId === "new") await api.createDownloadRule(draft);
      else if (typeof editingId === "number") await api.updateDownloadRule(editingId, draft);
      setEditingId(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(false); }
  };

  const toggle = async (rule: DownloadRule, enabled: boolean) => {
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
    try { await api.updateDownloadRule(rule.id, { enabled }); } catch { load(); }
  };

  if (!loaded) return <div className="dl-automation-loading" aria-label={tx("Loading automation", "Ładowanie automatyzacji", "Automatisierung wird geladen")}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>;

  if (editingId != null) return (
    <div className="dl-automation-editor">
      <SettingsSection title={editingId === "new" ? tx("Create automation", "Utwórz automatyzację", "Automatisierung erstellen") : tx("Edit automation", "Edytuj automatyzację", "Automatisierung bearbeiten")} description={tx("Name the rule. You can save it in test mode before allowing automatic downloads.", "Nazwij regułę. Możesz najpierw zapisać ją w trybie testowym, zanim zezwolisz na automatyczne pobieranie.", "Benenne die Regel. Du kannst sie zuerst im Testmodus speichern, bevor automatische Downloads erlaubt werden.")}>
        <SettingRow label={tx("Rule name", "Nazwa reguły", "Regelname")} description={tx("Use a name that explains the intent, not the implementation.", "Nazwij cel reguły, a nie jej techniczne warunki.", "Benenne den Zweck der Regel, nicht ihre Technik.")}>
          <Input id="download-rule-name" aria-label={tx("Rule name", "Nazwa reguły", "Regelname")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </SettingRow>
        <SettingRow label={tx("Test mode", "Tryb testowy", "Testmodus")} description={tx("Save the rule and keep its preview available, but do not download anything until you activate it.", "Zapisuje regułę i pozwala dalej sprawdzać jej podgląd, ale niczego nie pobierze, dopóki jej nie uruchomisz.", "Speichert die Regel mit verfügbarer Vorschau, lädt aber nichts herunter, bis du sie aktivierst.")}>
          <Switch ariaLabel={tx("Test mode", "Tryb testowy", "Testmodus")} checked={!draft.enabled} onCheckedChange={(testMode) => setDraft({ ...draft, enabled: !testMode })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={tx("Sources", "Źródła", "Quellen")} description={tx("Choose where this rule may look for videos.", "Wybierz, gdzie reguła ma szukać materiałów.", "Wähle, wo diese Regel nach Videos suchen darf.")}>
        <OptionPicker
          className="dl-rule-option-picker"
          label={tx("Source scope", "Zakres źródeł", "Quellenumfang")}
          value={draft.source_mode}
          onChange={(source_mode) => setDraft({ ...draft, source_mode, channel_ids: [], playlist_ids: [] })}
          columns={2}
          options={[
            { value: "selected", label: tx("Selected sources", "Wybrane źródła", "Ausgewählte Quellen"), description: tx("Choose specific channels or playlists.", "Wskaż konkretne kanały lub playlisty.", "Bestimmte Kanäle oder Playlists wählen.") },
            { value: "subscriptions", label: tx("All subscriptions", "Wszystkie subskrypcje", "Alle Abos"), description: tx("Use every subscription, with optional channel exceptions.", "Uwzględnij wszystkie subskrypcje z opcjonalnymi wyjątkami kanałów.", "Alle Abos mit optionalen Kanalausnahmen verwenden.") },
          ]}
        />
        <SettingRow align="start" label={draft.source_mode === "selected" ? tx("Included sources", "Uwzględniane źródła", "Einbezogene Quellen") : tx("Exceptions", "Wyjątki", "Ausnahmen")} description={draft.source_mode === "selected" ? tx("At least one channel or playlist is required.", "Wybierz co najmniej jeden kanał lub playlistę.", "Mindestens ein Kanal oder eine Playlist ist erforderlich.") : tx("Selected channels will not be downloaded automatically.", "Materiały z wybranych kanałów nie będą pobierane automatycznie.", "Videos ausgewählter Kanäle werden nicht automatisch geladen.")}>
          <div className="dl-rule-source-selectors">
            {draft.source_mode === "selected" && <>
              <MultiSelectMenu values={draft.channel_ids} options={channelOptions} onChange={(channel_ids) => setDraft({ ...draft, channel_ids })} label={tx("Channels", "Kanały", "Kanäle")} searchable floating searchPlaceholder={tx("Search channels…", "Szukaj kanałów…", "Kanäle suchen…")} emptyLabel={tx("Choose channels", "Wybierz kanały", "Kanäle wählen")} summary={(selected) => `${selected.length} ${countNoun(selected.length, "channel", "channels", "kanał", "kanały", "kanałów", "Kanal", "Kanäle")}`} />
              <MultiSelectMenu values={draft.playlist_ids} options={playlistOptions} onChange={(playlist_ids) => setDraft({ ...draft, playlist_ids })} label={tx("Playlists", "Playlisty", "Playlists")} searchable floating searchPlaceholder={tx("Search playlists…", "Szukaj playlist…", "Playlists suchen…")} emptyLabel={tx("Choose playlists", "Wybierz playlisty", "Playlists wählen")} summary={(selected) => `${selected.length} ${countNoun(selected.length, "playlist", "playlists", "playlista", "playlisty", "playlist", "Playlist", "Playlists")}`} />
            </>}
            {draft.source_mode === "subscriptions" && <MultiSelectMenu values={draft.channel_ids} options={channelOptions} onChange={(channel_ids) => setDraft({ ...draft, channel_ids })} label={tx("Channel exceptions", "Wyjątki kanałów", "Kanalausnahmen")} searchable floating searchPlaceholder={tx("Search channels…", "Szukaj kanałów…", "Kanäle suchen…")} emptyLabel={tx("No exceptions", "Bez wyjątków", "Keine Ausnahmen")} summary={(selected) => selected.length === 0 ? tx("No exceptions", "Bez wyjątków", "Keine Ausnahmen") : tx(`${selected.length} excluded`, `${selected.length} wykluczonych`, `${selected.length} ausgeschlossen`)} />}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={tx("Matching", "Dopasowanie", "Abgleich")} description={tx("Required phrases narrow the result. Excluded phrases always win.", "Wymagane frazy zawężają wynik. Wykluczenia zawsze mają pierwszeństwo.", "Erforderliche Begriffe grenzen ein. Ausschlüsse haben immer Vorrang.")}>
        <SettingRow label={tx("Search in", "Szukaj w", "Suchen in")} description={tx("This area is used for both required and excluded phrases.", "Ten obszar dotyczy zarówno wymaganych, jak i wykluczanych fraz.", "Dieser Bereich gilt für erforderliche und ausgeschlossene Begriffe.")}>
          <SelectMenu label={tx("Search in", "Szukaj w", "Suchen in")} value={draft.match_field} onChange={(match_field) => setDraft({ ...draft, match_field })} options={[{ value: "title", label: tx("Title", "Tytuł", "Titel") }, { value: "description", label: tx("Description", "Opis", "Beschreibung") }, { value: "both", label: tx("Title and description", "Tytuł i opis", "Titel und Beschreibung") }]} />
        </SettingRow>
        <SettingRow htmlFor="download-rule-includes" align="start" label={tx("Required phrases", "Wymagane frazy", "Erforderliche Begriffe")} description={tx("Leave empty to accept every standard video from the selected sources.", "Zostaw puste, aby przyjmować każdy standardowy film z wybranych źródeł.", "Leer lassen, um jedes Standardvideo der Quellen zu akzeptieren.")}>
          <div className="dl-rule-control-stack">
            <Textarea id="download-rule-includes" value={includeText} onChange={(event) => { setIncludeText(event.target.value); setDraft({ ...draft, include_keywords: parseKeywords(event.target.value) }); }} placeholder={tx("One phrase per line", "Jedna fraza w wierszu", "Eine Phrase pro Zeile")} />
            {draft.include_keywords.length > 1 && <SegmentedControl label={tx("Keyword matching", "Dopasowanie słów", "Begriffsabgleich")} value={draft.keyword_mode} onChange={(keyword_mode) => setDraft({ ...draft, keyword_mode })} options={[{ value: "any", label: tx("Any phrase", "Dowolna fraza", "Beliebige Phrase") }, { value: "all", label: tx("All phrases", "Wszystkie frazy", "Alle Phrasen") }]} />}
          </div>
        </SettingRow>
        <SettingRow htmlFor="download-rule-excludes" align="start" label={tx("Always exclude", "Zawsze wyklucz", "Immer ausschließen")} description={tx("Use simple phrases — no regular expressions required.", "Użyj prostych fraz — bez wyrażeń regularnych.", "Einfache Begriffe genügen, reguläre Ausdrücke sind nicht nötig.")}>
          <Textarea id="download-rule-excludes" value={excludeText} onChange={(event) => { setExcludeText(event.target.value); setDraft({ ...draft, exclude_keywords: parseKeywords(event.target.value) }); }} placeholder={tx("trailer\nreaction\nspoilers", "zwiastun\nreakcja\nspoilery", "Trailer\nReaktion\nSpoiler")} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={tx("Video scope", "Zakres materiałów", "Videoumfang")} description={tx("Standard videos are always included. Add other types only when you want them too.", "Standardowe filmy są uwzględniane zawsze. Pozostałe typy możesz dodać opcjonalnie.", "Standardvideos sind immer enthalten. Weitere Typen können optional ergänzt werden.")}>
        <SettingRow align="start" label={tx("Additional types", "Dodatkowe typy", "Zusätzliche Typen")} description={tx("These extend the rule beyond standard videos.", "Te opcje rozszerzają regułę poza standardowe filmy.", "Diese Optionen erweitern die Regel über Standardvideos hinaus.")}>
          <div className="dl-rule-checkboxes">
            <Checkbox label="Shorts" description={tx("Include Shorts in addition to standard videos.", "Pobieraj Shorts dodatkowo, obok standardowych filmów.", "Shorts zusätzlich zu Standardvideos laden.")} checked={draft.include_shorts} onChange={(event) => setDraft({ ...draft, include_shorts: event.target.checked })} />
            <Checkbox label={tx("Members-only videos", "Filmy tylko dla wspierających", "Videos nur für Mitglieder")} description={tx("Include them in addition to standard videos. Requires working YouTube cookies and channel access.", "Pobieraj je dodatkowo, obok standardowych filmów. Wymaga działających cookies i dostępu do kanału.", "Zusätzlich zu Standardvideos laden. Erfordert Cookies und Kanalzugriff.")} checked={draft.include_members_only} onChange={(event) => setDraft({ ...draft, include_members_only: event.target.checked })} />
          </div>
        </SettingRow>
        <SettingRow htmlFor="download-rule-min-duration" label={tx("Minimum duration", "Minimalna długość", "Mindestlänge")} description={tx("0 means no duration limit.", "0 oznacza brak limitu długości.", "0 bedeutet kein Längenlimit.")}>
          <InputGroup suffix="min"><Input id="download-rule-min-duration" type="number" min={0} max={1440} value={Math.floor(draft.min_duration_seconds / 60)} onChange={(event) => setDraft({ ...draft, min_duration_seconds: Math.max(0, Number(event.target.value) || 0) * 60 })} /></InputGroup>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={tx("Starting point", "Zakres czasowy", "Startpunkt")} description={tx("Choose whether the first run may add older videos to the queue.", "Zdecyduj, czy pierwsze uruchomienie może dodać do kolejki starsze materiały.", "Lege fest, ob der erste Lauf ältere Videos einreihen darf.")}>
        <OptionPicker
          className="dl-rule-option-picker"
          label={tx("Starting point", "Punkt startowy", "Startpunkt")}
          value={draft.backfill_mode}
          onChange={(backfill_mode) => setDraft({ ...draft, backfill_mode })}
          columns={3}
          options={[
            { value: "future", label: tx("From now on", "Od teraz", "Ab jetzt"), description: tx("Only videos uploaded after saving.", "Tylko materiały opublikowane po zapisaniu.", "Nur nach dem Speichern veröffentlichte Videos.") },
            { value: "recent", label: tx("Recent and future", "Ostatnie i przyszłe", "Letzte und zukünftige"), description: tx("Also include a configurable recent period.", "Uwzględnij też wybrany okres wstecz.", "Zusätzlich einen wählbaren Zeitraum einbeziehen.") },
            { value: "all", label: tx("All known and future", "Wszystkie znane i przyszłe", "Alle bekannten und zukünftigen"), description: tx("May queue the entire known library.", "Może zakolejkować całą znaną bibliotekę.", "Kann die gesamte bekannte Bibliothek einreihen.") },
          ]}
        />
        {draft.backfill_mode === "recent" && <SettingRow label={tx("Look back", "Sięgnij wstecz", "Rückblick")} description={tx("How far back should the first run search?", "Jak daleko wstecz ma sięgnąć pierwsze uruchomienie?", "Wie weit soll der erste Lauf zurückblicken?")} htmlFor="download-rule-lookback"><InputGroup suffix="h"><Input id="download-rule-lookback" type="number" min={1} max={8760} value={draft.lookback_hours} onChange={(event) => setDraft({ ...draft, lookback_hours: Math.max(1, Number(event.target.value) || 1) })} /></InputGroup></SettingRow>}
      </SettingsSection>

      <section className="dl-rule-preview" aria-live="polite">
        <div className="dl-rule-preview-head"><div><strong>{tx("Real preview", "Rzeczywisty podgląd", "Echte Vorschau")}</strong><span>{tx("Calculated by the same matcher that fills the queue.", "Liczony przez ten sam mechanizm, który zasila kolejkę.", "Vom selben Mechanismus berechnet, der die Warteschlange füllt.")}</span></div></div>
        {!sourceReady ? <Alert variant="warning" icon={<AlertTriangle />}>{tx("Select at least one source.", "Wybierz co najmniej jedno źródło.", "Wähle mindestens eine Quelle.")}</Alert>
          : previewError ? <Alert variant="danger" icon={<AlertTriangle />}>{previewError}</Alert>
          : !preview ? <div className="dl-rule-preview-loading">{tx("Calculating…", "Przeliczam…", "Berechnung…")}</div>
        : <div className={`dl-rule-preview-content${previewing ? " is-updating" : ""}`}><div className="dl-rule-preview-counts"><span><strong>{preview.limited && "≥"}{preview.matches}</strong>{` ${countNoun(preview.matches, "match", "matches", "dopasowanie", "dopasowania", "dopasowań", "Treffer", "Treffer")}`}</span><span className="ready"><strong>{preview.limited && "≥"}{preview.ready}</strong>{tx(" will enter the queue", " trafi do kolejki", " kommen in die Warteschlange")}</span><span><strong>{preview.existing}</strong>{` ${countNoun(preview.existing, "already handled", "already handled", "już obsłużony", "już obsłużone", "już obsłużonych", "bereits verarbeitet", "bereits verarbeitet")}`}</span></div>{preview.limited && <div className="dl-rule-preview-note">{tx("Large result: counts are a safe lower bound and the queue will be filled in batches.", "Duży wynik: liczniki są bezpiecznym minimum, a kolejka będzie uzupełniana partiami.", "Großes Ergebnis: Die Zahlen sind eine Untergrenze; die Warteschlange wird stapelweise gefüllt.")}</div>}{draft.enabled && preview.ready > 0 && <Alert variant="warning" icon={<AlertTriangle />}>{tx(`Saving will activate the rule and ${readyDisplay} videos will begin entering the queue.`, `Zapis uruchomi regułę — ${readyDisplay} materiałów zacznie trafiać do kolejki.`, `Beim Speichern wird die Regel aktiviert; ${readyDisplay} Videos kommen in die Warteschlange.`)}</Alert>}{preview.sample.length > 0 && <div className="dl-rule-preview-sample">{preview.sample.slice(0, 4).map((video) => <div key={video.video_id}><img src={img(video.thumbnail)} alt="" /><span>{video.title}</span>{video.download_status && <Check />}</div>)}</div>}</div>}
        {sourceReady && !previewError && previewing && preview && <div className="dl-rule-preview-updating">{tx("Updating preview…", "Aktualizuję podgląd…", "Vorschau wird aktualisiert…")}</div>}
      </section>
      {error && <Alert variant="danger">{error}</Alert>}
      <FormActions align="between"><Button onClick={() => setEditingId(null)} leadingIcon={<X />}>{tx("Cancel", "Anuluj", "Abbrechen")}</Button>{draft.enabled && preview && preview.ready >= 10 ? <Popconfirm message={tx(`Activate this rule and start queueing ${readyDisplay} videos?`, `Uruchomić regułę i zacząć kolejkować ${readyDisplay} materiałów?`, `Regel aktivieren und ${readyDisplay} Videos einreihen?`)} confirmLabel={tx("Activate", "Uruchom", "Aktivieren")} confirmVariant="primary" onConfirm={() => void save()}><Button variant="primary" disabled={saveDisabled} leadingIcon={<Download />}>{saving ? tx("Saving…", "Zapisuję…", "Speichern…") : tx("Save and activate", "Zapisz i uruchom", "Speichern und aktivieren")}</Button></Popconfirm> : <Button variant="primary" disabled={saveDisabled} onClick={save} leadingIcon={<Download />}>{saving ? tx("Saving…", "Zapisuję…", "Speichern…") : draft.enabled ? tx("Save and activate", "Zapisz i uruchom", "Speichern und aktivieren") : tx("Save as inactive", "Zapisz jako nieaktywną", "Deaktiviert speichern")}</Button>}</FormActions>
    </div>
  );

  return (
    <div className="dl-automation">
      <div className="dl-automation-intro"><div><h2>{tx("Automatic downloads", "Automatyczne pobieranie", "Automatische Downloads")}</h2><p>{tx("Rules are combined with OR: a video is downloaded when any enabled rule matches. Exclusions are local to their rule. An enabled rule may start with a short delay.", "Reguły łączą się przez „lub”: film zostanie pobrany, gdy pasuje do dowolnej włączonej reguły. Wykluczenia dotyczą konkretnej reguły. Włączona reguła może uruchomić się z niewielkim opóźnieniem.", "Regeln werden mit ODER verbunden: Ein Video wird geladen, wenn eine aktive Regel passt. Ausschlüsse gelten nur für ihre Regel. Eine aktivierte Regel kann mit kurzer Verzögerung starten.")}</p></div>{canManage && <Button variant="primary" onClick={() => edit()} leadingIcon={<Plus />}>{tx("New rule", "Nowa reguła", "Neue Regel")}</Button>}</div>
      {!canManage && <Alert variant="info">{tx("Automatic downloads are not available for this profile.", "Automatyczne pobieranie nie jest dostępne dla tego profilu.", "Automatische Downloads sind für dieses Profil nicht verfügbar.")}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
      {rules.length === 0 ? <EmptyState icon={<Download />} title={tx("No automatic downloads", "Brak automatycznych pobrań", "Keine automatischen Downloads")} description={tx("Create a rule and preview exactly what it will add to the queue.", "Utwórz regułę i zobacz dokładnie, co trafi do kolejki.", "Erstelle eine Regel und prüfe genau, was eingereiht wird.")} action={canManage ? <Button variant="primary" onClick={() => edit()}>{tx("Create first rule", "Utwórz pierwszą regułę", "Erste Regel erstellen")}</Button> : undefined} /> : <div className="dl-rule-list">{rules.map((rule) => {
        const source = rule.source_mode === "subscriptions" ? (rule.channel_ids.length ? tx(`All subscriptions except ${rule.channel_ids.length}`, `Wszystkie subskrypcje oprócz ${rule.channel_ids.length}`, `Alle Abos außer ${rule.channel_ids.length}`) : tx("All subscriptions", "Wszystkie subskrypcje", "Alle Abos")) : `${rule.channel_ids.length} ${countNoun(rule.channel_ids.length, "channel", "channels", "kanał", "kanały", "kanałów", "Kanal", "Kanäle")} · ${rule.playlist_ids.length} ${countNoun(rule.playlist_ids.length, "playlist", "playlists", "playlista", "playlisty", "playlist", "Playlist", "Playlists")}`;
        const condition = rule.include_keywords.length ? tx(`${rule.keyword_mode === "all" ? "All" : "Any"} of: ${rule.include_keywords.join(", ")}`, `${rule.keyword_mode === "all" ? "Wszystkie" : "Dowolne"}: ${rule.include_keywords.join(", ")}`, `${rule.keyword_mode === "all" ? "Alle" : "Beliebige"}: ${rule.include_keywords.join(", ")}`) : tx("Every video", "Każdy materiał", "Jedes Video");
        return <article key={rule.id} className={`dl-rule-card${rule.enabled ? "" : " is-disabled"}`}><div className="dl-rule-card-main"><div className="dl-rule-card-title"><strong>{rule.name}</strong><Badge size="sm">{rule.backfill_mode === "future" ? tx("from now", "od teraz", "ab jetzt") : rule.backfill_mode === "recent" ? `${rule.lookback_hours} h` : tx("all known", "wszystkie znane", "alle bekannten")}</Badge></div><div className="dl-rule-flow"><span>{source}</span><i>→</i><span>{condition}</span>{rule.exclude_keywords.length > 0 && <><i>→</i><span className="exclude">{tx("except", "oprócz", "außer")}: {rule.exclude_keywords.join(", ")}</span></>}</div></div>{canManage && <div className="dl-rule-card-actions"><Switch ariaLabel={rule.enabled ? tx(`Disable ${rule.name}`, `Wyłącz ${rule.name}`, `${rule.name} deaktivieren`) : tx(`Enable ${rule.name}`, `Włącz ${rule.name}`, `${rule.name} aktivieren`)} checked={rule.enabled} onCheckedChange={(enabled) => void toggle(rule, enabled)} /><IconButton label={tx("Edit", "Edytuj", "Bearbeiten")} onClick={() => edit(rule)}><Pencil /></IconButton><Popconfirm message={tx(`Delete “${rule.name}”?`, `Usunąć „${rule.name}”?`, `„${rule.name}“ löschen?`)} onConfirm={() => api.removeDownloadRule(rule.id).then(load)}><IconButton label={tx("Delete", "Usuń", "Löschen")}><Trash2 /></IconButton></Popconfirm></div>}</article>;
      })}</div>}
    </div>
  );
}
