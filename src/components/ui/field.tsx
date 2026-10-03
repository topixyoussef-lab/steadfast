import { cn } from "@/lib/cn";

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  errors?: string[];
  hint?: string;
  minLength?: number;
  maxLength?: number;
};

export function Field({
  label,
  name,
  type = "text",
  placeholder,
  autoComplete,
  required,
  defaultValue,
  errors,
  hint,
  minLength,
  maxLength,
}: FieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = errors?.length ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        defaultValue={defaultValue}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-12 w-full rounded-xl border bg-sunken px-4 text-base text-ink",
          "placeholder:text-faint transition-colors",
          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
          errors?.length ? "border-danger" : "border-line",
        )}
      />
      {errors?.length ? (
        <p id={errorId} className="text-sm text-danger">
          {errors[0]}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {message}
    </div>
  );
}
