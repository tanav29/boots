export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 text-violet-600 ${small ? "size-7" : "size-8"}`}
      aria-hidden="true"
    >
      <svg className="size-full" viewBox="0 0 40 40" fill="none">
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
