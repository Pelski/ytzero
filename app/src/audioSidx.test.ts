import { describe, expect, test } from "bun:test";
import { parseAudioSidx } from "./audioSidx";

interface ReferenceFixture {
  length: number;
  durationTicks: number;
  indirect?: boolean;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function uint64(value: bigint): Uint8Array {
  return concat(uint32(Number(value >> 32n)), uint32(Number(value & 0xffffffffn)));
}

function typeBytes(type: string): Uint8Array {
  return Uint8Array.from([...type].map((character) => character.charCodeAt(0)));
}

function box(type: string, payload: Uint8Array = new Uint8Array(), extended = false): Uint8Array {
  const headerLength = extended ? 16 : 8;
  const length = headerLength + payload.byteLength;
  return extended
    ? concat(uint32(1), typeBytes(type), uint64(BigInt(length)), payload)
    : concat(uint32(length), typeBytes(type), payload);
}

function sidx({
  version = 0,
  timescale = 1_000,
  earliest = 0n,
  firstOffset = 0n,
  references = [{ length: 10, durationTicks: 1_000 }],
  extended = false,
  declaredReferenceCount = references.length,
}: {
  version?: number;
  timescale?: number;
  earliest?: bigint;
  firstOffset?: bigint;
  references?: ReferenceFixture[];
  extended?: boolean;
  declaredReferenceCount?: number;
} = {}): Uint8Array {
  const entries = references.map((reference) => concat(
    uint32(reference.length + (reference.indirect ? 0x80000000 : 0)),
    uint32(reference.durationTicks),
    uint32(0x90000000),
  ));
  const timing = version === 0
    ? concat(uint32(Number(earliest)), uint32(Number(firstOffset)))
    : concat(uint64(earliest), uint64(firstOffset));
  return box("sidx", concat(
    Uint8Array.of(version, 0, 0, 0),
    uint32(1),
    uint32(timescale),
    timing,
    uint16(0),
    uint16(declaredReferenceCount),
    ...entries,
  ), extended);
}

function initializedPrefix(index: Uint8Array): Uint8Array {
  return concat(box("ftyp"), box("moov"), index);
}

describe("audio MP4 sidx parsing", () => {
  test("parses a version 0 top-level index into absolute contiguous media ranges", () => {
    const indexBox = sidx({
      earliest: 2_500n,
      firstOffset: 3n,
      references: [
        { length: 10, durationTicks: 2_000 },
        { length: 20, durationTicks: 3_000 },
      ],
    });
    const prefix = initializedPrefix(indexBox);
    const result = parseAudioSidx(prefix, prefix.byteLength + 3 + 10 + 20);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.index).toEqual({
      version: 0,
      timescale: 1_000,
      earliestPresentationTime: 2_500,
      sidxOffset: 16,
      sidxLength: indexBox.byteLength,
      initializationLength: 16,
      firstMediaOffset: prefix.byteLength + 3,
      references: [
        { offset: prefix.byteLength + 3, length: 10, durationTicks: 2_000 },
        { offset: prefix.byteLength + 13, length: 20, durationTicks: 3_000 },
      ],
    });
  });

  test("supports extended top-level box sizes and version 1 64-bit timing fields", () => {
    const indexBox = sidx({
      version: 1,
      earliest: 0x1_0000_0000n,
      firstOffset: 5n,
      references: [
        { length: 5, durationTicks: 90_000 },
        { length: 7, durationTicks: 45_000 },
      ],
      extended: true,
    });
    const prefix = concat(box("ftyp", new Uint8Array(), true), box("moov", new Uint8Array(), true), indexBox);
    const wrapped = concat(Uint8Array.of(7, 7), prefix, Uint8Array.of(8, 8));
    const result = parseAudioSidx(wrapped.subarray(2, 2 + prefix.byteLength), prefix.byteLength + 5 + 12);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.index.version).toBe(1);
    expect(result.index.earliestPresentationTime).toBe(0x1_0000_0000);
    expect(result.index.sidxOffset).toBe(32);
    expect(result.index.sidxLength).toBe(indexBox.byteLength);
    expect(result.index.firstMediaOffset).toBe(prefix.byteLength + 5);
    expect(result.index.references.at(-1)).toEqual({
      offset: prefix.byteLength + 10,
      length: 7,
      durationTicks: 45_000,
    });
  });

  test("reports the exact larger prefix required for a partial header or sidx body", () => {
    const indexBox = sidx({ references: [{ length: 10, durationTicks: 1_000 }] });
    const prefix = initializedPrefix(indexBox);
    const resourceSize = prefix.byteLength + 10;

    expect(parseAudioSidx(prefix.subarray(0, 20), resourceSize))
      .toEqual({ kind: "need_more", minimumBytes: 24 });
    expect(parseAudioSidx(prefix.subarray(0, 24), resourceSize))
      .toEqual({ kind: "need_more", minimumBytes: prefix.byteLength });
  });

  test("declines resources without a top-level index or initialization boxes", () => {
    const initialization = concat(box("ftyp"), box("moov"));
    expect(parseAudioSidx(initialization, initialization.byteLength))
      .toEqual({ kind: "unsupported", reason: "sidx_not_found" });

    const indexBox = sidx();
    expect(parseAudioSidx(indexBox, indexBox.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "missing_initialization" });
  });

  test("rejects truncated and internally inconsistent indexes", () => {
    const indexBox = sidx({ references: [{ length: 10, durationTicks: 1_000 }] });
    const declaredTooLarge = initializedPrefix(indexBox);
    new DataView(declaredTooLarge.buffer).setUint32(16, indexBox.byteLength + 100);
    expect(parseAudioSidx(declaredTooLarge, declaredTooLarge.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "truncated_box" });

    const missingEntry = initializedPrefix(sidx({ declaredReferenceCount: 2 }));
    expect(parseAudioSidx(missingEntry, missingEntry.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "invalid_sidx" });
  });

  test("rejects indirect references, empty values, and ranges outside the resource", () => {
    const indirect = initializedPrefix(sidx({ references: [{ length: 10, durationTicks: 1_000, indirect: true }] }));
    expect(parseAudioSidx(indirect, indirect.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "indirect_reference" });

    const zeroDuration = initializedPrefix(sidx({ references: [{ length: 10, durationTicks: 0 }] }));
    expect(parseAudioSidx(zeroDuration, zeroDuration.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "invalid_reference" });

    const outside = initializedPrefix(sidx({ firstOffset: 5n, references: [{ length: 10, durationTicks: 1_000 }] }));
    expect(parseAudioSidx(outside, outside.byteLength + 12))
      .toEqual({ kind: "unsupported", reason: "reference_out_of_bounds" });
  });

  test("rejects unsupported versions, zero timescales, and unsafe 64-bit values", () => {
    const unknownVersion = initializedPrefix(sidx({ version: 2 }));
    expect(parseAudioSidx(unknownVersion, unknownVersion.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "unsupported_sidx_version" });

    const noTimescale = initializedPrefix(sidx({ timescale: 0 }));
    expect(parseAudioSidx(noTimescale, noTimescale.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "invalid_timescale" });

    const unsafeTiming = initializedPrefix(sidx({
      version: 1,
      earliest: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    }));
    expect(parseAudioSidx(unsafeTiming, unsafeTiming.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "unsafe_sidx_value" });

    const unsafeBox = concat(uint32(1), typeBytes("ftyp"), uint64(1n << 63n));
    expect(parseAudioSidx(unsafeBox, unsafeBox.byteLength))
      .toEqual({ kind: "unsupported", reason: "unsafe_box_size" });
  });
});
