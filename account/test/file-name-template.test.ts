import assert from "node:assert/strict";
import test from "node:test";
import {
  createFileNameTemplateValues,
  formatFileDuration,
  migrateFileNameFormat,
  renderFileNameTemplate,
  sanitizeFileName,
  validateFileNameTemplate,
} from "../../src/utils/fileNameTemplate.ts";

const song = {
  id: 1,
  name: "歌曲名",
  artists: [
    { id: 1, name: "歌手甲" },
    { id: 2, name: "歌手乙" },
  ],
  album: { id: 1, name: "专辑名" },
  cover: "",
  duration: 243000,
  free: 0 as const,
  mv: null,
  type: "song" as const,
  releaseDate: new Date(2024, 4, 6).getTime(),
};

test("文件名模板渲染全部变量", () => {
  const values = createFileNameTemplateValues(song, {
    quality: "无损",
    now: new Date(2026, 9, 5, 20, 24, 8),
  });
  assert.equal(
    renderFileNameTemplate(
      "{artist} - {title} - {album} - {quality} - {duration} - {downloadDate} - {downloadTime} - {releaseDate}",
      values,
    ),
    "歌手甲 & 歌手乙 - 歌曲名 - 专辑名 - 无损 - 04-03 - 2026-10-05 - 20-24-08 - 2024-05-06",
  );
});

test("空变量会智能清理分隔符", () => {
  assert.equal(renderFileNameTemplate("{artist} - {album} - {title}", { title: "歌曲" }), "歌曲");
});

test("非法模板和扩展名会被拒绝", () => {
  assert.equal(validateFileNameTemplate("{unknown}"), "不支持变量 {unknown}");
  assert.equal(validateFileNameTemplate("{title}.flac"), "模板中无需填写文件扩展名");
});

test("文件名清理路径字符和保留名", () => {
  assert.equal(sanitizeFileName('A/B:C*D?E"F<G>H|I'), "A&B&C&D&E&F&G&H&I");
  assert.equal(sanitizeFileName("CON"), "_CON");
});

test("时长和旧命名格式迁移", () => {
  assert.equal(formatFileDuration(3_723_000), "1-02-03");
  assert.equal(migrateFileNameFormat("title"), "{title}");
  assert.equal(migrateFileNameFormat("artist-title"), "{artist} - {title}");
  assert.equal(migrateFileNameFormat("title-artist"), "{title} - {artist}");
});
