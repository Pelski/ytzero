import { useI18n } from "../i18n";

export default function SubscriptionTagFilter({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <button className={`subs-tag-filter-trigger${active ? " active" : ""}`} onClick={() => onChange(!active)}>
      {t("untaggedChannels")}
    </button>
  );
}
