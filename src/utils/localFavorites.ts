import type { CoverType, SongType } from "@/types/main";
import {
  getLocalFavorites,
  toggleLocalFavoriteAlbum,
  toggleLocalFavoritePlaylist,
  toggleLocalFavoriteSong,
  addSongsToServerLocalPlaylist,
  createServerLocalPlaylist,
  type LocalFavoritesData,
} from "@/api/localFavorites";
import { useDataStore, useLocalStore } from "@/stores";
import { isElectron } from "@/utils/env";
import { getCookie } from "@/utils/cookie";

export const canUseServerLocalFavorites = () => {
  if (isElectron) return false;
  const dataStore = useDataStore();
  if (!dataStore.userLoginStatus) return true;
  if (dataStore.loginType === "uid") return false;
  return !getCookie("MUSIC_U");
};

const applyLocalFavorites = async (data: LocalFavoritesData) => {
  const dataStore = useDataStore();
  const localStore = useLocalStore();
  await dataStore.setUserLikeData("songs", data.songs.map((song) => song.id));
  await dataStore.setUserLikeData("playlists", data.playlists);
  await dataStore.setUserLikeData("albums", data.albums);
  await dataStore.setLikeSongsList(
    {
      id: 0,
      name: "本地收藏歌曲",
      cover: data.songs[0]?.cover || "/images/album.jpg?asset",
      count: data.songs.length,
    },
    data.songs,
  );
  localStore.localPlaylists = data.localPlaylists || [];
  localStore.localSongs = data.localPlaylists?.flatMap((playlist) => playlist.songData || []) || [];
};

export const syncServerLocalFavorites = async () => {
  if (!canUseServerLocalFavorites()) return;
  try {
    const result = await getLocalFavorites();
    await applyLocalFavorites(result.data);
  } catch (error) {
    console.error("Failed to sync server local favorites:", error);
  }
};

export const likeServerLocalSong = async (song: SongType, like: boolean) => {
  const result = await toggleLocalFavoriteSong(song, like);
  await applyLocalFavorites(result.data);
};

export const likeServerLocalPlaylist = async (item: CoverType, like: boolean) => {
  const result = await toggleLocalFavoritePlaylist(item, like);
  await applyLocalFavorites(result.data);
};

export const likeServerLocalAlbum = async (item: CoverType, like: boolean) => {
  const result = await toggleLocalFavoriteAlbum(item, like);
  await applyLocalFavorites(result.data);
};

export const createServerPlaylist = async (name: string, description?: string) => {
  const result = await createServerLocalPlaylist(name, description);
  await syncServerLocalFavorites();
  return result.data;
};

export const addSongsToServerPlaylist = async (playlistId: number, songs: SongType[]) => {
  const result = await addSongsToServerLocalPlaylist(playlistId, songs);
  await syncServerLocalFavorites();
  return result.data;
};
