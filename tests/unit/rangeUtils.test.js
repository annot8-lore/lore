"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const rangeUtils_1 = require("../../src/rangeUtils");
(0, vitest_1.describe)('shiftRange', () => {
    // ── No-op cases ──────────────────────────────────────────────────────────
    (0, vitest_1.it)('returns unchanged range when delta is 0', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 3, 0)).toEqual({ start: 5, end: 10 });
    });
    (0, vitest_1.it)('returns unchanged range when edit is below the annotation', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 12, 3)).toEqual({ start: 5, end: 10 });
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 12, -2)).toEqual({ start: 5, end: 10 });
    });
    // ── Edit above annotation ────────────────────────────────────────────────
    (0, vitest_1.it)('shifts both start and end when edit is above annotation (insertion)', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 2, 3)).toEqual({ start: 8, end: 13 });
    });
    (0, vitest_1.it)('shifts both start and end when edit is above annotation (deletion)', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 2, -2)).toEqual({ start: 3, end: 8 });
    });
    (0, vitest_1.it)('clamps start to 0 when large deletion above would go negative', () => {
        const result = (0, rangeUtils_1.shiftRange)(2, 4, 0, -10);
        (0, vitest_1.expect)(result.start).toBe(0);
        (0, vitest_1.expect)(result.end).toBeGreaterThanOrEqual(0);
    });
    // ── Edit inside annotation ───────────────────────────────────────────────
    (0, vitest_1.it)('expands end only when lines inserted at annotation start', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 5, 2)).toEqual({ start: 5, end: 12 });
    });
    (0, vitest_1.it)('expands end only when lines inserted in the middle of annotation', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 7, 2)).toEqual({ start: 5, end: 12 });
    });
    (0, vitest_1.it)('shrinks end only when lines deleted inside annotation', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 10, 7, -2)).toEqual({ start: 5, end: 8 });
    });
    (0, vitest_1.it)('clamps end to start when entire annotation content deleted', () => {
        const result = (0, rangeUtils_1.shiftRange)(5, 10, 5, -20);
        (0, vitest_1.expect)(result.end).toBeGreaterThanOrEqual(result.start);
    });
    // ── Single-line annotations ──────────────────────────────────────────────
    (0, vitest_1.it)('shifts a single-line annotation when edit is above', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 5, 2, 1)).toEqual({ start: 6, end: 6 });
    });
    (0, vitest_1.it)('leaves a single-line annotation unchanged when edit is below', () => {
        (0, vitest_1.expect)((0, rangeUtils_1.shiftRange)(5, 5, 8, -2)).toEqual({ start: 5, end: 5 });
    });
    // ── Edge: edit at exactly annotation start boundary ──────────────────────
    (0, vitest_1.it)('treats edit at changeStart === start as "inside" (expands end, not start)', () => {
        const result = (0, rangeUtils_1.shiftRange)(5, 10, 5, 3);
        // changeStart (5) >= start (5) and <= end (10), so only end shifts
        (0, vitest_1.expect)(result.start).toBe(5);
        (0, vitest_1.expect)(result.end).toBe(13);
    });
});
//# sourceMappingURL=rangeUtils.test.js.map