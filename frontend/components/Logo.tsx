export function Logo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/brassworks-logo.png"
      alt="Brassworks"
      width={size}
      height={size}
      className="pixelated"
      style={{ width: size, height: size }}
    />
  );
}
