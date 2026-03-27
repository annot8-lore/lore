/**
 * Pure utility for shifting a lore annotation's line range after a document edit.
 * All line numbers are 0-based (matching vscode.Range).
 *
 * @param start       Current start line (0-based)
 * @param end         Current end line (0-based)
 * @param changeStart First line affected by the edit (0-based)
 * @param delta       Net line count change (positive = lines inserted, negative = deleted)
 */
export function shiftRange(
    start: number,
    end: number,
    changeStart: number,
    delta: number,
): { start: number; end: number } {
    if (delta === 0) { return { start, end }; }

    let newStart = start;
    let newEnd = end;

    if (changeStart < start) {
        // Edit is entirely above the annotation — shift both boundaries.
        newStart += delta;
        newEnd += delta;
    } else if (changeStart >= start && changeStart <= end) {
        // Edit starts inside the annotation — expand/contract the end only.
        newEnd += delta;
    }
    // Edit is below the annotation — no change needed.

    if (newStart < 0) { newStart = 0; }
    if (newEnd < newStart) { newEnd = newStart; }

    return { start: newStart, end: newEnd };
}
