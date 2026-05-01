/**
 * Grid cell-walk — emits one world-space coordinate per cell boundary
 * the cursor crosses between two grid cells along a single axis.
 *
 * Used by `BoxEnvironment` to detect grid-line crossings as the cursor
 * sweeps across a wall: when the cursor moves from cell N to cell M
 * (M ≠ N), it crosses |M − N| grid lines, and each one becomes a
 * captured segment in the rubber-band release effect.
 *
 * The previous implementation used an unbounded `while (cell !==
 * toCell)` loop. With float-precision drift, a degenerate
 * (`fromCell` and `toCell` derived from `Math.floor` on values close
 * to a cell boundary) call could in principle fail to converge and
 * hang the frame. This helper has an explicit step cap equal to
 * `Math.abs(toCell - fromCell)` and a defensive `cell !== toCell`
 * loop guard, so the loop is provably finite by construction.
 */
export function walkCellCrossings(
  fromCell: number,
  toCell: number,
  spacing: number,
  onCrossing: (coord: number) => void,
): number {
  if (fromCell === toCell) {
    return 0;
  }
  const dir = Math.sign(toCell - fromCell);
  const steps = Math.abs(toCell - fromCell);
  let cell = fromCell;
  let count = 0;
  for (let i = 0; i < steps && cell !== toCell; i++) {
    // `dir > 0 ? 1 : 0` keeps the crossing on the leading edge of
    // the cell we're entering. e.g. moving from cell 3 to cell 5
    // crosses lines at coord 4·spacing and 5·spacing (the +1
    // offset). Moving back from 5 to 3 crosses 5·spacing then
    // 4·spacing (the +0 offset, since we read the leaving edge).
    const coord = (cell + (dir > 0 ? 1 : 0)) * spacing;
    onCrossing(coord);
    cell += dir;
    count++;
  }
  return count;
}
