export interface MediaSidxReference {
  /** Absolute byte offset of the referenced media fragment. */
  offset: number;
  length: number;
  /** Fragment duration in the index timescale. */
  durationTicks: number;
  startsWithSap: boolean;
  sapType: number;
  sapDeltaTime: number;
}

export interface MediaSidxIndex {
  version: 0 | 1;
  timescale: number;
  earliestPresentationTime: number;
  sidxOffset: number;
  sidxLength: number;
  /** Bytes from the beginning of the resource up to, but excluding, sidx. */
  initializationLength: number;
  /** Absolute offset declared by sidx for its first referenced fragment. */
  firstMediaOffset: number;
  references: MediaSidxReference[];
}

export type MediaSidxUnsupportedReason =
  | "invalid_resource_size"
  | "prefix_exceeds_resource"
  | "truncated_box"
  | "invalid_box_size"
  | "unsafe_box_size"
  | "sidx_not_found"
  | "missing_initialization"
  | "incompatible_brand"
  | "unsupported_sidx_version"
  | "invalid_sidx"
  | "invalid_timescale"
  | "empty_index"
  | "unsafe_sidx_value"
  | "indirect_reference"
  | "invalid_reference"
  | "invalid_sap"
  | "reference_out_of_bounds";

export type MediaSidxParseResult =
  | { kind: "need_more"; minimumBytes: number }
  | { kind: "unsupported"; reason: MediaSidxUnsupportedReason }
  | { kind: "ok"; index: MediaSidxIndex };

const BASIC_BOX_HEADER_BYTES = 8;
const EXTENDED_BOX_HEADER_BYTES = 16;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function unsupported(reason: MediaSidxUnsupportedReason): MediaSidxParseResult {
  return { kind: "unsupported", reason };
}

function requireBytes(prefixLength: number, resourceSize: number, minimumBytes: number): MediaSidxParseResult | null {
  if (minimumBytes > resourceSize) return unsupported("truncated_box");
  return prefixLength < minimumBytes ? { kind: "need_more", minimumBytes } : null;
}

function boxType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function uint64(view: DataView, offset: number): bigint {
  return (BigInt(view.getUint32(offset)) << 32n) | BigInt(view.getUint32(offset + 4));
}

function safeNumber(value: bigint): number | null {
  return value <= MAX_SAFE_BIGINT ? Number(value) : null;
}

function parseSidx(
  view: DataView,
  boxOffset: number,
  boxLength: number,
  headerLength: number,
  resourceSize: number,
): MediaSidxParseResult {
  const boxEnd = boxOffset + boxLength;
  let cursor = boxOffset + headerLength;
  if (cursor + 4 > boxEnd) return unsupported("invalid_sidx");

  const versionByte = view.getUint8(cursor);
  if (versionByte !== 0 && versionByte !== 1) return unsupported("unsupported_sidx_version");
  const version: 0 | 1 = versionByte;
  cursor += 4; // version and flags

  if (cursor + 8 > boxEnd) return unsupported("invalid_sidx");
  cursor += 4; // reference_ID
  const timescale = view.getUint32(cursor);
  cursor += 4;
  if (timescale === 0) return unsupported("invalid_timescale");

  let earliestPresentationTime: number;
  let firstOffset: number;
  if (version === 0) {
    if (cursor + 8 > boxEnd) return unsupported("invalid_sidx");
    earliestPresentationTime = view.getUint32(cursor);
    firstOffset = view.getUint32(cursor + 4);
    cursor += 8;
  } else {
    if (cursor + 16 > boxEnd) return unsupported("invalid_sidx");
    const earliest = safeNumber(uint64(view, cursor));
    const offset = safeNumber(uint64(view, cursor + 8));
    if (earliest == null || offset == null) return unsupported("unsafe_sidx_value");
    earliestPresentationTime = earliest;
    firstOffset = offset;
    cursor += 16;
  }

  if (cursor + 4 > boxEnd) return unsupported("invalid_sidx");
  cursor += 2; // reserved
  const referenceCount = view.getUint16(cursor);
  cursor += 2;
  if (referenceCount === 0) return unsupported("empty_index");
  if (cursor + referenceCount * 12 !== boxEnd) return unsupported("invalid_sidx");
  if (firstOffset > Number.MAX_SAFE_INTEGER - boxEnd) return unsupported("unsafe_sidx_value");

  const firstMediaOffset = boxEnd + firstOffset;
  if (firstMediaOffset >= resourceSize) return unsupported("reference_out_of_bounds");

  const references: MediaSidxReference[] = [];
  let mediaOffset = firstMediaOffset;
  let presentationTime = earliestPresentationTime;
  for (let index = 0; index < referenceCount; index += 1) {
    const sizeAndType = view.getUint32(cursor);
    const length = sizeAndType & 0x7fffffff;
    const durationTicks = view.getUint32(cursor + 4);
    const sap = view.getUint32(cursor + 8);
    cursor += 12;

    if ((sizeAndType & 0x80000000) !== 0) return unsupported("indirect_reference");
    if (length === 0 || durationTicks === 0) return unsupported("invalid_reference");
    const startsWithSap = (sap & 0x80000000) !== 0;
    const sapType = (sap >>> 28) & 0x7;
    const sapDeltaTime = sap & 0x0fffffff;
    if (sapType === 7 || (startsWithSap && (sapType === 0 || sapDeltaTime !== 0))) {
      return unsupported("invalid_sap");
    }
    if (length > Number.MAX_SAFE_INTEGER - mediaOffset) return unsupported("unsafe_sidx_value");
    if (durationTicks > Number.MAX_SAFE_INTEGER - presentationTime) return unsupported("unsafe_sidx_value");

    const mediaEnd = mediaOffset + length;
    if (mediaEnd > resourceSize) return unsupported("reference_out_of_bounds");
    references.push({ offset: mediaOffset, length, durationTicks, startsWithSap, sapType, sapDeltaTime });
    mediaOffset = mediaEnd;
    presentationTime += durationTicks;
  }

  return {
    kind: "ok",
    index: {
      version,
      timescale,
      earliestPresentationTime,
      sidxOffset: boxOffset,
      sidxLength: boxLength,
      initializationLength: boxOffset,
      firstMediaOffset,
      references,
    },
  };
}

/**
 * Parse the first top-level Segment Index box from an ISO BMFF byte prefix.
 * The prefix must start at byte zero. A `need_more` result gives the exclusive
 * prefix length required for the next attempt, without requesting media bytes.
 */
export function parseMediaSidx(prefix: Uint8Array, resourceSize: number): MediaSidxParseResult {
  if (!Number.isSafeInteger(resourceSize) || resourceSize <= 0) return unsupported("invalid_resource_size");
  if (prefix.byteLength > resourceSize) return unsupported("prefix_exceeds_resource");

  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  let offset = 0;
  let sawFtyp = false;
  let compatibleBrand = false;
  let sawMoov = false;

  while (offset < resourceSize) {
    const basicHeader = requireBytes(prefix.byteLength, resourceSize, offset + BASIC_BOX_HEADER_BYTES);
    if (basicHeader) return basicHeader;

    const size32 = view.getUint32(offset);
    const type = boxType(view, offset + 4);
    let headerLength = BASIC_BOX_HEADER_BYTES;
    let boxLength: number;
    if (size32 === 1) {
      const extendedHeader = requireBytes(prefix.byteLength, resourceSize, offset + EXTENDED_BOX_HEADER_BYTES);
      if (extendedHeader) return extendedHeader;
      const parsed = safeNumber(uint64(view, offset + BASIC_BOX_HEADER_BYTES));
      if (parsed == null) return unsupported("unsafe_box_size");
      boxLength = parsed;
      headerLength = EXTENDED_BOX_HEADER_BYTES;
    } else if (size32 === 0) {
      boxLength = resourceSize - offset;
    } else {
      boxLength = size32;
    }

    if (boxLength < headerLength) return unsupported("invalid_box_size");
    if (boxLength > resourceSize - offset) return unsupported("truncated_box");
    const boxEnd = offset + boxLength;
    if (type === "sidx") {
      if (!sawFtyp || !sawMoov) return unsupported("missing_initialization");
      if (!compatibleBrand) return unsupported("incompatible_brand");
      const completeBox = requireBytes(prefix.byteLength, resourceSize, boxEnd);
      if (completeBox) return completeBox;
      return parseSidx(view, offset, boxLength, headerLength, resourceSize);
    }

    if (type === "ftyp") {
      sawFtyp = true;
      const completeBox = requireBytes(prefix.byteLength, resourceSize, boxEnd);
      if (completeBox) return completeBox;
      if (boxLength < headerLength + 8 || (boxLength - headerLength) % 4 !== 0) {
        return unsupported("incompatible_brand");
      }
      for (let cursor = offset + headerLength; cursor + 4 <= boxEnd; cursor += 4) {
        // The second ftyp field is minor_version, not a brand.
        if (cursor === offset + headerLength + 4) continue;
        const brand = boxType(view, cursor);
        if (/^iso[6-9]$/.test(brand)) compatibleBrand = true;
      }
    }
    if (type === "moov") sawMoov = true;
    if (boxEnd === resourceSize) return unsupported("sidx_not_found");
    offset = boxEnd;
  }
  if (sawFtyp && !compatibleBrand) return unsupported("incompatible_brand");
  return unsupported("sidx_not_found");
}
