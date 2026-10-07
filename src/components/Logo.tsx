import Image from "next/image";

/** VOLUMEPAD mark: the rendered nickel podium of three volume bars with a red bowl on the tallest (brand/logo-1024.png). */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return <Image src="/mark.png" alt="" width={64} height={64} className={`${className} object-contain`} priority />;
}

/** Flat version for small sizes and dark grounds (same drawing as src/app/icon.svg). */
export function FlatMark({ className = "h-8 w-8", bars = "#111313" }: { className?: string; bars?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="10" y="30" width="12" height="22" rx="5" fill={bars} />
      <rect x="26" y="18" width="12" height="34" rx="5" fill={bars} />
      <rect x="42" y="25" width="12" height="27" rx="5" fill={bars} />
      <ellipse cx="32" cy="15" rx="9" ry="4.5" fill="none" stroke="#FF3D2E" strokeWidth="4" />
    </svg>
  );
}
