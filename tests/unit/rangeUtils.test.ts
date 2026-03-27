import { describe, it, expect } from 'vitest';
import { shiftRange } from '../../src/rangeUtils';

describe('shiftRange', () => {
    // ── No-op cases ──────────────────────────────────────────────────────────

    it('returns unchanged range when delta is 0', () => {
        expect(shiftRange(5, 10, 3, 0)).toEqual({ start: 5, end: 10 });
    });

    it('returns unchanged range when edit is below the annotation', () => {
        expect(shiftRange(5, 10, 12, 3)).toEqual({ start: 5, end: 10 });
        expect(shiftRange(5, 10, 12, -2)).toEqual({ start: 5, end: 10 });
    });

    // ── Edit above annotation ────────────────────────────────────────────────

    it('shifts both start and end when edit is above annotation (insertion)', () => {
        expect(shiftRange(5, 10, 2, 3)).toEqual({ start: 8, end: 13 });
    });

    it('shifts both start and end when edit is above annotation (deletion)', () => {
        expect(shiftRange(5, 10, 2, -2)).toEqual({ start: 3, end: 8 });
    });

    it('clamps start to 0 when large deletion above would go negative', () => {
        const result = shiftRange(2, 4, 0, -10);
        expect(result.start).toBe(0);
        expect(result.end).toBeGreaterThanOrEqual(0);
    });

    // ── Edit inside annotation ───────────────────────────────────────────────

    it('expands end only when lines inserted at annotation start', () => {
        expect(shiftRange(5, 10, 5, 2)).toEqual({ start: 5, end: 12 });
    });

    it('expands end only when lines inserted in the middle of annotation', () => {
        expect(shiftRange(5, 10, 7, 2)).toEqual({ start: 5, end: 12 });
    });

    it('shrinks end only when lines deleted inside annotation', () => {
        expect(shiftRange(5, 10, 7, -2)).toEqual({ start: 5, end: 8 });
    });

    it('clamps end to start when entire annotation content deleted', () => {
        const result = shiftRange(5, 10, 5, -20);
        expect(result.end).toBeGreaterThanOrEqual(result.start);
    });

    // ── Single-line annotations ──────────────────────────────────────────────

    it('shifts a single-line annotation when edit is above', () => {
        expect(shiftRange(5, 5, 2, 1)).toEqual({ start: 6, end: 6 });
    });

    it('leaves a single-line annotation unchanged when edit is below', () => {
        expect(shiftRange(5, 5, 8, -2)).toEqual({ start: 5, end: 5 });
    });

    // ── Edge: edit at exactly annotation start boundary ──────────────────────

    it('treats edit at changeStart === start as "inside" (expands end, not start)', () => {
        const result = shiftRange(5, 10, 5, 3);
        // changeStart (5) >= start (5) and <= end (10), so only end shifts
        expect(result.start).toBe(5);
        expect(result.end).toBe(13);
    });
});
