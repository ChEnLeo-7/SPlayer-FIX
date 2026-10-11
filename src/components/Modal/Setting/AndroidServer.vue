<template>
  <n-form :show-label="true" label-placement="top" @submit.prevent="switchServer">
    <n-form-item label="服务端地址" :validation-status="errorMessage ? 'error' : undefined">
      <n-input
        v-model:value="serverUrl"
        type="text"
        placeholder="https://splayer.example.com"
        clearable
        :disabled="submitting"
        :input-props="{
          inputmode: 'url',
          autocapitalize: 'none',
          autocomplete: 'url',
          spellcheck: false,
        }"
        @keydown.enter.prevent="switchServer"
      >
        <template #prefix>
          <SvgIcon name="Link" :size="18" />
        </template>
      </n-input>
      <template #feedback>{{ errorMessage }}</template>
    </n-form-item>

    <n-alert v-if="usesHttp" class="server-alert" type="warning" :show-icon="true">
      HTTP 连接未加密，仅建议在可信局域网中使用
    </n-alert>

    <n-alert v-if="resolvedUrl" class="server-alert" type="info" :show-icon="true">
      本次检测节点：{{ resolvedUrl }}。保存的仍是上方原始入口。
    </n-alert>

    <n-flex class="actions" justify="end">
      <n-button :disabled="submitting" @click="emit('close')">取消</n-button>
      <n-button
        type="primary"
        attr-type="submit"
        :loading="submitting"
        :disabled="!serverUrl.trim()"
      >
        测试并切换
      </n-button>
    </n-flex>
  </n-form>
</template>

<script setup lang="ts">
import { useAudioManager } from "@/core/player/AudioManager";
import { getServerConnectionError, sPlayerServerPlugin } from "@/platform/android/serverPlugin";

const emit = defineEmits<{ close: [] }>();
const serverUrl = ref("");
const errorMessage = ref("");
const resolvedUrl = ref("");
const submitting = ref(false);

const usesHttp = computed(() => /^http:\/\//i.test(serverUrl.value.trim()));

const switchServer = async () => {
  if (!serverUrl.value.trim() || submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  resolvedUrl.value = "";
  try {
    const result = await sPlayerServerPlugin.testServer({ url: serverUrl.value });
    resolvedUrl.value = result.resolvedUrl;
    useAudioManager().stop();
    await sPlayerServerPlugin.connect({ url: result.url });
  } catch (error) {
    errorMessage.value = getServerConnectionError(error);
    submitting.value = false;
  }
};

onMounted(async () => {
  try {
    const saved = await sPlayerServerPlugin.getServer();
    serverUrl.value = saved.url ?? "";
  } catch (error) {
    errorMessage.value = getServerConnectionError(error);
  }
});
</script>

<style scoped lang="scss">
.server-alert {
  margin-bottom: 18px;
}

.actions {
  margin-top: 24px;
}
</style>
