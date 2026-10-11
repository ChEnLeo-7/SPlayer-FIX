<template>
  <main class="server-connect">
    <section class="connect-content">
      <div class="brand-mark" aria-hidden="true">
        <SvgIcon name="Logo" :size="48" />
      </div>

      <template v-if="phase === 'loading' || phase === 'connecting'">
        <n-h1>{{ phase === "loading" ? "正在准备 SPlayer" : "正在连接服务" }}</n-h1>
        <n-text :depth="3">
          {{ phase === "loading" ? "正在读取本机连接配置" : displayHost }}
        </n-text>
        <n-spin class="connect-spinner" :size="28" />
      </template>

      <template v-else>
        <n-h1>{{ phase === "failed" ? "无法连接服务" : "连接 SPlayer 服务" }}</n-h1>
        <n-text :depth="3">输入你部署的 SPlayer 服务地址</n-text>

        <n-form class="connect-form" :show-label="false" @submit.prevent="connectServer">
          <n-form-item
            :validation-status="errorMessage ? 'error' : undefined"
            :show-feedback="false"
          >
            <n-input
              v-model:value="serverUrl"
              size="large"
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
              @keydown.enter.prevent="connectServer"
            >
              <template #prefix>
                <SvgIcon name="Link" :size="20" />
              </template>
            </n-input>
          </n-form-item>

          <div class="form-help">
            <n-text v-if="errorMessage" class="error-message" type="error">
              {{ errorMessage }}
            </n-text>
            <n-text class="example" :depth="3">例如：http://192.168.1.10:25884</n-text>
          </div>

          <n-alert v-if="usesHttp" class="connect-alert" type="warning" :show-icon="true">
            HTTP 连接未加密，仅建议在可信局域网中使用
          </n-alert>

          <n-button
            class="connect-button"
            type="primary"
            size="large"
            block
            attr-type="submit"
            :loading="submitting"
            :disabled="!serverUrl.trim()"
          >
            {{ phase === "failed" ? "重新测试并连接" : "测试并连接" }}
          </n-button>
        </n-form>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { getServerConnectionError, sPlayerServerPlugin } from "@/platform/android/serverPlugin";

type ConnectionPhase = "loading" | "connecting" | "config" | "failed";

const phase = ref<ConnectionPhase>("loading");
const serverUrl = ref("");
const errorMessage = ref("");
const submitting = ref(false);

const usesHttp = computed(() => /^http:\/\//i.test(serverUrl.value.trim()));
const displayHost = computed(() => {
  try {
    return new URL(serverUrl.value).host;
  } catch {
    return serverUrl.value;
  }
});

const connectServer = async () => {
  if (!serverUrl.value.trim() || submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    await sPlayerServerPlugin.connect({ url: serverUrl.value });
  } catch (error) {
    errorMessage.value = getServerConnectionError(error);
    phase.value = "failed";
    submitting.value = false;
  }
};

onMounted(async () => {
  try {
    const saved = await sPlayerServerPlugin.getServer();
    if (!saved.url) {
      phase.value = "config";
      return;
    }
    serverUrl.value = saved.url;
    phase.value = "connecting";
    await connectServer();
  } catch (error) {
    errorMessage.value = getServerConnectionError(error);
    phase.value = "failed";
    submitting.value = false;
  }
});
</script>

<style scoped lang="scss">
.server-connect {
  box-sizing: border-box;
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  padding: calc(32px + env(safe-area-inset-top)) 24px calc(32px + env(safe-area-inset-bottom));
  place-items: center;
}

.connect-content {
  display: flex;
  width: min(100%, 460px);
  flex-direction: column;
  align-items: center;
  text-align: center;

  .n-h1 {
    margin: 24px 0 6px;
    font-size: 28px;
    line-height: 1.25;
    letter-spacing: 0;
  }
}

.brand-mark {
  display: grid;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  background: rgba(254, 121, 113, 0.14);
  color: #fe7971;
  place-items: center;
}

.connect-spinner {
  margin: 32px 0 20px;
}

.connect-form {
  width: 100%;
  margin-top: 30px;
  text-align: left;

  :deep(.n-form-item) {
    margin-bottom: 0;
  }
}

.form-help {
  display: grid;
  min-height: 24px;
  margin-top: 8px;
  gap: 3px;
}

.error-message,
.example {
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.45;
}

.connect-alert {
  margin-top: 18px;
}

.connect-button {
  height: 44px;
  margin-top: 24px;
}

@media (max-width: 380px) {
  .server-connect {
    padding-right: 18px;
    padding-left: 18px;
  }

  .connect-content .n-h1 {
    font-size: 25px;
  }
}
</style>
