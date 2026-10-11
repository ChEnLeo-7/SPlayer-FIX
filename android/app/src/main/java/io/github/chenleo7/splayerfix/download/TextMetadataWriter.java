package io.github.chenleo7.splayerfix.download;

import java.io.File;
import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.json.JSONObject;

final class TextMetadataWriter {

    private TextMetadataWriter() {}

    static void write(File file, JSONObject metadata) {
        if (metadata == null) return;
        try {
            AudioFile audioFile = AudioFileIO.read(file);
            Tag tag = audioFile.getTagOrCreateAndSetDefault();
            set(tag, FieldKey.TITLE, metadata.optString("title"));
            set(tag, FieldKey.ARTIST, metadata.optString("artist"));
            set(tag, FieldKey.ALBUM, metadata.optString("album"));
            set(tag, FieldKey.ALBUM_ARTIST, metadata.optString("albumArtist"));
            set(tag, FieldKey.YEAR, metadata.optString("year"));
            set(tag, FieldKey.TRACK, metadata.optString("track"));
            audioFile.commit();
        } catch (Exception error) {
            android.util.Log.w("SPlayerDownload", "写入音频元数据失败", error);
        }
    }

    private static void set(Tag tag, FieldKey key, String value) throws Exception {
        if (value != null && !value.trim().isEmpty()) tag.setField(key, value);
    }
}
