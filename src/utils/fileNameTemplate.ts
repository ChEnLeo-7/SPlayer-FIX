import type { SongType } from "@/types/main";

export const DEFAULT_FILE_NAME_TEMPLATE = "{artist} - {title}";

export const FILE_NAME_TEMPLATE_TOKENS = [
  "title",
  "artist",
  "album",
  "quality",
  "duration",
  "downloadDate",
  "downloadTime",
  "releaseDate",
] as const;

export type FileNameTemplateToken = (typeof FILE_NAME_TEMPLATE_TOKENS)[number];

export interface FileNameTemplateValues {
  title: string;
  artist: string;
  album: string;
  quality: string;
  duration: string;
  downloadDate: string;
  downloadTime: string;
  releaseDate: string;
}

const TOKEN_PATTERN = /\{([^{}]+)\}/g;
const INVALID_FILE_CHARS = /[<>:"/\\|?*]/g;
const RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const pad = (value: number) => String(value).padStart(2, "0");

export const formatFileDate = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

export const formatFileTime = (value: Date): string =>
  `${pad(value.getHours())}-${pad(value.getMinutes())}-${pad(value.getSeconds())}`;

export const formatFileDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}-${pad(minutes)}-${pad(seconds)}` : `${pad(minutes)}-${pad(seconds)}`;
};

export const formatReleaseDate = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : formatFileDate(date);
};

export const validateFileNameTemplate = (template: string): string | null => {
  const value = template.trim();
  if (!value) return "文件名模板不能为空";
  if (/\.(mp3|flac)$/i.test(value)) return "模板中无需填写文件扩展名";
  const matches = [...value.matchAll(TOKEN_PATTERN)];
  const remaining = value.replace(TOKEN_PATTERN, "");
  if (remaining.includes("{") || remaining.includes("}")) return "模板括号不完整";
  for (const match of matches) {
    if (!FILE_NAME_TEMPLATE_TOKENS.includes(match[1] as FileNameTemplateToken)) {
      return `不支持变量 {${match[1]}}`;
    }
  }
  return null;
};

export const sanitizeFileName = (value: string): string => {
  let safe = value
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(INVALID_FILE_CHARS, "&")
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/(?:\s*[-–—_|,;]+\s*){2,}/g, " - ")
    .replace(/^[\s.\-–—_|,;()[\]]+|[\s.\-–—_|,;()[\]]+$/g, "")
    .trim();
  if (!safe) safe = "未知歌曲";
  if (RESERVED_FILE_NAMES.test(safe)) safe = `_${safe}`;
  const chars = Array.from(safe);
  if (chars.length > 180) safe = `${chars.slice(0, 179).join("")}…`;
  return safe;
};

export const renderFileNameTemplate = (
  template: string,
  values: Partial<FileNameTemplateValues>,
): string => {
  const error = validateFileNameTemplate(template);
  if (error) throw new Error(error);
  const rendered = template.replace(TOKEN_PATTERN, (_match, token: FileNameTemplateToken) => {
    return values[token]?.trim() ?? "";
  });
  return sanitizeFileName(rendered);
};

export const createFileNameTemplateValues = (
  song: SongType,
  options: { quality?: string; releaseDate?: number; now?: Date } = {},
): FileNameTemplateValues => {
  const now = options.now ?? new Date();
  const artist = Array.isArray(song.artists)
    ? song.artists
        .map((item) => item.name)
        .filter(Boolean)
        .join(" & ")
    : String(song.artists || "");
  const album = typeof song.album === "string" ? song.album : song.album?.name;
  return {
    title: song.name || "未知歌曲",
    artist,
    album: album || "",
    quality: options.quality || "",
    duration: formatFileDuration(song.duration || 0),
    downloadDate: formatFileDate(now),
    downloadTime: formatFileTime(now),
    releaseDate: formatReleaseDate(options.releaseDate ?? song.releaseDate),
  };
};

export const migrateFileNameFormat = (value: unknown): string => {
  if (value === "title") return "{title}";
  if (value === "title-artist") return "{title} - {artist}";
  return DEFAULT_FILE_NAME_TEMPLATE;
};
