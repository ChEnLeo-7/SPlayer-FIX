import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPreferencesSnapshot,
  exportPreferencesSnapshot,
  sanitizePreferencesSnapshot,
} from "../../src/utils/accountPreferences";

const createSettingFixture = () => ({
  themeMode: "auto",
  themeCustomColor: "#fe7971",
  lyricFontSize: 46,
  sidebarHide: { hideCloud: false },
  downloadPath: "",
  proxyServe: "127.0.0.1",
  playDevice: "default",
  customCss: "",
  customJs: "",
  lastfm: { apiSecret: "" },
});

const createStatusFixture = () => ({
  pureLyricMode: false,
  listSortField: "default",
  listSortOrder: "default",
  playVolume: 0.7,
  currentTime: 0,
});

const createShortcutFixture = () => ({
  globalOpen: true,
  shortcutList: {
    playNext: {
      name: "下一曲",
      shortcut: "CmdOrCtrl+ArrowRight",
      globalShortcut: "CmdOrCtrl+Shift+Right",
    },
  },
});

test("账户偏好只导出白名单并兼容旧快照", () => {
  const setting = createSettingFixture();
  setting.themeMode = "dark";
  setting.lyricFontSize = 52;
  setting.sidebarHide.hideCloud = true;
  setting.downloadPath = "C:\\Users\\private\\Music";
  setting.proxyServe = "10.0.0.8";
  setting.playDevice = "private-device";
  setting.customCss = "body { display: none }";
  setting.customJs = "fetch('https://example.invalid/secret')";
  setting.lastfm.apiSecret = "private-secret";

  const status = createStatusFixture();
  status.pureLyricMode = true;
  status.listSortField = "artist";
  status.playVolume = 0.2;
  status.currentTime = 123;

  const shortcut = createShortcutFixture();
  shortcut.shortcutList.playNext.shortcut = "KeyN";
  shortcut.shortcutList.playNext.globalShortcut = "Alt+KeyN";

  const snapshot = exportPreferencesSnapshot(setting as never, status as never, shortcut as never);
  assert.equal(snapshot.setting.themeMode, "dark");
  assert.equal(snapshot.setting.lyricFontSize, 52);
  assert.deepEqual(snapshot.setting.sidebarHide, setting.sidebarHide);
  assert.equal(snapshot.status.pureLyricMode, true);
  assert.equal(snapshot.status.listSortField, "artist");
  assert.equal(snapshot.shortcut.playNext, "KeyN");

  for (const excluded of [
    "downloadPath",
    "proxyServe",
    "playDevice",
    "customCss",
    "customJs",
    "lastfm",
  ]) {
    assert.equal(excluded in snapshot.setting, false);
  }
  assert.equal("playVolume" in snapshot.status, false);
  assert.equal("currentTime" in snapshot.status, false);
  assert.equal(JSON.stringify(snapshot).includes("Alt+KeyN"), false);
  assert.equal(JSON.stringify(snapshot).includes("private-secret"), false);

  const defaults = {
    setting: createSettingFixture() as never,
    status: createStatusFixture() as never,
    shortcut: createShortcutFixture() as never,
  };
  const legacyPreferences = sanitizePreferencesSnapshot(undefined, defaults);
  assert.equal(legacyPreferences.setting.themeMode, "auto");
  assert.equal(legacyPreferences.status.pureLyricMode, false);

  const targetSetting = createSettingFixture();
  const targetStatus = createStatusFixture();
  const targetShortcut = createShortcutFixture();
  targetSetting.downloadPath = "D:\\Keep-Local";
  targetStatus.playVolume = 0.9;
  applyPreferencesSnapshot(
    snapshot,
    {
      $state: targetSetting as never,
      $patch: (patch) => Object.assign(targetSetting, patch),
    },
    {
      $state: targetStatus as never,
      $patch: (patch) => Object.assign(targetStatus, patch),
    },
    targetShortcut as never,
  );
  assert.equal(targetSetting.themeMode, "dark");
  assert.equal(targetSetting.downloadPath, "D:\\Keep-Local");
  assert.equal(targetStatus.pureLyricMode, true);
  assert.equal(targetStatus.playVolume, 0.9);
  assert.equal(targetShortcut.shortcutList.playNext.shortcut, "KeyN");
  assert.equal(targetShortcut.shortcutList.playNext.globalShortcut, "CmdOrCtrl+Shift+Right");
});

test("账户偏好拒绝未知字段和非法枚举", () => {
  const sanitized = sanitizePreferencesSnapshot(
    {
      schemaVersion: 1,
      setting: {
        themeMode: "invalid",
        themeCustomColor: "#123456",
        lyricFontSize: 9999,
        customJs: "throw new Error('unexpected')",
      },
      status: { listSortOrder: "invalid", playVolume: 0 },
      shortcut: { playNext: "KeyN", unknown: "KeyX" },
    },
    {
      setting: createSettingFixture() as never,
      status: createStatusFixture() as never,
      shortcut: createShortcutFixture() as never,
    },
  );

  assert.equal(sanitized.setting.themeMode, "auto");
  assert.equal(sanitized.setting.themeCustomColor, "#123456");
  assert.equal(sanitized.setting.lyricFontSize, 46);
  assert.equal("customJs" in sanitized.setting, false);
  assert.equal(sanitized.status.listSortOrder, "default");
  assert.equal("playVolume" in sanitized.status, false);
  assert.equal(sanitized.shortcut.playNext, "KeyN");
  assert.equal("unknown" in sanitized.shortcut, false);
});
