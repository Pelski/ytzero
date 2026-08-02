import { useLayoutEffect } from "react";
import { Play } from "lucide-react";
import { useI18n } from "../i18n";

export default function AppBootstrap() {
  const { t } = useI18n();

  useLayoutEffect(() => {
    document.title = t("loading");
  }, [t]);

  return (
    <div className="app-bootstrap" role="status" aria-label={t("loading")}>
      <span className="app-bootstrap-mark" aria-hidden="true"><Play fill="currentColor" /></span>
    </div>
  );
}
