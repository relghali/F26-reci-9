import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// Read the spec in src/intervals/mergeIntervals.ts, then check your progress
// with `npm run mutants:intervals`.
//
// Label every property with its pattern, on the line above its `it(`:
//   // Pattern: invariant. The output is sorted.
// (invariant, algebraic, metamorphic, differential, or conditional)

// old generator made stuff like [0, -1] which isn't a valid interval, so the
// real code threw. build it as [start, start + length] so start <= end always.
// keeping the numbers small so intervals actually overlap/touch sometimes
const MIN_START = -20;
const MAX_START = 20;
const MAX_LENGTH = 10;
const interval: fc.Arbitrary<Interval> = fc
  .tuple(fc.integer({ min: MIN_START, max: MAX_START }), fc.nat(MAX_LENGTH))
  .map(([start, length]): Interval => [start, start + length]);
const intervalList = fc.array(interval);

// simple check: is p inside any of the intervals?
const covers = (xs: readonly Interval[], p: number): boolean =>
  xs.some(([s, e]) => s <= p && p <= e);

// endpoints are ints so checking every int and every .5 is enough to catch
// gaps like the one between [1, 2] and [3, 4]
const samplePoints: number[] = [];
for (let p = MIN_START - 1; p <= MAX_START + MAX_LENGTH + 1; p += 0.5) samplePoints.push(p);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const uncovered = xs.filter(([s, e]) => !out.some(([a, b]) => a <= s && e <= b));
        expect(uncovered).toEqual([]);
      }),
    );
  });

  // Pattern: invariant. Output is sorted and each interval ends before the next one starts.
  it('output is sorted and consecutive intervals neither overlap nor touch', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of out) expect(s).toBeLessThanOrEqual(e);
        for (let i = 0; i + 1 < out.length; i++) {
          expect(out[i][1]).toBeLessThan(out[i + 1][0]);
        }
      }),
    );
  });

  // Pattern: invariant. The input (and the intervals inside it) doesn't get modified.
  it('does not modify the input array or its intervals', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const snapshot = xs.map(([s, e]): Interval => [s, e]);
        const originalRefs = [...xs];
        mergeIntervals(xs);
        expect(xs).toEqual(snapshot);
        xs.forEach((iv, i) => expect(iv).toBe(originalRefs[i]));
      }),
    );
  });

  // Pattern: differential. Input and output cover the same points.
  it('output covers exactly the same real points as the input', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        const mismatches = samplePoints.filter(p => covers(xs, p) !== covers(out, p));
        expect(mismatches).toEqual([]);
      }),
    );
  });

  // Pattern: metamorphic. Shuffling the input gives the same output.
  it('shuffling the input does not change the output', () => {
    const listAndShuffle = intervalList.chain(xs =>
      fc.tuple(
        fc.constant(xs),
        fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }),
      ),
    );
    fc.assert(
      fc.property(listAndShuffle, ([xs, shuffled]) => {
        expect(mergeIntervals(shuffled)).toEqual(mergeIntervals(xs));
      }),
    );
  });

  // Pattern: algebraic. Merging twice is the same as merging once.
  it('merging an already-merged list changes nothing', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = mergeIntervals(xs);
        expect(mergeIntervals(once)).toEqual(once);
      }),
    );
  });

  // Pattern: conditional. If any interval is invalid, it throws a RangeError.
  it('throws a RangeError when any interval is invalid', () => {
    // bad one is either backwards or has a .5 endpoint, stuck somewhere in a normal list
    const badInterval: fc.Arbitrary<Interval> = fc.oneof(
      fc
        .tuple(fc.integer({ min: MIN_START, max: MAX_START }), fc.integer({ min: 1, max: MAX_LENGTH }))
        .map(([s, k]): Interval => [s, s - k]),
      fc
        .tuple(interval, fc.boolean())
        .map(([[s, e], fracStart]): Interval => (fracStart ? [s - 0.5, e] : [s, e + 0.5])),
    );
    const listWithBad = fc
      .tuple(intervalList, badInterval, fc.nat())
      .map(([xs, bad, i]) => {
        const at = i % (xs.length + 1);
        return [...xs.slice(0, at), bad, ...xs.slice(at)];
      });
    fc.assert(
      fc.property(listWithBad, xs => {
        expect(() => mergeIntervals(xs)).toThrow(RangeError);
      }),
    );
  });

  // Pattern: conditional. If nothing overlaps or touches, output is just the input sorted.
  it('already-disjoint, non-touching input comes back sorted and unchanged', () => {
    // go left to right leaving a gap of at least 1 after each interval, then shuffle
    const sortedDisjoint: fc.Arbitrary<Interval[]> = fc
      .tuple(
        fc.integer({ min: MIN_START, max: MAX_START }),
        fc.array(fc.tuple(fc.nat(5), fc.integer({ min: 1, max: 3 })), { maxLength: 10 }),
      )
      .map(([first, pieces]) => {
        const result: Interval[] = [];
        let start = first;
        for (const [length, gap] of pieces) {
          result.push([start, start + length]);
          start += length + gap;
        }
        return result;
      });
    const sortedAndShuffled = sortedDisjoint.chain(sorted =>
      fc.tuple(
        fc.constant(sorted),
        fc.shuffledSubarray(sorted, { minLength: sorted.length, maxLength: sorted.length }),
      ),
    );
    fc.assert(
      fc.property(sortedAndShuffled, ([sorted, shuffled]) => {
        expect(mergeIntervals(shuffled)).toEqual(sorted);
      }),
    );
  });
});
