<template>
  <n-slider
    :value="sliderProgress"
    :key="musicStore.playSong?.id"
    :step="0.01"
    :min="0"
    :max="sliderDuration"
    :disabled="sliderDuration <= 0"
    :keyboard="false"
    :format-tooltip="formatTooltip"
    :tooltip="settingStore.progressTooltipShow && showTooltip"
    :class="['player-slider', { drag: isDragging }]"
    @update:value="updateSliderProgress"
    @dragstart="startDrag"
    @dragend="endDrag"
    @mousedown.stop
  />
</template>

<script setup lang="ts">
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { msToTime } from "@/utils/time";
import { usePlayerController } from "@/core/player/PlayerController";
import { LyricLine } from "@applemusic-like-lyrics/lyric";

withDefaults(defineProps<{ showTooltip?: boolean }>(), { showTooltip: true });

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

const player = usePlayerController();

// 拖动时的临时值
const dragValue = ref(0);
// 是否拖动
const isDragging = ref(false);
// 是否显示提示
// const showSliderTooltip = ref(false);

// 实时进度
const sliderDuration = computed(() => statusStore.duration || musicStore.playSong.duration || 0);
const sliderProgress = computed(() =>
  isDragging.value ? dragValue.value : statusStore.currentTime,
);

const updateSliderProgress = (value: number) => {
  dragValue.value = value;
  if (!isDragging.value) setSeek(value);
};

// 开始拖拽
const startDrag = () => {
  isDragging.value = true;
  // 立即赋值当前时间
  dragValue.value = statusStore.currentTime;
};

// 结束拖拽
const endDrag = () => {
  const target = dragValue.value;
  isDragging.value = false;
  setSeek(target);
};

/**
 * 二分查找当前时间对应的歌词索引
 */
const getLyricIndex = (lyric: LyricLine[], value: number) => {
  let low = 0;
  let high = lyric.length - 1;
  let idx = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lyric[mid].startTime <= value) {
      idx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return idx;
};

/**
 * 获取当前时间最近一句歌词
 * @param value 当前时间
 * @returns 最近一句歌词的开始时间和内容
 */
const getCurrentLyric = (value: number) => {
  const lyric = toRaw(musicStore.songLyric.lrcData);
  if (!lyric?.length) return null;
  const idx = getLyricIndex(lyric, value);
  const nearestLyric = idx !== -1 ? lyric[idx] : null;

  return {
    time: nearestLyric?.startTime,
    text: nearestLyric?.words?.[0]?.word || "",
  };
};

// 调节进度
const setSeek = (value: number) => {
  // 歌词吸附
  if (settingStore.progressAdjustLyric) {
    const lyric = toRaw(musicStore.songLyric.lrcData);
    if (lyric?.length) {
      const currentLineIdx = getLyricIndex(lyric, value);

      // 优先检查下一行（预备开始）
      // 无论当前是否有行，只要下一行够近，就吸附到下一行
      const nextLineIdx = currentLineIdx + 1;
      if (nextLineIdx < lyric.length) {
        const nextLine = lyric[nextLineIdx];
        if (nextLine.startTime - value <= 2500) {
          player.setSeek(nextLine.startTime);
          return;
        }
      }
      // 查当前行（重新开始）
      // 解决纯音乐被拉回的问题：如果距离当前行开头太远（>10s），则视为 Instrumental 或 Gap，不吸附
      if (currentLineIdx !== -1) {
        const currentLine = lyric[currentLineIdx];
        const offset = value - currentLine.startTime;
        if (offset <= 10000) {
          player.setSeek(currentLine.startTime);
          return;
        }
      }
    }
  }
  player.setSeek(value);
};

// 格式化提示
const formatTooltip = (value: number) => {
  const nearestLyric = settingStore.progressLyricShow ? getCurrentLyric(value) : null;
  return nearestLyric?.text?.length
    ? `${msToTime(value)} / ${nearestLyric.text.length > 30 ? nearestLyric.text.slice(0, 30) + "..." : nearestLyric.text}`
    : msToTime(value);
};
</script>

<style scoped lang="scss">
.player-slider {
  width: 100%;
  &:not(.drag) {
    :deep(.n-slider-rail) {
      .n-slider-rail__fill {
        transition: width 0.3s;
      }
      .n-slider-handle-wrapper {
        will-change: left;
        transition: left 0.3s;
      }
    }
  }
  :deep(.n-slider-handles) {
    .n-slider-handle {
      opacity: 0;
      transform: scale(0.6);
    }
  }
  &:hover,
  &.drag {
    :deep(.n-slider-handles) {
      .n-slider-handle {
        opacity: 1;
        transform: scale(1);
      }
    }
  }
}
</style>
