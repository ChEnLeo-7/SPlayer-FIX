<template>
  <Provider v-if="!isDesktopLyric">
    <AndroidServerConnect v-if="showAndroidServerConnect" />
    <router-view v-else />
  </Provider>
  <router-view v-else />
</template>

<script setup lang="ts">
import AndroidServerConnect from "@/components/Android/ServerConnect.vue";
import { isAndroidBootstrap } from "@/platform/android/serverPlugin";
import { isNativeAndroid } from "@/utils/env";

const isDesktopLyric = location.hash.includes("desktop-lyric");
const showAndroidServerConnect = isNativeAndroid && isAndroidBootstrap;
</script>
