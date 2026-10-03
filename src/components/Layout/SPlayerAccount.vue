<template>
  <n-dropdown :options="options" trigger="click" @select="handleSelect">
    <n-button
      :class="['splayer-account', `is-${accountStore.syncStatus}`]"
      :title="buttonLabel"
      :focusable="false"
      tertiary
    >
      <template #icon>
        <SvgIcon :name="accountStore.status === 'locked' ? 'Lock' : 'Cloud'" />
      </template>
      <span v-if="isDesktop" class="label">{{ buttonLabel }}</span>
    </n-button>
  </n-dropdown>
</template>

<script setup lang="ts">
import { useMobile } from "@/composables/useMobile";
import { useAccountStore } from "@/stores";
import { renderIcon } from "@/utils/helper";
import { openSplayerAccount } from "@/utils/modal";
import type { DropdownOption } from "naive-ui";

const accountStore = useAccountStore();
const { isDesktop } = useMobile();

const buttonLabel = computed(() => {
  if (accountStore.status === "guest") return "SPlayer 未登录";
  if (accountStore.status === "locked") return "SPlayer 已锁定";
  if (accountStore.syncStatus === "syncing") return "SPlayer 同步中";
  if (accountStore.syncStatus === "conflict") return "SPlayer 冲突";
  if (accountStore.syncStatus === "error") return "SPlayer 同步失败";
  return `SPlayer ${accountStore.user?.username ?? ""}`;
});

const options = computed<DropdownOption[]>(() => {
  if (accountStore.status !== "authenticated") {
    return [
      {
        label: accountStore.status === "locked" ? "输入密码解锁" : "登录或注册",
        key: "login",
        icon: renderIcon(accountStore.status === "locked" ? "LockOpen" : "Person"),
      },
    ];
  }
  return [
    {
      label: `SPlayer 账户：${accountStore.user?.username ?? ""}`,
      key: "identity",
      disabled: true,
    },
    {
      label: accountStore.syncStatus === "conflict" ? "存在同步冲突" : "立即同步",
      key: "sync",
      icon: renderIcon("Refresh"),
    },
    ...(accountStore.syncStatus === "conflict"
      ? [
          {
            label: "使用云端数据",
            key: "conflict-remote",
            icon: renderIcon("Download"),
          },
          {
            label: "使用本机数据覆盖云端",
            key: "conflict-local",
            icon: renderIcon("Refresh"),
          },
        ]
      : []),
    {
      label: "退出 SPlayer 账户",
      key: "logout",
      icon: renderIcon("Power"),
    },
  ];
});

const handleSelect = async (key: string) => {
  if (key === "login") {
    openSplayerAccount();
    return;
  }
  if (key === "sync") {
    try {
      await accountStore.syncNow();
      window.$message.success("SPlayer 账户已同步");
    } catch {
      window.$message.error(accountStore.lastError);
    }
    return;
  }
  if (key === "conflict-remote" || key === "conflict-local") {
    const useRemote = key === "conflict-remote";
    window.$dialog.warning({
      title: "处理同步冲突",
      content: useRemote
        ? "将使用云端保险库替换本机账户数据。Guest 数据不受影响。"
        : "将使用本机账户数据覆盖云端保险库，其他设备未同步的修改可能丢失。",
      positiveText: "确认",
      negativeText: "取消",
      onPositiveClick: async () => {
        try {
          await accountStore.resolveConflict(useRemote ? "remote" : "local");
          window.$message.success("同步冲突已处理");
          return true;
        } catch {
          window.$message.error(accountStore.lastError || "处理同步冲突失败");
          return false;
        }
      },
    });
    return;
  }
  if (key === "logout") {
    window.$dialog.warning({
      title: "退出 SPlayer 账户",
      content: "退出前将同步账户数据，随后恢复此设备的 Guest 数据。",
      positiveText: "同步并退出",
      negativeText: "取消",
      onPositiveClick: async () => {
        try {
          await accountStore.logout();
          window.$message.success("已退出 SPlayer 账户");
          return true;
        } catch {
          window.$message.error(accountStore.lastError || "退出失败，请稍后重试");
          return false;
        }
      },
    });
  }
  return undefined;
};
</script>

<style lang="scss" scoped>
.splayer-account {
  max-width: 190px;
  -webkit-app-region: no-drag;
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &.is-conflict,
  &.is-error {
    color: var(--error-color);
  }
}
</style>
