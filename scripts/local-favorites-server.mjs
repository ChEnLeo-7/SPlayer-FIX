import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = Number(process.env.LOCAL_FAVORITES_PORT || 25885);
const dataFile = resolve(process.env.LOCAL_FAVORITES_FILE || "/data/splayer/local-favorites.json");

const defaultData = {
  songs: [],
  playlists: [],
  albums: [],
  localPlaylists: [],
};

const sendJson = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const readData = async () => {
  try {
    return { ...defaultData, ...JSON.parse(await readFile(dataFile, "utf8")) };
  } catch {
    return { ...defaultData };
  }
};

const writeData = async (data) => {
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(data, null, 2), "utf8");
};

const itemId = (item) => String(item?.id || "");

const toggleItem = (list, item, like) => {
  const id = itemId(item);
  if (!id) return list;
  const next = list.filter((oldItem) => itemId(oldItem) !== id);
  if (like) next.unshift(item);
  return next;
};

const ensureDefaultPlaylist = (data) => {
  if (data.localPlaylists.length) return;
  const now = Date.now();
  data.localPlaylists.push({
    id: now,
    name: "默认歌单",
    description: "未登录时保存在服务器本地的歌单",
    cover: "",
    songs: [],
    songData: [],
    createTime: now,
    updateTime: now,
  });
};

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 200, { code: 200 });
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/local-favorites")) {
      return sendJson(res, 404, { code: 404, message: "Not Found" });
    }

    const data = await readData();
    ensureDefaultPlaylist(data);

    if (
      req.method === "GET" &&
      (url.pathname === "/local-favorites" || url.pathname === "/local-favorites/")
    ) {
      await writeData(data);
      return sendJson(res, 200, { code: 200, data });
    }

    if (req.method === "POST" && url.pathname === "/local-favorites/song") {
      const body = await readBody(req);
      data.songs = toggleItem(data.songs, body.item, body.like !== false);
      await writeData(data);
      return sendJson(res, 200, { code: 200, data });
    }

    if (req.method === "POST" && url.pathname === "/local-favorites/playlist") {
      const body = await readBody(req);
      data.playlists = toggleItem(data.playlists, body.item, body.like !== false);
      await writeData(data);
      return sendJson(res, 200, { code: 200, data });
    }

    if (req.method === "POST" && url.pathname === "/local-favorites/album") {
      const body = await readBody(req);
      data.albums = toggleItem(data.albums, body.item, body.like !== false);
      await writeData(data);
      return sendJson(res, 200, { code: 200, data });
    }

    if (req.method === "POST" && url.pathname === "/local-favorites/local-playlist") {
      const body = await readBody(req);
      const now = Date.now();
      const playlist = {
        id: now,
        name: String(body.name || "新建歌单"),
        description: body.description || "",
        cover: "",
        songs: [],
        songData: [],
        createTime: now,
        updateTime: now,
      };
      data.localPlaylists.unshift(playlist);
      await writeData(data);
      return sendJson(res, 200, { code: 200, data: playlist });
    }

    const match = url.pathname.match(/^\/local-favorites\/local-playlist\/(\d+)\/song$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req);
      const playlist = data.localPlaylists.find((item) => String(item.id) === match[1]);
      if (!playlist) return sendJson(res, 404, { code: 404, message: "Playlist Not Found" });
      const songs = Array.isArray(body.songs) ? body.songs : [];
      const exists = new Set((playlist.songs || []).map(String));
      const added = songs.filter((song) => !exists.has(itemId(song)));
      playlist.songData = [...added, ...(playlist.songData || [])];
      playlist.songs = playlist.songData.map((song) => String(song.id));
      playlist.cover = playlist.songData[0]?.cover || playlist.cover || "";
      playlist.updateTime = Date.now();
      await writeData(data);
      return sendJson(res, 200, { code: 200, data: { addedCount: added.length } });
    }

    return sendJson(res, 404, { code: 404, message: "Not Found" });
  } catch (error) {
    return sendJson(res, 500, { code: 500, message: error?.message || "Server Error" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`[LocalFavorites] listening on ${port}, data file: ${dataFile}`);
});
