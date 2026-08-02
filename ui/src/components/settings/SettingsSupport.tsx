import { useI18n } from "../../i18n";
import { SettingsSection } from "../ui";


type LogLevel = "INFO" | "WARN" | "ERROR";

function JsonHighlight({ json }: { json: string }) {
  const tokens = json.match(/"[^"\\]*(?:\\.[^"\\]*)*"(?=\s*:)|"[^"\\]*(?:\\.[^"\\]*)*"|-?\d+(?:\.\d+)?|true|false|null|[{}[\]:,]/g);
  if (!tokens) return <>{json}</>;
  return (
    <>
      {tokens.map((token, i) => {
        const isKey = /^"/.test(token) && tokens[i + 1] === ":";
        const cls =
          isKey ? "json-key" :
          /^"/.test(token) ? "json-string" :
          /^(true|false|null)$/.test(token) ? "json-literal" :
          /^-?\d/.test(token) ? "json-number" :
          "json-punctuation";
        return <span key={`${i}-${token}`} className={cls}>{token}</span>;
      })}
    </>
  );
}

export function LogLine({ line }: { line: string }) {
  const match = line.match(/^(\S+)\s+(INFO|WARN|ERROR)\s+([^\s]+)(?:\s+(.*))?$/);
  if (!match) return <div className="log-line log-line--raw">{line}</div>;

  const [, timestamp, level, event, rawMeta] = match as [string, string, LogLevel, string, string | undefined];

  return (
    <div className={`log-line log-line--${level.toLowerCase()}`}>
      <span className="log-time">{timestamp}</span>
      <span className="log-level">{level}</span>
      <span className="log-event">{event}</span>
      {rawMeta ? (
        <span className="log-json"><JsonHighlight json={rawMeta} /></span>
      ) : null}
    </div>
  );
}

export function ChangelogNote({ children }: { children: string }) {
  return <>{children.split(/(#\d+)/g).map((part, index) => {
    const issue = part.match(/^#(\d+)$/);
    return issue ? (
      <a className="settings-release-note-link" href={`https://github.com/Pelski/ytzero/issues/${issue[1]}`} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a>
    ) : part;
  })}</>;
}

export function SettingsLoadingState() {
  const { t } = useI18n();
  const navGroups = [5, 7, 3, 4];
  return <div className="settings-shell settings-loading" aria-busy="true" aria-label={t("loading")}>
    <div className="settings-loading-nav" aria-hidden="true">
      <div className="settings-loading-nav-desktop">
        {navGroups.map((itemCount, group) => <div className="settings-loading-nav-group" key={group}>
          <div className="skeleton settings-loading-nav-label" />
          <div className="settings-loading-nav-items">
            {Array.from({ length: itemCount }, (_, item) => <div className="settings-loading-nav-item" key={item}>
              <div className="skeleton settings-loading-nav-item-line" />
            </div>)}
          </div>
        </div>)}
      </div>
      <div className="skeleton settings-loading-nav-mobile" />
    </div>
    <div className="settings-shell__content settings-loading-content">
      {Array.from({ length: 2 }, (_, section) => <SettingsSection className="settings-loading-section" key={section}>
        <div className="skeleton settings-loading-heading" aria-hidden="true" />
        {Array.from({ length: section === 0 ? 4 : 3 }, (_, row) => <div className="settings-loading-row" aria-hidden="true" key={row}>
          <div className="settings-loading-copy">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
          <div className="skeleton settings-loading-control" />
        </div>)}
      </SettingsSection>)}
    </div>
  </div>;
}

