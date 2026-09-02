// Renders an encodeQr() module grid as a real SVG string -- the simplest
// way to display a QR code in a browser page with no <canvas> setup,
// scales cleanly at any size, and is easy to embed directly in HTML.
export function qrToSvg({ size, modules }, { moduleSize = 8, margin = 4, darkColor = '#0b0f14', lightColor = '#ffffff' } = {}) {
  const px = size * moduleSize + margin * 2 * moduleSize;
  const rects = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      const x = (c + margin) * moduleSize;
      const y = (r + margin) * moduleSize;
      rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${px}" height="${px}" fill="${lightColor}"/><g fill="${darkColor}">${rects.join('')}</g></svg>`;
}
