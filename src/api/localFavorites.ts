import type { CoverType, SongType, LocalPlaylistType } from "@/types/main";
import axios from "axios";

export interface ServerLocalPlaylist extends LocalPlaylistType {
  songData?: SongType[];
}

export interface LocalFavoritesData {
  songs: SongType[];
  playlists: CoverType[];
  albums: CoverType[];
  localPlaylists: ServerLocalPlaylist[];
}

const localFavoritesRequest = axios.create({
  baseURL: "/api/local-favorites",
  timeout: 15000,
});

export const getLocalFavorites = () => {
  return localFavoritesRequest<{ code: number; data: LocalFavoritesData }>({
    url: "/",
  }).then((response) => response.data);
};

export const toggleLocalFavoriteSong = (item: SongType, like: boolean) => {
  return localFavoritesRequest<{ code: number; data: LocalFavoritesData }>({
    url: "/song",
    method: "post",
    data: { item, like },
  }).then((response) => response.data);
};

export const toggleLocalFavoritePlaylist = (item: CoverType, like: boolean) => {
  return localFavoritesRequest<{ code: number; data: LocalFavoritesData }>({
    url: "/playlist",
    method: "post",
    data: { item, like },
  }).then((response) => response.data);
};

export const toggleLocalFavoriteAlbum = (item: CoverType, like: boolean) => {
  return localFavoritesRequest<{ code: number; data: LocalFavoritesData }>({
    url: "/album",
    method: "post",
    data: { item, like },
  }).then((response) => response.data);
};

export const createServerLocalPlaylist = (name: string, description?: string) => {
  return localFavoritesRequest<{ code: number; data: ServerLocalPlaylist }>({
    url: "/local-playlist",
    method: "post",
    data: { name, description },
  }).then((response) => response.data);
};

export const addSongsToServerLocalPlaylist = (playlistId: number, songs: SongType[]) => {
  return localFavoritesRequest<{ code: number; data: { addedCount: number } }>({
    url: `/local-playlist/${playlistId}/song`,
    method: "post",
    data: { songs },
  }).then((response) => response.data);
};
