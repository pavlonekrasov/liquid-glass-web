import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  filled?: boolean;
}

export function HomeIcon({ size = 20, filled = false, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M3.75 10.6L12 3.5l8.25 7.1v8.65a1.5 1.5 0 0 1-1.5 1.5h-4.5v-5.5a2.25 2.25 0 0 0-4.5 0v5.5h-4.5a1.5 1.5 0 0 1-1.5-1.5V10.6Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 1.6 : 1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <circle cx="11" cy="11" r="6.75" stroke="currentColor" strokeWidth="2.1" />
      <path d="M16.2 16.2L20.5 20.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon({ size = 20, filled = false, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M12 20.4s-7.5-4.65-7.5-10.3A4.35 4.35 0 0 1 12 7.25a4.35 4.35 0 0 1 7.5 2.85c0 5.65-7.5 10.3-7.5 10.3Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 1.6 : 1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LayersIcon({ size = 20, filled = false, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M12 3.75 3.75 8.25 12 12.75l8.25-4.5L12 3.75Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.75 12.5 12 17l8.25-4.5M3.75 16.75 12 21.25l8.25-4.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GripIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function GitHubIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.589 2 12.248c0 4.528 2.865 8.37 6.839 9.725.5.095.683-.222.683-.493 0-.243-.009-.887-.014-1.741-2.782.619-3.369-1.375-3.369-1.375-.455-1.183-1.11-1.498-1.11-1.498-.908-.636.069-.623.069-.623 1.003.072 1.531 1.055 1.531 1.055.892 1.566 2.341 1.114 2.91.852.091-.662.349-1.114.635-1.37-2.221-.259-4.555-1.138-4.555-5.064 0-1.118.39-2.033 1.029-2.75-.103-.259-.446-1.301.098-2.712 0 0 .84-.276 2.75 1.051A9.364 9.364 0 0 1 12 6.844c.85.004 1.705.118 2.504.345 1.909-1.327 2.748-1.051 2.748-1.051.545 1.411.202 2.453.1 2.712.64.717 1.028 1.632 1.028 2.75 0 3.936-2.338 4.802-4.566 5.056.359.317.679.942.679 1.899 0 1.371-.012 2.477-.012 2.814 0 .274.18.593.688.492C19.138 20.614 22 16.774 22 12.248 22 6.589 17.523 2 12 2Z"
      />
    </svg>
  );
}
