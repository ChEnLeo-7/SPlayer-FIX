<template>
  <div class="full-player-mobile" ref="mobileStart">
    <!-- 顶部功能栏 -->
    <div class="top-bar">
      <!-- 收起按钮 -->
      <div class="btn" @click.stop="statusStore.showFullPlayer = false">
        <SvgIcon name="Down" :size="26" />
      </div>
    </div>

    <!-- 主内容 -->
    <div
      :class="['mobile-content', { swiping: isSwiping }]"
      :style="{ transform: contentTransform }"
      @click.stop
    >
      <!-- 歌曲信息页 -->
      <div class="page info-page">
        <!-- 封面 -->
        <div class="cover-section">
          <PlayerCover :no-lyric="true" />
        </div>

        <!-- 歌曲信息区域 -->
        <div class="info-group">
          <!-- 歌曲信息与操作 -->
          <div class="song-info-bar">
            <div class="info-section">
              <PlayerData :center="false" :light="false" class="mobile-data" />
            </div>
            <div class="info-actions">
              <!-- 喜欢 -->
              <div
                v-if="musicStore.playSong.type !== 'radio'"
                class="action-btn"
                @click="
                  toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
                "
              >
                <SvgIcon
                  :name="
                    dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'
                  "
                  :size="26"
                  :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
                />
              </div>
              <!-- 添加到歌单 -->
              <div
                class="action-btn"
                @click.stop="openPlaylistAdd([musicStore.playSong], !!musicStore.playSong.path)"
              >
                <SvgIcon name="AddList" :size="26" />
              </div>
            </div>
          </div>

          <!-- 进度条 -->
          <div class="progress-section">
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[0] }}</span>
            <PlayerSlider class="player" :show-tooltip="false" />
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[1] }}</span>
          </div>

          <!-- 主控制按钮 -->
          <div class="control-section">
            <!-- 随机模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleShuffle()">
                <SvgIcon
                  :name="statusStore.shuffleIcon"
                  :size="24"
                  :depth="statusStore.shuffleMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>

            <!-- 上一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('prev')">
              <SvgIcon name="SkipPrev" :size="36" />
            </div>

            <!-- 播放/暂停 -->
            <n-button
              :loading="statusStore.playLoading"
              class="play-btn"
              type="primary"
              strong
              secondary
              circle
              @click.stop="player.playOrPause()"
            >
              <template #icon>
                <Transition name="fade" mode="out-in">
                  <SvgIcon
                    :key="statusStore.playStatus ? 'Pause' : 'Play'"
                    :name="statusStore.playStatus ? 'Pause' : 'Play'"
                    :size="40"
                  />
                </Transition>
              </template>
            </n-button>

            <!-- 下一曲 -->
            <div class="ctrl-btn" @click.stop="player.nextOrPrev('next')">
              <SvgIcon name="SkipNext" :size="36" />
            </div>

            <!-- 循环模式 -->
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleRepeat()">
                <SvgIcon
                  :name="statusStore.repeatIcon"
                  :size="24"
                  :depth="statusStore.repeatMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>
          </div>
        </div>
      </div>

      <!-- 歌词页 -->
      <div class="page lyric-page">
        <div class="lyric-header">
          <s-image :src="musicStore.getSongCover('s')" class="lyric-cover" />
          <div class="lyric-info">
            <div class="name text-hidden">
              {{
                settingStore.hideBracketedContent
                  ? removeBrackets(musicStore.playSong.name)
                  : musicStore.playSong.name
              }}
            </div>
            <div class="artist text-hidden">{{ artistName }}</div>
          </div>
          <!-- 喜欢按钮 -->
          <div
            v-if="musicStore.playSong.type !== 'radio'"
            class="action-btn"
            @click.stop="
              toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
            "
          >
            <SvgIcon
              :name="dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'"
              :size="24"
              :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
            />
          </div>
        </div>
        <div class="lyric-main">
          <PlayerLyric />
        </div>
      </div>
    </div>

    <!-- 页面指示器 -->
    <div class="pagination" v-if="hasLyric">
      <div
        v-for="i in 2"
        :key="i"
        :class="['dot', { active: pageIndex === i - 1 }]"
        @click="pageIndex = i - 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSwipe } from "@vueuse/core";
import { useMusicStore, useStatusStore, useDataStore, useSettingStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { toLikeSong } from "@/utils/auth";
import { openPlaylistAdd } from "@/utils/modal";
import { removeBrackets } from "@/utils/format";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const dataStore = useDataStore();
const player = usePlayerController();
const { timeDisplay, toggleTimeFormat } = useTimeFormat();

const mobileStart = ref<HTMLElement | null>(null);
const pageIndex = ref(0);

const hasLyric = computed(() => {
  return musicStore.isHasLrc && musicStore.playSong.type !== "radio";
});

const artistName = computed(() => {
  const artists = musicStore.playSong.artists;
  if (Array.isArray(artists)) {
    return artists.map((ar) => ar.name).join(" / ");
  }
  return (artists as string) || "未知艺术家";
});

// 没有歌词强制回到第一页
watch(hasLyric, (val) => {
  if (!val) pageIndex.value = 0;
});

// 滑动偏移量
const swipeOffset = ref(0);

const { direction, isSwiping, lengthX } = useSwipe(mobileStart, {
  threshold: 10,
  onSwipe: () => {
    if (!hasLyric.value) return;
    // 为正表示向左滑，为负表示向右滑
    swipeOffset.value = lengthX.value;
  },
  onSwipeEnd: () => {
    if (!hasLyric.value) {
      swipeOffset.value = 0;
      return;
    }
    // 超过阈值则切换页面
    if (direction.value === "left" && lengthX.value > 100) {
      pageIndex.value = 1;
    } else if (direction.value === "right" && lengthX.value < -100) {
      pageIndex.value = 0;
    }
    swipeOffset.value = 0;
  },
});

// 计算实时的变换位置
const contentTransform = computed(() => {
  const baseOffset = pageIndex.value * 50; // 百分比
  if (!isSwiping.value || !hasLyric.value) {
    return `translateX(-${baseOffset}%)`;
  }
  let pixelOffset = lengthX.value;
  // 限制滑动范围
  if (pageIndex.value === 0 && pixelOffset < 0) {
    pixelOffset = pixelOffset * 0.3;
  }
  if (pageIndex.value === 1 && pixelOffset > 0) {
    pixelOffset = pixelOffset * 0.3;
  }
  return `translateX(calc(-${baseOffset}% - ${pixelOffset}px))`;
});
</script>

<style lang="scss" scoped>
.full-player-mobile {
  --safe-area-top: var(--safe-area-inset-top);
  --safe-area-bottom: var(--safe-area-inset-bottom);
  --page-inline-space: 24px;
  --top-bar-height: 52px;
  --pagination-space: 44px;
  --section-gap: 18px;
  --cover-min-size: 180px;

  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  .top-bar {
    position: absolute;
    width: 100%;
    height: calc(var(--top-bar-height) + var(--safe-area-top));
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: var(--safe-area-top) var(--page-inline-space) 0;
    z-index: 10;
    .btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
      flex-shrink: 0;
      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
      .n-icon {
        color: rgb(var(--main-cover-color));
        opacity: 0.8;
      }
    }
  }
  .mobile-content {
    flex: 1;
    display: flex;
    width: 200%;
    height: 100%;
    min-height: 0;
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    &.swiping {
      transition: none;
    }
    .page {
      width: 50%;
      height: 100%;
      min-height: 0;
      flex-shrink: 0;
      position: relative;
    }
    .info-page {
      display: grid;
      grid-template-rows: minmax(var(--cover-min-size), 1fr) auto;
      align-items: stretch;
      padding: calc(var(--safe-area-top) + var(--top-bar-height)) var(--page-inline-space)
        calc(var(--safe-area-bottom) + var(--pagination-space));
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: none;
      &::-webkit-scrollbar {
        display: none;
      }
      .cover-section {
        container-type: size;
        min-height: var(--cover-min-size);
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px 0 18px;
        :deep(.player-cover) {
          width: min(100%, 45dvh);
          height: auto;
          max-width: 100%;
          max-height: 100%;
          @supports (width: 1cqb) {
            width: min(100cqi, 100cqb, 45dvh);
          }
          &.record {
            width: min(100%, 40dvh);
            height: auto;
            margin-bottom: 0;
            @supports (width: 1cqb) {
              width: min(100cqi, 100cqb, 40dvh);
            }
            .cover-img {
              width: 100%;
              height: 100%;
              min-width: 0;
            }
            .pointer {
              width: 30%;
              top: -22%;
            }
          }
        }
      }
      .info-group {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--section-gap);
        .song-info-bar {
          width: 100%;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          .info-section {
            flex: 1;
            min-width: 0;
            margin-right: 16px;
            :deep(.mobile-data) {
              width: 100%;
              max-width: 100%;
              margin-top: 0;
              .name {
                margin-left: 0;
              }
            }
          }
          .info-actions {
            display: flex;
            gap: 16px;
            flex-shrink: 0;
            .action-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 40px;
              height: 40px;
              border-radius: 50%;
              cursor: pointer;
              transition: background-color 0.2s;
              &:active {
                background-color: rgba(255, 255, 255, 0.1);
              }
              .n-icon {
                color: rgb(var(--main-cover-color));
                opacity: 0.6;
                transition:
                  opacity 0.2s,
                  transform 0.2s;
                &.liked {
                  fill: rgb(var(--main-cover-color));
                  opacity: 1;
                }
              }
            }
          }
        }
        .progress-section {
          display: flex;
          align-items: center;
          margin: 0 4px;
          .time {
            font-size: 12px;
            opacity: 0.6;
            width: 40px;
            text-align: center;
            color: rgb(var(--main-cover-color));
            font-variant-numeric: tabular-nums;
          }
          .n-slider {
            margin: 0 12px;
          }
        }
        .control-section {
          width: 100%;
          max-width: 400px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          .placeholder {
            width: 24px;
          }
          .mode-btn {
            opacity: 0.8;
            cursor: pointer;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .ctrl-btn {
            cursor: pointer;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            .n-icon {
              color: rgb(var(--main-cover-color));
            }
          }
          .play-btn {
            width: 60px;
            height: 60px;
            font-size: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s;
            background-color: rgba(var(--main-cover-color), 0.2);
            color: rgb(var(--main-cover-color));
            &.n-button--primary-type {
              --n-color: rgba(var(--main-cover-color), 0.14);
              --n-color-hover: rgba(var(--main-cover-color), 0.2);
              --n-color-focus: rgba(var(--main-cover-color), 0.2);
              --n-color-pressed: rgba(var(--main-cover-color), 0.12);
            }
            &:active {
              transform: scale(0.95);
            }
          }
        }
      }
    }
    .lyric-page {
      padding: calc(var(--safe-area-top) + var(--top-bar-height)) var(--page-inline-space)
        calc(var(--safe-area-bottom) + var(--pagination-space));
      display: flex;
      flex-direction: column;
      .lyric-header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 20px;
        flex-shrink: 0;
        padding: 10px 20px 0;
        .lyric-cover {
          width: 50px;
          height: 50px;
          flex-shrink: 0;
          :deep(img) {
            border-radius: 6px;
            width: 100%;
            height: 100%;
          }
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .lyric-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          .name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 2px;
          }
          .artist {
            font-size: 13px;
            opacity: 0.6;
          }
        }
        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          transition: background-color 0.2s;
          margin-left: 4px;
          &:active {
            background-color: rgba(255, 255, 255, 0.1);
          }
          .n-icon {
            color: rgb(var(--main-cover-color));
            opacity: 0.6;
            transition: all 0.2s;
            &.liked {
              fill: rgb(var(--main-cover-color));
              opacity: 1;
            }
          }
        }
      }
      .lyric-main {
        flex: 1;
        min-height: 0;
        position: relative;
      }
    }
  }
  .pagination {
    position: absolute;
    bottom: calc(var(--safe-area-bottom) + 14px);
    left: 0;
    width: 100%;
    display: flex;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
    .dot {
      position: relative;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.2);
      transition: all 0.3s;
      pointer-events: auto;
      cursor: pointer;
      &::after {
        content: "";
        position: absolute;
        top: -16px;
        bottom: -16px;
        left: -8px;
        right: -8px;
      }
      &.active {
        background-color: rgb(var(--main-cover-color));
        width: 16px;
        border-radius: 4px;
        opacity: 0.8;
      }
    }
  }

  @media (max-height: 700px) and (orientation: portrait) {
    --page-inline-space: 16px;
    --top-bar-height: 44px;
    --pagination-space: 34px;
    --section-gap: 12px;
    --cover-min-size: 136px;

    .mobile-content .info-page {
      .cover-section {
        padding: 2px 0 10px;
      }
      .info-group {
        .song-info-bar {
          .info-actions {
            gap: 8px;
            .action-btn {
              width: 44px;
              height: 44px;
            }
          }
          .info-section :deep(.mobile-data) {
            .name .name-text {
              font-size: 22px;
            }
            .alia {
              margin: 2px 0 2px 4px;
              font-size: 14px;
            }
            .play-meta {
              padding: 2px 4px;
            }
            .artists .ar,
            .album,
            .dj {
              font-size: 14px;
            }
          }
        }
        .control-section {
          padding: 0 4px;
          .mode-btn,
          .ctrl-btn {
            width: 44px;
            height: 44px;
          }
          .play-btn {
            width: 52px;
            height: 52px;
          }
        }
      }
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    --page-inline-space: 20px;
    --top-bar-height: 44px;
    --pagination-space: 28px;
    --section-gap: 10px;
    --cover-min-size: 0px;

    .mobile-content {
      .info-page {
        grid-template-columns: minmax(140px, 42%) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        column-gap: 24px;
        padding-bottom: calc(var(--safe-area-bottom) + var(--pagination-space));
        .cover-section {
          min-height: 0;
          padding: 0;
        }
        .info-group {
          min-height: 0;
          align-self: center;
          overflow-y: auto;
          scrollbar-width: none;
          &::-webkit-scrollbar {
            display: none;
          }
          .song-info-bar {
            .info-actions {
              gap: 8px;
              .action-btn {
                width: 44px;
                height: 44px;
              }
            }
            .info-section :deep(.mobile-data) {
              .name .name-text {
                font-size: 22px;
              }
              .alia {
                margin: 2px 0 2px 4px;
                font-size: 14px;
              }
              .play-meta {
                padding: 2px 4px;
              }
              .artists .ar,
              .album,
              .dj {
                font-size: 14px;
              }
            }
          }
          .control-section {
            padding: 0 4px;
            .mode-btn,
            .ctrl-btn {
              width: 44px;
              height: 44px;
            }
            .play-btn {
              width: 52px;
              height: 52px;
            }
          }
        }
      }
      .lyric-page {
        padding-top: calc(var(--safe-area-top) + var(--top-bar-height));
      }
    }
  }
}
</style>
