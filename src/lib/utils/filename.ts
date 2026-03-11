/**
 * 文件名 UTF-8 规范化（Worker-safe）
 */

/**
 * 规范化文件名为 QQ Bot API 要求的 UTF-8 编码格式
 */
export function sanitizeFileName(name: string): string {
  if (!name) return name;

  let result = name.trim();

  if (result.includes("%")) {
    try {
      result = decodeURIComponent(result);
    } catch {}
  }

  result = result.normalize("NFC");
  result = result.replace(/[\x00-\x1F\x7F]/g, "");

  return result;
}
