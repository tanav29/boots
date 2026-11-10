export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "brand-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M10 21.5v-7a4.5 4.5 0 0 1 9 0v11a4.5 4.5 0 0 0 9 0v-7"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="28" cy="10" r="2.7" fill="currentColor" />
      </svg>
    </span>
  );
}
