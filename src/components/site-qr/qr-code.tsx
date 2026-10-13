import qrcode from "qrcode-generator";

/**
 * A QR code as crisp inline SVG — prints sharp at any size, works in server
 * and client components, no canvas or image request. Error correction "M"
 * survives a scuffed or rained-on job-site sign; the 4-module quiet zone is
 * what phone cameras need to find the code.
 */
export function QrCode({
  value,
  className,
  title = "QR code",
}: {
  value: string;
  className?: string;
  title?: string;
}) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4;
  const size = count + quiet * 2;

  // One path, one 1×1 square per dark module.
  let d = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
