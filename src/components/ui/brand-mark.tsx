export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      {/* The mark is the artwork itself, corners already rounded by
          scripts/generate-icons.mjs at this same 28% radius. */}
      <image href="/icons/brand-mark.png" width="32" height="32" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        fill="none"
        className="stroke-accent/40"
        strokeWidth="1"
      />
    </svg>
  );
}
