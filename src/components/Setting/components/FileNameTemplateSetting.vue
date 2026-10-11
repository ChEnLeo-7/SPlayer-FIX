<template>
  <div class="file-name-template-setting">
    <n-input
      v-model:value="draft"
      :status="error ? 'error' : undefined"
      placeholder="{artist} - {title}"
      @blur="commit"
      @keyup.enter="commit"
    />
    <n-flex size="small" class="tokens">
      <n-button
        v-for="token in tokens"
        :key="token"
        size="tiny"
        secondary
        @click="insertToken(token)"
      >
        {{ tokenLabel(token) }}
      </n-button>
    </n-flex>
    <n-text :type="error ? 'error' : undefined" :depth="error ? undefined : 3" class="preview">
      {{ error || `预览：${preview}.flac` }}
    </n-text>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import {
  createFileNameTemplateValues,
  FILE_NAME_TEMPLATE_TOKENS,
  renderFileNameTemplate,
  validateFileNameTemplate,
  type FileNameTemplateToken,
} from "@/utils/fileNameTemplate";

const settingStore = useSettingStore();
const draft = ref(settingStore.fileNameTemplate);
const tokens = FILE_NAME_TEMPLATE_TOKENS;
const sampleSong = {
  id: 0,
  name: "示例歌曲",
  artists: [{ id: 0, name: "示例歌手" }],
  album: { id: 0, name: "示例专辑" },
  cover: "",
  duration: 243000,
  free: 0 as const,
  mv: null,
  type: "song" as const,
  releaseDate: new Date(2026, 0, 2).getTime(),
};

const error = computed(() => validateFileNameTemplate(draft.value));
const preview = computed(() => {
  if (error.value) return "";
  return renderFileNameTemplate(
    draft.value,
    createFileNameTemplateValues(sampleSong, {
      quality: "无损",
      now: new Date(2026, 9, 5, 20, 24, 8),
    }),
  );
});

watch(
  () => settingStore.fileNameTemplate,
  (value) => {
    if (value !== draft.value) draft.value = value;
  },
);

const insertToken = (token: FileNameTemplateToken) => {
  draft.value += `{${token}}`;
};

const tokenLabel = (token: FileNameTemplateToken) => `{${token}}`;

const commit = () => {
  if (error.value) return;
  settingStore.fileNameTemplate = draft.value.trim();
};
</script>

<style scoped lang="scss">
.file-name-template-setting {
  width: min(520px, 100%);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  .tokens {
    width: 100%;
    max-width: 100%;
    flex-flow: row wrap !important;
  }
  .preview {
    display: block;
    width: 100%;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
}

@media (max-width: 768px) {
  .file-name-template-setting {
    width: 100%;

    :deep(.n-input) {
      width: 100%;
    }
  }
}
</style>
