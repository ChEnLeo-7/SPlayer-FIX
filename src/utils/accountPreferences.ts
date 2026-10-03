import type { SettingState } from "../stores/setting";
import type { ShortcutStore } from "../stores/shortcut";
import type { StatusState } from "../stores/status";
import type { SPlayerPreferencesSnapshot } from "../types/account";
import { cloneDeep } from "lodash-es";

const SETTING_KEYS = [
  "themeMode",
  "themeColorType",
  "preferTraditionalChinese",
  "traditionalChineseVariant",
  "themeCustomColor",
  "themeGlobalColor",
  "themeVariant",
  "themeFollowCover",
  "fontSettingStyle",
  "globalFont",
  "LyricFont",
  "japaneseLyricFont",
  "englishLyricFont",
  "koreanLyricFont",
  "shareUrlFormat",
  "hideVipTag",
  "lyricFontSizeMode",
  "lyricFontSize",
  "lyricTranFontSize",
  "lyricRomaFontSize",
  "lyricFontWeight",
  "showWordLyrics",
  "showTran",
  "showRoma",
  "swapTranRoma",
  "showWordsRoma",
  "lyricTransition",
  "lyricsPosition",
  "lyricsScrollOffset",
  "lyricHorizontalOffset",
  "lyricAlignRight",
  "hideBracketedContent",
  "replaceLyricBrackets",
  "uncensorMaskedProfanity",
  "bracketReplacementPreset",
  "customBracketReplacement",
  "fileNameFormat",
  "folderStrategy",
  "downloadMeta",
  "downloadCover",
  "downloadLyric",
  "downloadLyricTranslation",
  "downloadLyricRomaji",
  "saveMetaFile",
  "downloadMakeYrc",
  "downloadSaveAsAss",
  "downloadLyricToTraditional",
  "downloadLyricEncoding",
  "downloadSongLevel",
  "songLevel",
  "autoPlay",
  "songVolumeFade",
  "songVolumeFadeTime",
  "enableReplayGain",
  "replayGainMode",
  "countDownShow",
  "barLyricShow",
  "timeFormat",
  "playerType",
  "commentDisplayMode",
  "playerBackgroundType",
  "playerBackgroundFlowSpeed",
  "playerBackgroundPause",
  "playerBackgroundLowFreqVolume",
  "autoHidePlayerMeta",
  "memoryLastSeek",
  "progressTooltipShow",
  "progressAdjustLyric",
  "showPlaylistCount",
  "lyricsBlur",
  "lyricsBlendMode",
  "playSongDemo",
  "useAMLyrics",
  "useAMSpring",
  "hidePassedLines",
  "wordFadeWidth",
  "lyricOffsetStep",
  "enableOnlineTTMLLyric",
  "enableQQMusicLyric",
  "lyricPriority",
  "menuShowCover",
  "hiddenCovers",
  "hideAllCovers",
  "hideMiniPlayerCover",
  "routeAnimation",
  "playerExpandAnimation",
  "enableExcludeLyrics",
  "enableExcludeLyricsTTML",
  "enableExcludeLyricsLocal",
  "excludeLyricsUserKeywords",
  "excludeLyricsUserRegexes",
  "enableExcludeComments",
  "excludeCommentKeywords",
  "excludeCommentRegexes",
  "showPlayMeta",
  "showSongQuality",
  "showPlayerQuality",
  "showSongPrivilegeTag",
  "showSongExplicitTag",
  "showSongOriginalTag",
  "showSongAlbum",
  "showSongDuration",
  "showSongOperations",
  "showSongArtist",
  "sidebarHide",
  "playlistPageElements",
  "fullscreenPlayerElements",
  "contextMenuOptions",
  "enableSearchKeyword",
  "showSearchHistory",
  "showHotSearch",
  "searchInputBehavior",
  "showHomeGreeting",
  "homePageSections",
  "playerFollowCoverColor",
  "progressLyricShow",
  "playerStyleRatio",
  "playerFullscreenGradient",
  "disableAiAudio",
  "disableDjMode",
  "enableGlobalErrorDialog",
] as const satisfies readonly (keyof SettingState)[];

const SETTING_ENUMS: Partial<Record<(typeof SETTING_KEYS)[number], readonly unknown[]>> = {
  themeMode: ["light", "dark", "auto"],
  themeColorType: [
    "default",
    "red",
    "pink",
    "purple",
    "deepPurple",
    "indigo",
    "blue",
    "lightBlue",
    "cyan",
    "teal",
    "green",
    "lightGreen",
    "lime",
    "yellow",
    "amber",
    "orange",
    "deepOrange",
    "brown",
    "grey",
    "blueGrey",
    "solid",
    "custom",
  ],
  traditionalChineseVariant: ["s2t", "s2tw", "s2hk", "s2twp"],
  themeVariant: ["primary", "secondary", "tertiary", "neutral", "neutralVariant", "error"],
  fontSettingStyle: ["single", "multi", "custom"],
  shareUrlFormat: ["web", "mobile"],
  lyricFontSizeMode: ["fixed", "adaptive"],
  lyricTransition: ["slide", "fade"],
  lyricsPosition: ["flex-start", "center", "flex-end"],
  bracketReplacementPreset: ["dash", "angleBrackets", "cornerBrackets", "custom"],
  fileNameFormat: ["title", "artist-title", "title-artist"],
  folderStrategy: ["none", "artist", "artist-album"],
  downloadLyricEncoding: ["utf-8", "gbk", "utf-16", "iso-8859-1"],
  downloadSongLevel: ["l", "m", "h", "sq", "hr", "jyeffect", "sky", "jymaster"],
  songLevel: ["standard", "higher", "exhigh", "lossless", "hires", "jyeffect", "sky", "jymaster"],
  replayGainMode: ["track", "album"],
  timeFormat: ["current-total", "remaining-total", "current-remaining"],
  playerType: ["cover", "record", "fullscreen"],
  commentDisplayMode: ["fullscreen", "left", "right"],
  playerBackgroundType: ["none", "animation", "blur", "color"],
  lyricsBlendMode: ["screen", "plus-lighter"],
  lyricPriority: ["auto", "qm", "ttml", "official"],
  routeAnimation: ["none", "fade", "zoom", "slide", "up", "flow", "mask-left", "mask-top"],
  playerExpandAnimation: ["up", "flow"],
  searchInputBehavior: ["normal", "clear", "sync"],
};

const SETTING_NUMBER_RANGES: Partial<
  Record<(typeof SETTING_KEYS)[number], readonly [number, number]>
> = {
  lyricFontSize: [8, 200],
  lyricTranFontSize: [8, 120],
  lyricRomaFontSize: [8, 120],
  lyricFontWeight: [100, 1000],
  lyricsScrollOffset: [-2, 2],
  lyricHorizontalOffset: [-100, 100],
  songVolumeFadeTime: [0, 10_000],
  playerBackgroundFlowSpeed: [0, 20],
  wordFadeWidth: [0, 2],
  lyricOffsetStep: [50, 10_000],
  playerStyleRatio: [0, 100],
  playerFullscreenGradient: [0, 100],
};

const SORT_FIELDS = [
  "default",
  "title",
  "artist",
  "album",
  "trackNumber",
  "filename",
  "duration",
  "size",
  "createTime",
  "updateTime",
];
const SORT_ORDERS = ["default", "asc", "desc"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeValue = (value: unknown, template: unknown): unknown => {
  if (typeof template === "boolean") return typeof value === "boolean" ? value : template;
  if (typeof template === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : template;
  }
  if (typeof template === "string") {
    return typeof value === "string" && value.length <= 2000 ? value : template;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value) || value.length > 100) return cloneDeep(template);
    if (template.length === 0) {
      return value.filter(
        (item): item is string => typeof item === "string" && item.length <= 1000,
      );
    }
    return value.map((item) => sanitizeValue(item, template[0]));
  }
  if (isPlainObject(template)) {
    if (!isPlainObject(value)) return cloneDeep(template);
    return Object.fromEntries(
      Object.entries(template).map(([key, childTemplate]) => [
        key,
        sanitizeValue(value[key], childTemplate),
      ]),
    );
  }
  return cloneDeep(template);
};

const sanitizeSetting = (value: unknown, defaults: SettingState): Record<string, unknown> => {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(
    SETTING_KEYS.map((key) => {
      const allowedValues = SETTING_ENUMS[key];
      const allowedRange = SETTING_NUMBER_RANGES[key];
      const candidate = source[key];
      if (allowedValues && !allowedValues.includes(candidate))
        return [key, cloneDeep(defaults[key])];
      if (
        allowedRange &&
        (typeof candidate !== "number" ||
          !Number.isFinite(candidate) ||
          candidate < allowedRange[0] ||
          candidate > allowedRange[1])
      ) {
        return [key, cloneDeep(defaults[key])];
      }
      return [key, sanitizeValue(candidate, defaults[key])];
    }),
  );
};

const sanitizeStatus = (value: unknown, defaults: StatusState): Record<string, unknown> => {
  const source = isPlainObject(value) ? value : {};
  return {
    pureLyricMode:
      typeof source.pureLyricMode === "boolean" ? source.pureLyricMode : defaults.pureLyricMode,
    listSortField: SORT_FIELDS.includes(String(source.listSortField))
      ? source.listSortField
      : defaults.listSortField,
    listSortOrder: SORT_ORDERS.includes(String(source.listSortOrder))
      ? source.listSortOrder
      : defaults.listSortOrder,
  };
};

const sanitizeShortcut = (value: unknown, defaults: ShortcutStore): Record<string, string> => {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(
    Object.entries(defaults.shortcutList).map(([key, shortcut]) => {
      const candidate = source[key];
      return [
        key,
        typeof candidate === "string" && candidate.length <= 100 ? candidate : shortcut.shortcut,
      ];
    }),
  );
};

export const createDefaultPreferencesSnapshot = (
  setting: SettingState,
  status: StatusState,
  shortcut: ShortcutStore,
): SPlayerPreferencesSnapshot => ({
  schemaVersion: 1,
  setting: sanitizeSetting({}, setting),
  status: sanitizeStatus({}, status),
  shortcut: sanitizeShortcut({}, shortcut),
});

export const exportPreferencesSnapshot = (
  setting: SettingState,
  status: StatusState,
  shortcut: ShortcutStore,
): SPlayerPreferencesSnapshot => ({
  schemaVersion: 1,
  setting: sanitizeSetting(setting, setting),
  status: sanitizeStatus(status, status),
  shortcut: sanitizeShortcut(
    Object.fromEntries(
      Object.entries(shortcut.shortcutList).map(([key, item]) => [key, item.shortcut]),
    ),
    shortcut,
  ),
});

export const sanitizePreferencesSnapshot = (
  value: SPlayerPreferencesSnapshot | undefined,
  defaults: {
    setting: SettingState;
    status: StatusState;
    shortcut: ShortcutStore;
  },
): SPlayerPreferencesSnapshot => ({
  schemaVersion: 1,
  setting: sanitizeSetting(value?.setting, defaults.setting),
  status: sanitizeStatus(value?.status, defaults.status),
  shortcut: sanitizeShortcut(value?.shortcut, defaults.shortcut),
});

export const applyPreferencesSnapshot = (
  value: SPlayerPreferencesSnapshot | undefined,
  setting: { $state: SettingState; $patch: (patch: Partial<SettingState>) => void },
  status: { $state: StatusState; $patch: (patch: Partial<StatusState>) => void },
  shortcut: ShortcutStore,
  defaults = {
    setting: setting.$state,
    status: status.$state,
    shortcut,
  },
) => {
  const preferences = sanitizePreferencesSnapshot(value, defaults);
  setting.$patch(preferences.setting as Partial<SettingState>);
  status.$patch(preferences.status as Partial<StatusState>);
  for (const [key, nextShortcut] of Object.entries(preferences.shortcut)) {
    const shortcutItem = shortcut.shortcutList[key as keyof ShortcutStore["shortcutList"]];
    if (shortcutItem) shortcutItem.shortcut = nextShortcut;
  }
};
