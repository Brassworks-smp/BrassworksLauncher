export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/brassworks-logo.png"
      alt="Brassworks"
      width={size}
      height={size}
      className={`pixelated ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
