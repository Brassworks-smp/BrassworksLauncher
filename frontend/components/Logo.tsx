export function Logo({ size = 28 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
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
