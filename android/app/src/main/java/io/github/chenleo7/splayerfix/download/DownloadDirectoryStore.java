package io.github.chenleo7.splayerfix.download;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

final class DownloadDirectoryStore {

    static final String DEFAULT_DIRECTORY = "内部存储/Download/SPlayer";

    private static final String PREFERENCES = "splayer_download_directory";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String KEY_DISPLAY_NAME = "display_name";

    private DownloadDirectoryStore() {}

    static DirectoryInfo get(Context context) {
        Uri uri = getWritableTreeUri(context);
        if (uri == null) return new DirectoryInfo(null, DEFAULT_DIRECTORY, false);
        String displayName = preferences(context).getString(KEY_DISPLAY_NAME, null);
        if (displayName == null || displayName.trim().isEmpty()) {
            displayName = resolveDisplayName(context, uri);
        }
        return new DirectoryInfo(uri, displayName, true);
    }

    static Uri getStoredTreeUri(Context context) {
        String value = preferences(context).getString(KEY_TREE_URI, null);
        if (value == null || value.trim().isEmpty()) return null;
        return Uri.parse(value);
    }

    static Uri getWritableTreeUri(Context context) {
        Uri stored = getStoredTreeUri(context);
        if (stored == null) return null;
        for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
            if (
                stored.equals(permission.getUri()) &&
                permission.isReadPermission() &&
                permission.isWritePermission()
            ) {
                return stored;
            }
        }
        clear(context);
        return null;
    }

    static DirectoryInfo save(Context context, Uri uri) {
        String displayName = resolveDisplayName(context, uri);
        preferences(context).edit().putString(KEY_TREE_URI, uri.toString()).putString(KEY_DISPLAY_NAME, displayName).apply();
        return new DirectoryInfo(uri, displayName, true);
    }

    static void clear(Context context) {
        preferences(context).edit().clear().apply();
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String resolveDisplayName(Context context, Uri uri) {
        try (
            Cursor cursor = context
                .getContentResolver()
                .query(uri, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.trim().isEmpty()) return value;
            }
        } catch (Exception ignored) {}
        String segment = uri.getLastPathSegment();
        return segment == null || segment.trim().isEmpty() ? "已选择的目录" : Uri.decode(segment);
    }

    static final class DirectoryInfo {

        final Uri uri;
        final String displayName;
        final boolean custom;

        DirectoryInfo(Uri uri, String displayName, boolean custom) {
            this.uri = uri;
            this.displayName = displayName;
            this.custom = custom;
        }
    }
}
