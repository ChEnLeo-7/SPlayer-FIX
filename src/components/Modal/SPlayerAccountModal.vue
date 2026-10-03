<template>
  <div class="splayer-account-modal">
    <template v-if="recoveryKey">
      <n-alert
        :type="registrationUncertain ? 'warning' : 'success'"
        :title="registrationUncertain ? '注册结果待确认' : 'SPlayer 账户已创建'"
      >
        {{
          registrationUncertain
            ? "网络中断发生在注册过程中。请先保存此恢复密钥，再使用用户名和密码尝试登录，以确认账户是否创建成功。"
            : "恢复密钥仅显示一次。密码遗失时需要它恢复保险库，请保存在安全位置。"
        }}
      </n-alert>
      <n-input :value="recoveryKey" class="recovery-key" type="textarea" readonly autosize />
      <n-button block secondary @click="copyRecoveryKey">
        <template #icon><SvgIcon name="Copy" /></template>
        复制恢复密钥
      </n-button>
      <n-checkbox v-model:checked="recoveryKeySaved">我已安全保存恢复密钥</n-checkbox>
      <n-button type="primary" block :disabled="!recoveryKeySaved" @click="finishRegistration">
        <template #icon><SvgIcon name="Check" /></template>
        完成
      </n-button>
    </template>

    <template v-else-if="recoveryMode">
      <n-alert type="warning" title="需要设置新密码">
        此账户使用了管理员临时密码。请输入恢复密钥以恢复保险库并设置新密码。
      </n-alert>
      <n-form
        ref="passwordRecoveryFormRef"
        :model="passwordRecoveryForm"
        :rules="passwordRecoveryRules"
      >
        <n-form-item label="恢复密钥" path="recoveryKey">
          <n-input
            v-model:value="passwordRecoveryForm.recoveryKey"
            type="password"
            show-password-on="click"
            placeholder="请输入账户恢复密钥"
          />
        </n-form-item>
        <n-form-item label="新密码" path="newPassword">
          <n-input
            v-model:value="passwordRecoveryForm.newPassword"
            type="password"
            show-password-on="click"
            placeholder="至少 8 个字符"
          />
        </n-form-item>
        <n-form-item label="确认密码" path="confirmPassword">
          <n-input
            v-model:value="passwordRecoveryForm.confirmPassword"
            type="password"
            show-password-on="click"
            placeholder="请再次输入新密码"
            @keyup.enter="submitPasswordRecovery"
          />
        </n-form-item>
        <n-alert v-if="errorMessage" type="error" :show-icon="false">
          {{ errorMessage }}
        </n-alert>
        <n-button type="primary" block :loading="submitting" @click="submitPasswordRecovery">
          恢复保险库并设置新密码
        </n-button>
      </n-form>
    </template>

    <n-tabs v-else v-model:value="mode" type="segment" animated>
      <n-tab-pane name="login" tab="登录">
        <n-alert :bordered="false" type="info">
          登录只加载该账户的云端保险库，不会导入 Guest 数据；退出后会恢复 Guest。
        </n-alert>
        <n-form ref="loginFormRef" :model="loginForm" :rules="loginRules">
          <n-form-item label="用户名" path="username">
            <n-input v-model:value="loginForm.username" placeholder="请输入 SPlayer 用户名" />
          </n-form-item>
          <n-form-item label="密码" path="password">
            <n-input
              v-model:value="loginForm.password"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
              @keyup.enter="submitLogin"
            />
          </n-form-item>
          <n-alert v-if="errorMessage" type="error" :show-icon="false">
            {{ errorMessage }}
          </n-alert>
          <n-button type="primary" block :loading="submitting" @click="submitLogin">
            {{ accountStore.status === "locked" ? "解锁并登录" : "登录 SPlayer" }}
          </n-button>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="register" tab="注册">
        <n-alert :bordered="false" type="warning">
          新账户从空保险库开始，不会导入当前 Guest 数据。
        </n-alert>
        <n-form ref="registerFormRef" :model="registerForm" :rules="registerRules">
          <n-form-item label="用户名" path="username">
            <n-input v-model:value="registerForm.username" placeholder="请输入 SPlayer 用户名" />
          </n-form-item>
          <n-form-item label="密码" path="password">
            <n-input
              v-model:value="registerForm.password"
              type="password"
              show-password-on="click"
              placeholder="至少 8 个字符"
            />
          </n-form-item>
          <n-form-item label="确认密码" path="confirmPassword">
            <n-input
              v-model:value="registerForm.confirmPassword"
              type="password"
              show-password-on="click"
              placeholder="请再次输入密码"
              @keyup.enter="submitRegister"
            />
          </n-form-item>
          <n-alert v-if="errorMessage" type="error" :show-icon="false">
            {{ errorMessage }}
          </n-alert>
          <n-button type="primary" block :loading="submitting" @click="submitRegister">
            注册 SPlayer 账户
          </n-button>
        </n-form>
      </n-tab-pane>
    </n-tabs>
    <n-button v-if="!recoveryKey && !recoveryMode" block quaternary @click="emit('close')">
      取消
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { getSPlayerApiErrorMessage } from "@/api/splayerAccount";
import { useAccountStore } from "@/stores";
import { VaultUnlockError } from "@/utils/accountCrypto";
import axios from "axios";
import type { FormInst, FormRules } from "naive-ui";

const emit = defineEmits<{ close: [] }>();
const accountStore = useAccountStore();
const mode = ref<"login" | "register">("login");
const loginFormRef = ref<FormInst | null>(null);
const registerFormRef = ref<FormInst | null>(null);
const passwordRecoveryFormRef = ref<FormInst | null>(null);
const submitting = ref(false);
const errorMessage = ref("");
const recoveryKey = ref("");
const recoveryKeySaved = ref(false);
const registrationUncertain = ref(false);
const recoveryMode = ref(false);

const loginForm = reactive({ username: accountStore.user?.username ?? "", password: "" });
const registerForm = reactive({ username: "", password: "", confirmPassword: "" });
const passwordRecoveryForm = reactive({
  recoveryKey: "",
  newPassword: "",
  confirmPassword: "",
});

const loginRules: FormRules = {
  username: { required: true, message: "请输入用户名", trigger: ["input", "blur"] },
  password: { required: true, message: "请输入密码", trigger: ["input", "blur"] },
};

const registerRules: FormRules = {
  username: [
    { required: true, message: "请输入用户名", trigger: ["input", "blur"] },
    { min: 3, message: "用户名至少 3 个字符", trigger: ["input", "blur"] },
  ],
  password: [
    { required: true, message: "请输入密码", trigger: ["input", "blur"] },
    { min: 8, message: "密码至少 8 个字符", trigger: ["input", "blur"] },
  ],
  confirmPassword: [
    { required: true, message: "请确认密码", trigger: ["input", "blur"] },
    {
      validator: (_rule, value) => value === registerForm.password,
      message: "两次输入的密码不一致",
      trigger: ["input", "blur"],
    },
  ],
};

const passwordRecoveryRules: FormRules = {
  recoveryKey: { required: true, message: "请输入恢复密钥", trigger: ["input", "blur"] },
  newPassword: [
    { required: true, message: "请输入新密码", trigger: ["input", "blur"] },
    { min: 8, message: "密码至少 8 个字符", trigger: ["input", "blur"] },
  ],
  confirmPassword: [
    { required: true, message: "请确认新密码", trigger: ["input", "blur"] },
    {
      validator: (_rule, value) => value === passwordRecoveryForm.newPassword,
      message: "两次输入的密码不一致",
      trigger: ["input", "blur"],
    },
  ],
};

watch(mode, () => {
  errorMessage.value = "";
});

const describeError = (error: unknown) => {
  if (error instanceof VaultUnlockError) return error.message;
  if (axios.isAxiosError(error)) {
    const message = getSPlayerApiErrorMessage(error);
    if (message) return message;
    if (error.response?.status === 401) return "用户名或密码错误";
    if (error.response?.status === 409) return "该用户名已被使用";
  }
  console.error("SPlayer 账户操作失败", error);
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
};

const submitLogin = async () => {
  try {
    await loginFormRef.value?.validate();
    submitting.value = true;
    errorMessage.value = "";
    const result = await accountStore.login(loginForm.username.trim(), loginForm.password);
    if (result === "recovery") {
      recoveryMode.value = true;
      return;
    }
    if (result === "authenticated-with-recovery") {
      recoveryKey.value = accountStore.pendingRecoveryKey;
      return;
    }
    window.$message.success("SPlayer 账户已登录");
    emit("close");
  } catch (error) {
    if (Array.isArray(error)) return;
    errorMessage.value = describeError(error);
  } finally {
    submitting.value = false;
  }
};

const submitPasswordRecovery = async () => {
  try {
    await passwordRecoveryFormRef.value?.validate();
    submitting.value = true;
    errorMessage.value = "";
    await accountStore.recoverPassword(
      loginForm.password,
      passwordRecoveryForm.recoveryKey.trim(),
      passwordRecoveryForm.newPassword,
    );
    loginForm.password = "";
    passwordRecoveryForm.recoveryKey = "";
    passwordRecoveryForm.newPassword = "";
    passwordRecoveryForm.confirmPassword = "";
    window.$message.success("密码已更新，SPlayer 账户已恢复");
    emit("close");
  } catch (error) {
    if (Array.isArray(error)) return;
    errorMessage.value = describeError(error);
  } finally {
    submitting.value = false;
  }
};

const submitRegister = async () => {
  try {
    await registerFormRef.value?.validate();
    submitting.value = true;
    errorMessage.value = "";
    recoveryKey.value = await accountStore.register(
      registerForm.username.trim(),
      registerForm.password,
    );
  } catch (error) {
    if (Array.isArray(error)) return;
    if (accountStore.pendingRecoveryKey && accountStore.pendingRegistrationConfirmed) {
      recoveryKey.value = accountStore.pendingRecoveryKey;
    } else if (accountStore.pendingRecoveryKey && axios.isAxiosError(error) && !error.response) {
      recoveryKey.value = accountStore.pendingRecoveryKey;
      registrationUncertain.value = true;
    } else {
      accountStore.acknowledgeRecoveryKey();
    }
    errorMessage.value = describeError(error);
  } finally {
    submitting.value = false;
  }
};

const copyRecoveryKey = async () => {
  await navigator.clipboard.writeText(recoveryKey.value);
  window.$message.success("恢复密钥已复制");
};

const finishRegistration = () => {
  accountStore.acknowledgeRecoveryKey();
  recoveryKey.value = "";
  emit("close");
};
</script>

<style lang="scss" scoped>
.splayer-account-modal {
  .n-alert,
  .n-form-item,
  .n-checkbox,
  .n-button,
  .recovery-key {
    margin-bottom: 16px;
  }
  .n-form {
    margin-top: 16px;
  }
  .recovery-key {
    margin-top: 16px;
    font-family: monospace;
    word-break: break-all;
  }
}
</style>
