import { describe, expect, test } from "bun:test";
import { parseMediaSidx } from "./mediaSidx";

interface ReferenceFixture {
  length: number;
  durationTicks: number;
  startsWithSap?: boolean;
  sapType?: number;
  sapDeltaTime?: number;
  indirect?: boolean;
}

function concat(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
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

function typeBytes(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function box(type: string, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(), extended = false): Uint8Array {
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
  references = [{ length: 100, durationTicks: 2_000, startsWithSap: true, sapType: 1 }],
  extended = false,
}: {
  version?: number;
  timescale?: number;
  earliest?: bigint;
  firstOffset?: bigint;
  references?: ReferenceFixture[];
  extended?: boolean;
} = {}): Uint8Array {
  const entries = references.map((reference) => {
    const sap = (reference.startsWithSap ? 0x80000000 : 0)
      + ((reference.sapType ?? 0) << 28)
      + (reference.sapDeltaTime ?? 0);
    return concat(
      uint32(reference.length + (reference.indirect ? 0x80000000 : 0)),
      uint32(reference.durationTicks),
      uint32(sap),
    );
  });
  const timing = version === 0
    ? concat(uint32(Number(earliest)), uint32(Number(firstOffset)))
    : concat(uint64(earliest), uint64(firstOffset));
  return box("sidx", concat(
    Uint8Array.of(version, 0, 0, 0), uint32(1), uint32(timescale), timing,
    uint16(0), uint16(references.length), ...entries,
  ), extended);
}

function initialized(index: Uint8Array, brand = "iso6", extended = false): Uint8Array {
  const ftyp = box("ftyp", concat(typeBytes("dash"), uint32(0), typeBytes(brand)), extended);
  return concat(ftyp, box("moov", new Uint8Array(), extended), index);
}

describe("generic ISO BMFF sidx parsing", () => {
  test("parses real-shaped DASH version 0 SAP fields and absolute byte ranges", () => {
    const indexBox = sidx({
      earliest: 500n,
      firstOffset: 7n,
      references: [
        { length: 120, durationTicks: 2_000, startsWithSap: true, sapType: 1, sapDeltaTime: 0 },
        { length: 180, durationTicks: 3_000, startsWithSap: false, sapType: 0, sapDeltaTime: 17 },
      ],
    });
    const prefix = initialized(indexBox);
    const result = parseMediaSidx(prefix, prefix.byteLength + 7 + 300);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.index.version).toBe(0);
    expect(result.index.timescale).toBe(1_000);
    expect(result.index.earliestPresentationTime).toBe(500);
    expect(result.index.firstMediaOffset).toBe(prefix.byteLength + 7);
    expect(result.index.references).toEqual([
      {
        offset: prefix.byteLength + 7, length: 120, durationTicks: 2_000,
        startsWithSap: true, sapType: 1, sapDeltaTime: 0,
      },
      {
        offset: prefix.byteLength + 127, length: 180, durationTicks: 3_000,
        startsWithSap: false, sapType: 0, sapDeltaTime: 17,
      },
    ]);
  });

  test("supports extended boxes and version 1 safe 64-bit timing", () => {
    const indexBox = sidx({
      version: 1,
      earliest: 0x1_0000_0000n,
      firstOffset: 5n,
      references: [{ length: 40, durationTicks: 90_000, startsWithSap: true, sapType: 2 }],
      extended: true,
    });
    const prefix = initialized(indexBox, "iso6", true);
    const result = parseMediaSidx(prefix, prefix.byteLength + 45);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.index).toMatchObject({ version: 1, earliestPresentationTime: 0x1_0000_0000 });
    expect(result.index.references[0]).toMatchObject({ startsWithSap: true, sapType: 2 });
  });

  test("requests the exact remaining prefix and requires the iso6 compatible brand", () => {
    const prefix = initialized(sidx());
    expect(parseMediaSidx(prefix.subarray(0, 8), prefix.byteLength + 100))
      .toEqual({ kind: "need_more", minimumBytes: 20 });
    expect(parseMediaSidx(initialized(sidx(), "isom"), initialized(sidx(), "isom").byteLength + 100))
      .toEqual({ kind: "unsupported", reason: "incompatible_brand" });
    expect(parseMediaSidx(initialized(sidx(), "iso8"), initialized(sidx(), "iso8").byteLength + 100).kind)
      .toBe("ok");
  });

  test("rejects invalid SAP declarations, indirect references and unsafe values", () => {
    const invalidSap = initialized(sidx({
      references: [{ length: 10, durationTicks: 1_000, startsWithSap: true, sapType: 0 }],
    }));
    expect(parseMediaSidx(invalidSap, invalidSap.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "invalid_sap" });

    const invalidSapDelta = initialized(sidx({
      references: [{
        length: 10, durationTicks: 1_000, startsWithSap: true, sapType: 1, sapDeltaTime: 1,
      }],
    }));
    expect(parseMediaSidx(invalidSapDelta, invalidSapDelta.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "invalid_sap" });

    const indirect = initialized(sidx({
      references: [{ length: 10, durationTicks: 1_000, indirect: true }],
    }));
    expect(parseMediaSidx(indirect, indirect.byteLength + 10))
      .toEqual({ kind: "unsupported", reason: "indirect_reference" });

    const unsafe = initialized(sidx({
      version: 1,
      earliest: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    }));
    expect(parseMediaSidx(unsafe, unsafe.byteLength + 100))
      .toEqual({ kind: "unsupported", reason: "unsafe_sidx_value" });
  });

  test("rejects a referenced range outside the complete resource", () => {
    const prefix = initialized(sidx({
      firstOffset: 5n,
      references: [{ length: 100, durationTicks: 1_000, startsWithSap: true, sapType: 1 }],
    }));
    expect(parseMediaSidx(prefix, prefix.byteLength + 104))
      .toEqual({ kind: "unsupported", reason: "reference_out_of_bounds" });
  });
});
