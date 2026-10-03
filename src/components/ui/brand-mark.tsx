export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        width="32"
        height="32"
        rx="9"
        className="fill-accent-soft stroke-accent/40"
        strokeWidth="1"
      />
      <path
        d="M16 6.5l2.36 4.78 5.28.77-3.82 3.72.9 5.26L16 18.44l-4.72 2.59.9-5.26-3.82-3.72 5.28-.77L16 6.5z"
        className="fill-accent"
      />
    </svg>
  );
}
