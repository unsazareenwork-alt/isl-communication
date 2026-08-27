interface LogoProps {
  size?: number;
  variant?: "default" | "on-dark";
  showWordmark?: boolean;
}

export function Logo({ size = 36, variant = "default", showWordmark = true }: LogoProps) {
  const onDark = variant === "on-dark";
  return (
    <span className="logo">
      <span className="logo__mark">
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="#1E40AF" />
          <circle cx="24" cy="27" r="9" fill="#FFFFFF" />
          <circle cx="40" cy="27" r="9" fill="#FFFFFF" fillOpacity="0.55" />
          <g stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round">
            <path d="M24 35c-5 0-8 2.6-8 7v3" />
            <path d="M40 35c5 0 8 2.6 8 7v3" />
          </g>
          <path d="M28 45v9" stroke="#16A34A" strokeWidth="4.5" strokeLinecap="round" />
          <path d="M36 45v9" stroke="#16A34A" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      </span>
      {showWordmark && (
        <span className="logo__wordmark" data-on-dark={onDark || undefined}>
          ISL&nbsp;Connect
        </span>
      )}
    </span>
  );
}
