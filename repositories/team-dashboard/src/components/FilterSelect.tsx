import { useId } from 'react';
export type FilterOption = Readonly<{ value: string; label: string; disabled?: boolean }>;
export function FilterSelect({ label, value, options, onChange, description, disabled = false }: {
  label: string; value: string; options: readonly FilterOption[]; onChange: (value: string) => void; description?: string; disabled?: boolean;
}) {
  const id = useId(); const descriptionId = `${id}-description`;
  return <div className="td-filter"><label htmlFor={id}>{label}</label>
    <select id={id} value={value} disabled={disabled} aria-describedby={description ? descriptionId : undefined} onChange={(event) => {
      if (!disabled && options.some((option) => option.value === event.target.value && !option.disabled)) onChange(event.target.value);
    }}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>
    {description && <p id={descriptionId}>{description}</p>}
  </div>;
}
