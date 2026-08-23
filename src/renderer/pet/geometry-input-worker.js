let occupancy = new Uint8Array(0);
const previousRects = new Map();
const currentRects = new Map();

self.onmessage = event => {
  const startedAt = performance.now();
  const { buffer, length, width, height } = event.data;
  const triangles = new Float32Array(buffer);
  const rowHeight = Math.max(5, Math.ceil(height / 180));
  const horizontalGrid = 4;
  const padding = 3;
  const rowCount = Math.ceil(height / rowHeight);
  const columnCount = Math.ceil(width / horizontalGrid);
  const cellCount = rowCount * columnCount;
  if (occupancy.length < cellCount) occupancy = new Uint8Array(cellCount);
  else occupancy.fill(0, 0, cellCount);

  for (let triangleOffset = 0; triangleOffset + 5 < length; triangleOffset += 6) {
    const minimumY = Math.max(0, Math.min(triangles[triangleOffset + 1], triangles[triangleOffset + 3], triangles[triangleOffset + 5]) - padding);
    const maximumY = Math.min(height, Math.max(triangles[triangleOffset + 1], triangles[triangleOffset + 3], triangles[triangleOffset + 5]) + padding);
    const firstRow = Math.max(0, Math.floor(minimumY / rowHeight));
    const lastRow = Math.min(rowCount - 1, Math.floor(maximumY / rowHeight));
    for (let row = firstRow; row <= lastRow; row++) {
      const scanY = Math.max(minimumY, Math.min(maximumY, row * rowHeight + rowHeight / 2));
      let intersectionCount = 0;
      let minimumX = Infinity;
      let maximumX = -Infinity;
      for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3;
        const x1 = triangles[triangleOffset + edge * 2];
        const y1 = triangles[triangleOffset + edge * 2 + 1];
        const x2 = triangles[triangleOffset + next * 2];
        const y2 = triangles[triangleOffset + next * 2 + 1];
        if (y1 === y2 || scanY < Math.min(y1, y2) || scanY > Math.max(y1, y2)) continue;
        const intersection = x1 + (scanY - y1) * (x2 - x1) / (y2 - y1);
        minimumX = Math.min(minimumX, intersection);
        maximumX = Math.max(maximumX, intersection);
        intersectionCount += 1;
      }
      if (intersectionCount < 2) continue;
      const firstColumn = Math.max(0, Math.floor((minimumX - padding) / horizontalGrid));
      const lastColumn = Math.min(columnCount, Math.ceil((maximumX + padding) / horizontalGrid));
      if (lastColumn > firstColumn) {
        occupancy.fill(1, row * columnCount + firstColumn, row * columnCount + lastColumn);
      }
    }
  }

  const rects = [];
  previousRects.clear();
  currentRects.clear();
  for (let row = 0; row < rowCount; row++) {
    currentRects.clear();
    const rowOffset = row * columnCount;
    let column = 0;
    while (column < columnCount) {
      while (column < columnCount && occupancy[rowOffset + column] === 0) column += 1;
      if (column >= columnCount) break;
      const firstColumn = column;
      while (column < columnCount && occupancy[rowOffset + column] !== 0) column += 1;
      const lastColumn = column;
      const key = firstColumn * (columnCount + 1) + lastColumn;
      const previous = previousRects.get(key);
      if (previous) {
        previous.height = Math.min(height - previous.y, previous.height + rowHeight);
        currentRects.set(key, previous);
      } else {
        const rect = {
          x: firstColumn * horizontalGrid,
          y: row * rowHeight,
          width: Math.min(width, lastColumn * horizontalGrid) - firstColumn * horizontalGrid,
          height: Math.min(rowHeight, height - row * rowHeight)
        };
        rects.push(rect);
        currentRects.set(key, rect);
      }
    }
    previousRects.clear();
    for (const [key, rect] of currentRects) previousRects.set(key, rect);
  }

  self.postMessage({
    buffer,
    rects,
    elapsed: performance.now() - startedAt
  }, [buffer]);
};
