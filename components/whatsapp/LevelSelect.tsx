import { ACCESS_LEVEL_HINTS, ACCESS_LEVEL_LABELS, ACCESS_LEVELS } from "@/lib/ai/models";
import { AccessLevel, Company } from "@/types/database";

export function LevelSelect({
  id = "access_level",
  defaultValue = "publico",
  label = "Nivel de acceso",
}: {
  id?: string;
  defaultValue?: AccessLevel;
  label?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name="access_level" defaultValue={defaultValue} className="input">
        {ACCESS_LEVELS.map((level) => (
          <option key={level} value={level}>
            {ACCESS_LEVEL_LABELS[level]} — {ACCESS_LEVEL_HINTS[level]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CompanySelect({
  id = "company_id",
  companies,
  defaultValue,
  label,
  emptyLabel,
}: {
  id?: string;
  companies: Pick<Company, "id" | "name">[];
  defaultValue?: string | null;
  label: string;
  emptyLabel: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name="company_id" defaultValue={defaultValue ?? ""} className="input">
        <option value="">{emptyLabel}</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
