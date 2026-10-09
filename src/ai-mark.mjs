/**
 * Позначка «створено ШІ» у метаданих PNG (крок 1 плану docs/C2PA.md).
 *
 * Записуємо XMP-пакет в iTXt-чанк `XML:com.adobe.xmp` з IPTC `DigitalSourceType` =
 * `trainedAlgorithmicMedia` і `xmp:CreatorTool`. Піксельні дані не чіпаємо (чанк вставляємо
 * перед першим IDAT без перекодування), тож залежності від sharp немає. Це НЕ підпис:
 * позначку легко стерти; криптографічний шар — `series c2pa` (крок 2).
 */
import { crc32 } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const AI_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
export const XMP_KEYWORD = "XML:com.adobe.xmp";

const xmlEscape = (v) =>
  String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

export function buildXmp({ tool = "Series Lab" } = {}) {
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-12/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ` Iptc4xmpExt:DigitalSourceType="${AI_SOURCE_TYPE}"`,
    ` xmp:CreatorTool="${xmlEscape(tool)}"/>`,
    "</rdf:RDF></x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function itxtXmp(xmp) {
  // keyword \0 compressionFlag(0) compressionMethod(0) language\0 translatedKeyword\0 text
  return makeChunk("iTXt", Buffer.concat([Buffer.from(XMP_KEYWORD, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(xmp, "utf8")]));
}

/** Розбирає PNG на чанки; null, якщо це не коректний PNG. */
function splitChunks(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 + 12 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const end = pos + 12 + len;
    if (end > buf.length) return null;
    chunks.push({ type: buf.toString("latin1", pos + 4, pos + 8), raw: buf.subarray(pos, end), data: buf.subarray(pos + 8, pos + 8 + len) });
    pos = end;
    if (chunks[chunks.length - 1].type === "IEND") break;
  }
  return chunks.length && chunks[0].type === "IHDR" && chunks[chunks.length - 1].type === "IEND" ? chunks : null;
}

const isOurXmp = (c) => c.type === "iTXt" && c.data.toString("latin1", 0, XMP_KEYWORD.length + 1) === `${XMP_KEYWORD}\0`;

/** Чи має PNG маніфест C2PA (чанк caBX), тобто підписаний `series c2pa`. */
export function hasC2pa(buf) {
  return Boolean(splitChunks(buf)?.some((c) => c.type === "caBX"));
}

/**
 * Повертає { buffer, marked, signed?, reason? }. Не-PNG і пошкоджені файли віддає без змін.
 * PNG з маніфестом C2PA теж лишається як є: будь-яка зміна байтів зламала б підпис.
 */
export function markPngAsAi(buf, { tool = "Series Lab" } = {}) {
  const chunks = splitChunks(buf);
  if (!chunks) return { buffer: buf, marked: false, reason: "not_png" };
  if (chunks.some((c) => c.type === "caBX")) return { buffer: buf, marked: false, signed: true, reason: "c2pa_signed" };
  const kept = chunks.filter((c) => !isOurXmp(c));
  const at = kept.findIndex((c) => c.type === "IDAT");
  if (at < 0) return { buffer: buf, marked: false, reason: "no_idat" };
  const out = [PNG_SIGNATURE, ...kept.slice(0, at).map((c) => c.raw), itxtXmp(buildXmp({ tool })), ...kept.slice(at).map((c) => c.raw)];
  return { buffer: Buffer.concat(out), marked: true };
}

/** Читає позначку назад: { marked, digitalSourceType, creatorTool }. */
export function readAiMark(buf) {
  const chunks = splitChunks(buf);
  const hit = chunks?.find(isOurXmp);
  if (!hit) return { marked: false };
  const xmp = hit.data.subarray(XMP_KEYWORD.length + 1 + 4).toString("utf8");
  const dst = /Iptc4xmpExt:DigitalSourceType="([^"]*)"/.exec(xmp)?.[1] || null;
  const tool = /xmp:CreatorTool="([^"]*)"/.exec(xmp)?.[1] || null;
  return { marked: dst === AI_SOURCE_TYPE, digitalSourceType: dst, creatorTool: tool };
}

/** Зміст `ai-disclosure.json` у ZIP. */
export function aiDisclosureDoc({ marked = 0, skipped = 0, signed = 0, files = [], signedFiles = [] } = {}) {
  return {
    schema: "series-ai-disclosure/v1",
    digitalSourceType: AI_SOURCE_TYPE,
    method: "xmp-itxt",
    markedImages: marked,
    skippedImages: skipped,
    c2paSignedImages: signed,
    note: "Метадані (XMP) можна стерти; вони не є підписом. Криптографічний шар: `series c2pa`.",
    files,
    c2paSignedFiles: signedFiles,
  };
}
