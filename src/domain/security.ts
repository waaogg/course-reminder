export function allowedExternal(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "icourse163.org" ||
        url.hostname.endsWith(".icourse163.org") ||
        url.hostname === "lms.xjtu.edu.cn") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function redactError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s)]+/g, (value) => {
      try {
        const u = new URL(value);
        return u.origin + u.pathname;
      } catch {
        return "[链接]";
      }
    })
    .replace(
      /(cookie|authorization|token|password)\s*[:=]\s*\S+/gi,
      "$1=[已隐去]",
    )
    .slice(0, 700);
}
