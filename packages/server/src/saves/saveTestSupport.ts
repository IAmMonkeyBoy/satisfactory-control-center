import { deflateSync } from "node:zlib";

/**
 * Builders for synthetic `.sav` bytes.
 *
 * The save format is only ever read by this project, never written, so the tests
 * need a way to produce files whose contents they control — including the broken
 * ones (truncated body, wrong chunk magic, garbage where zlib should be) that the
 * validator exists to reject. These builders encode the documented Unreal layout
 * independently of the reader, so a test's expected values come from the format
 * spec rather than from the code under test.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */

/** Ticks between 0001-01-01 and the Unix epoch; UE stores FDateTime in ticks. */
const EPOCH_TICKS = 621355968000000000n;

/** The Unreal `PACKAGE_FILE_TAG` every save body chunk header starts with. */
export const PACKAGE_FILE_TAG = 0x9e2a83c1;

/** Chunk header version 2 — the layout shipped by Satisfactory 1.0+. */
const CHUNK_HEADER_V2 = 0x22222222;

const MAX_CHUNK_CONTENT_SIZE = 131072;

export interface SaveHeaderFields {
  sessionName: string;
  saveName: string;
  /** Epoch milliseconds; converted to UE ticks on the way out. */
  saveDateTimeMs: number;
  headerVersion?: number;
  saveVersion?: number;
  buildVersion?: number;
  mapName?: string;
  mapOptions?: string;
  playDurationSeconds?: number;
}

/** Little-endian writer for the handful of Unreal primitives a header uses. */
class ByteWriter {
  private readonly parts: Buffer[] = [];

  int32(value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value);
    this.parts.push(buf);
    return this;
  }

  int64(value: bigint): this {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(value);
    this.parts.push(buf);
    return this;
  }

  byte(value: number): this {
    this.parts.push(Buffer.from([value]));
    return this;
  }

  /** An Unreal FString: length (including the null terminator), then bytes. */
  string(value: string): this {
    if (value === "") return this.int32(0);
    this.int32(value.length + 1);
    this.parts.push(Buffer.from(value, "latin1"), Buffer.from([0]));
    return this;
  }

  raw(buf: Buffer): this {
    this.parts.push(buf);
    return this;
  }

  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Encode a save header exactly as the game writes it (header version 14). */
export function buildSaveHeader(fields: SaveHeaderFields): Buffer {
  const headerVersion = fields.headerVersion ?? 14;
  const writer = new ByteWriter()
    .int32(headerVersion)
    .int32(fields.saveVersion ?? 60)
    .int32(fields.buildVersion ?? 495413);

  if (headerVersion >= 14) writer.string(fields.saveName);

  writer
    .string(fields.mapName ?? "Persistent_Level")
    .string(fields.mapOptions ?? "")
    .string(fields.sessionName)
    .int32(fields.playDurationSeconds ?? 1234)
    .int64(BigInt(fields.saveDateTimeMs) * 10000n + EPOCH_TICKS)
    .byte(0)
    // fEditorObjectVersion (header >= 7)
    .int32(40)
    // mod metadata + isModdedSave (header >= 8)
    .string("")
    .int32(0)
    // saveIdentifier (header >= 10)
    .string("test-save")
    // partitionEnabledFlag (header >= 11)
    .int32(1)
    // consistency hash: not valid, so no 16 hash bytes follow (header >= 12)
    .int32(0)
    // creativeModeEnabled (header >= 13)
    .int32(0);

  return writer.done();
}

/** Wrap already-compressed bytes in a version-2 chunk header. */
function buildChunkHeader(compressedLength: number, uncompressedLength: number): Buffer {
  const header = Buffer.alloc(49);
  header.writeUInt32LE(PACKAGE_FILE_TAG, 0);
  header.writeUInt32LE(CHUNK_HEADER_V2, 4);
  header.writeInt32LE(MAX_CHUNK_CONTENT_SIZE, 8);
  header.writeUInt8(3 /* zlib */, 16);
  header.writeInt32LE(uncompressedLength, 25);
  header.writeInt32LE(compressedLength, 33);
  return header;
}

export interface SaveFileOptions {
  /** Body payload, chunked and zlib-compressed like the game does. */
  body?: Buffer;
  /** Corrupt the first chunk's magic, as a half-written file can look. */
  corruptChunkMagic?: boolean;
  /** Claim more compressed bytes than the file actually holds. */
  truncateBody?: boolean;
  /** Put non-zlib garbage where the compressed payload belongs. */
  garbageChunkPayload?: boolean;
}

/**
 * Build a complete `.sav` file: header, then the body split into zlib chunks.
 * The options produce the specific failure modes a partially written save shows.
 */
export function buildSaveFile(fields: SaveHeaderFields, options: SaveFileOptions = {}): Buffer {
  const body = options.body ?? Buffer.from("synthetic save body");
  const payload = options.garbageChunkPayload
    ? Buffer.from("not zlib at all, just bytes")
    : deflateSync(body);

  const chunkHeader = buildChunkHeader(payload.length, body.length);
  if (options.corruptChunkMagic) chunkHeader.writeUInt32LE(0xdeadbeef, 0);
  if (options.truncateBody) chunkHeader.writeInt32LE(payload.length + 512, 33);

  return Buffer.concat([buildSaveHeader(fields), chunkHeader, payload]);
}
