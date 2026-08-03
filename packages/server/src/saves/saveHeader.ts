/**
 * Reading and validating `.sav` bytes without parsing the world.
 *
 * A save's header is uncompressed and sits at the front of the file, so the
 * watcher can learn a file's session identity and save time for the price of a
 * few hundred bytes — cheap enough to scan every save in the directory on every
 * change, which is what auto-follow needs (spec, "Followed session and merge
 * rules"). Only the header tells the truth: filenames are a convention players can
 * ignore, so nothing here ever consults them.
 */

import { inflateSync } from "node:zlib";

/** Ticks between 0001-01-01 and the Unix epoch; UE stores FDateTime in ticks. */
const EPOCH_TICKS = 621355968000000000n;

const TICKS_PER_MILLISECOND = 10000n;

/** The Unreal `PACKAGE_FILE_TAG` that opens every save body chunk header. */
const PACKAGE_FILE_TAG = 0x9e2a83c1;

/** Chunk header layout versions, and the byte size each one occupies. */
const CHUNK_HEADER_V1 = 0x00000000;
const CHUNK_HEADER_V2 = 0x22222222;
const CHUNK_HEADER_SIZE: Record<number, number> = {
  [CHUNK_HEADER_V1]: 48,
  [CHUNK_HEADER_V2]: 49,
};

/** Offset of the compressed-length field within a chunk header, per version. */
const COMPRESSED_LENGTH_OFFSET: Record<number, number> = {
  [CHUNK_HEADER_V1]: 32,
  [CHUNK_HEADER_V2]: 33,
};

/** The fields of a save header this project reads. */
export interface SaveHeader {
  headerVersion: number;
  saveVersion: number;
  buildVersion: number;
  /** The save's own name (header version 14+); "" on older saves. */
  saveName: string;
  mapName: string;
  /** The session this save belongs to — the authority for followed-session logic. */
  sessionName: string;
  playDurationSeconds: number;
  /** `SaveDateTime` as epoch milliseconds. */
  saveDateTime: number;
}

/** Thrown when bytes cannot be trusted as a complete, well-formed save. */
export class InvalidSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSaveError";
  }
}

/** Little-endian reader for the Unreal primitives a save header is built from. */
class ByteReader {
  private offset = 0;
  private readonly bytes: Buffer;

  // Node strips types rather than compiling them when the server runs straight
  // from source, so constructor parameter properties are not available here.
  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }

  get position(): number {
    return this.offset;
  }

  private require(count: number): void {
    if (this.offset + count > this.bytes.length) {
      throw new InvalidSaveError(
        `save header ends early: wanted ${count} bytes at offset ${this.offset}, file holds ${this.bytes.length}`,
      );
    }
  }

  int32(): number {
    this.require(4);
    const value = this.bytes.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  int64(): bigint {
    this.require(8);
    const value = this.bytes.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  byte(): number {
    this.require(1);
    return this.bytes[this.offset++]!;
  }

  skip(count: number): void {
    this.require(count);
    this.offset += count;
  }

  /**
   * An Unreal FString: a length, then that many characters plus a null
   * terminator. A negative length means the payload is UTF-16.
   */
  string(): string {
    const length = this.int32();
    if (length === 0) return "";
    if (length < 0) {
      const bytes = -length * 2;
      this.require(bytes);
      const value = this.bytes.toString("utf16le", this.offset, this.offset + bytes - 2);
      this.offset += bytes;
      return value;
    }
    this.require(length);
    const value = this.bytes.toString("latin1", this.offset, this.offset + length - 1);
    this.offset += length;
    return value;
  }
}

/**
 * Decode a save header from the start of a `.sav` file. `bytes` need only contain
 * the header — callers scanning a directory read a small prefix of each file.
 *
 * Throws {@link InvalidSaveError} if the bytes run out mid-header, which is what a
 * file caught halfway through being written looks like.
 */
export function readSaveHeader(bytes: Buffer): SaveHeader {
  return readHeaderAndBodyOffset(bytes).header;
}

/**
 * Decode the header and report where the compressed body begins. The header's
 * length varies with its version and with how long the session name, map options
 * and mod metadata are, so the body's offset is only knowable by reading through.
 */
function readHeaderAndBodyOffset(bytes: Buffer): { header: SaveHeader; bodyOffset: number } {
  const reader = new ByteReader(bytes);

  const headerVersion = reader.int32();
  const saveVersion = reader.int32();
  const buildVersion = reader.int32();
  const saveName = headerVersion >= 14 ? reader.string() : "";
  const mapName = reader.string();
  reader.string(); // mapOptions — connection settings, not state we surface
  const sessionName = reader.string();
  const playDurationSeconds = reader.int32();
  const saveDateTimeTicks = reader.int64();
  reader.byte(); // sessionVisibility

  // The remaining fields are versioned extras. Nothing here needs their values,
  // but each must be stepped over to land on the first body chunk.
  if (headerVersion >= 7) reader.int32(); // fEditorObjectVersion
  if (headerVersion >= 8) {
    reader.string(); // mod metadata JSON
    reader.int32(); // isModdedSave
  }
  if (headerVersion >= 10) reader.string(); // saveIdentifier
  if (headerVersion >= 11) reader.int32(); // partitionEnabledFlag
  if (headerVersion >= 12 && reader.int32() === 1) reader.skip(16); // consistency hash
  if (headerVersion >= 13) reader.int32(); // creativeModeEnabled

  return {
    header: {
      headerVersion,
      saveVersion,
      buildVersion,
      saveName,
      mapName,
      sessionName,
      playDurationSeconds,
      saveDateTime: Number((saveDateTimeTicks - EPOCH_TICKS) / TICKS_PER_MILLISECOND),
    },
    bodyOffset: reader.position,
  };
}

/**
 * Check that `bytes` are a complete, well-formed save before anything expensive
 * trusts them, and return the header on success.
 *
 * The game does not write saves atomically, so a file can be observed mid-write.
 * The compressed-chunk structure gives that away cheaply: every chunk header opens
 * with the Unreal package tag, declares its compressed length, and the chunks must
 * tile the file exactly to its end. Walking those headers costs microseconds and
 * catches truncation; inflating the first chunk proves the payload really is zlib
 * rather than a plausible-looking header over garbage. Deeper corruption is left
 * to the full parse, which fails loudly on its own.
 */
export function validateSaveFile(bytes: Buffer): SaveHeader {
  const { header, bodyOffset } = readHeaderAndBodyOffset(bytes);

  if (bodyOffset >= bytes.length) {
    throw new InvalidSaveError("save has a header but no body chunks");
  }

  let offset = bodyOffset;
  let firstChunkPayload: Buffer | undefined;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      throw new InvalidSaveError(`save body ends inside a chunk header at offset ${offset}`);
    }
    if (bytes.readUInt32LE(offset) !== PACKAGE_FILE_TAG) {
      throw new InvalidSaveError(
        `save body chunk at offset ${offset} does not start with the Unreal package tag`,
      );
    }

    const chunkHeaderVersion = bytes.readUInt32LE(offset + 4);
    const headerSize = CHUNK_HEADER_SIZE[chunkHeaderVersion];
    const lengthOffset = COMPRESSED_LENGTH_OFFSET[chunkHeaderVersion];
    if (headerSize === undefined || lengthOffset === undefined) {
      throw new InvalidSaveError(`unknown save chunk header version 0x${chunkHeaderVersion}`);
    }
    if (offset + headerSize > bytes.length) {
      throw new InvalidSaveError(`save body ends inside a chunk header at offset ${offset}`);
    }

    const compressedLength = bytes.readInt32LE(offset + lengthOffset);
    if (compressedLength <= 0) {
      throw new InvalidSaveError(`save body chunk at offset ${offset} declares no payload`);
    }

    const payloadStart = offset + headerSize;
    const payloadEnd = payloadStart + compressedLength;
    if (payloadEnd > bytes.length) {
      throw new InvalidSaveError(
        `save body chunk at offset ${offset} claims ${compressedLength} compressed bytes but the file ends at ${bytes.length}`,
      );
    }

    firstChunkPayload ??= bytes.subarray(payloadStart, payloadEnd);
    offset = payloadEnd;
  }

  try {
    inflateSync(firstChunkPayload!);
  } catch (cause) {
    throw new InvalidSaveError(`save body chunk does not inflate: ${String(cause)}`);
  }

  return header;
}
