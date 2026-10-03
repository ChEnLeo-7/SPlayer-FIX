<!-- 私人喜欢的音乐 -->
<template>
  <div class="liked-list">
    <ListDetail
      :detail-data="detailData"
      :list-data="listData"
      :loading="false"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      title-text="我喜欢的音乐"
      hide-comment-tab
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
    />
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="!searchValue || searchData.length"
        :data="displayData"
        :height="songListHeight"
        :draggable="canDragSort"
        :doubleClickAction="searchData.length ? 'add' : 'all'"
        private-favorites
        @scroll="handleListScroll"
        @removeSong="removeSong"
        @reorder="handleReorder"
      />
      <n-empty
        v-else
        :description="`搜不到关于 ${searchValue} 的任何歌曲呀`"
        style="margin-top: 60px"
        size="large"
      >
        <template #icon>
          <SvgIcon name="SearchOff" />
        </template>
      </n-empty>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useListActions } from "@/composables/List/useListActions";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListSearch } from "@/composables/List/useListSearch";
import { useAccountStore, useDataStore, useStatusStore } from "@/stores";
import type { SongType } from "@/types/main";

const dataStore = useDataStore();
const accountStore = useAccountStore();
const statusStore = useStatusStore();

const listData = computed(() => dataStore.likeSongsList.data);
const detailData = computed(() => ({
  ...dataStore.likeSongsList.detail,
  count: listData.value.length,
}));
const { getSongListHeight } = useListDetail();
const { searchValue, searchData, displayData, performSearch } = useListSearch(listData);
const { listScrolling, handleListScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();

const songListHeight = computed(() => getSongListHeight(listScrolling.value));
const canDragSort = computed(() => !searchValue.value && statusStore.listSortField === "default");

const listConfig = {
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: false,
  showArtist: false,
  showCreator: false,
  showCount: true,
  searchAlign: "center" as const,
};

const persistList = async (songs: SongType[]) => {
  await dataStore.setLikeSongsList(detailData.value, songs);
  accountStore.scheduleSync();
};

const handleSearchUpdate = (value: string) => {
  searchValue.value = value;
  performSearch(value);
};

const playAllSongs = useDebounceFn(() => {
  if (displayData.value.length) playAllSongsAction(displayData.value);
}, 300);

const removeSong = async (ids: number[]) => {
  const idSet = new Set(ids);
  await persistList(listData.value.filter((song) => !idSet.has(song.id)));
  if (searchValue.value) performSearch(searchValue.value);
};

const handleReorder = async (fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex) return;
  const nextList = [...listData.value];
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(toIndex, 0, moved);
  await persistList(nextList);
};
</script>
