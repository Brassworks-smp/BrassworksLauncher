export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/brassworks-logo.png"
      alt="Brassworks"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, imageRendering: "auto" }}
    />
  );
}
