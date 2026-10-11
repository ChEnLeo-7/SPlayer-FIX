package io.github.chenleo7.splayerfix.download;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import io.github.chenleo7.splayerfix.MainActivity;
import io.github.chenleo7.splayerfix.R;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class SPlayerDownloadService extends Service {

    public static final String ACTION_ENQUEUE = "io.github.chenleo7.splayerfix.DOWNLOAD_ENQUEUE";
    public static final String ACTION_CANCEL = "io.github.chenleo7.splayerfix.DOWNLOAD_CANCEL";
    public static final String ACTION_PROCESS = "io.github.chenleo7.splayerfix.DOWNLOAD_PROCESS";
    public static final String ACTION_TASK_CHANGED = "io.github.chenleo7.splayerfix.DOWNLOAD_TASK_CHANGED";
    public static final String EXTRA_TASK = "task";
    public static final String EXTRA_TASK_ID = "taskId";

    private static final String CHANNEL_ID = "splayer_downloads";
    private static final int NOTIFICATION_ID = 3102;
    private static final Set<String> cancelledTasks = new HashSet<>();

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private DownloadRepository repository;
    private volatile boolean processing;

    @Override
    public void onCreate() {
        super.onCreate();
        repository = new DownloadRepository(this);
        createNotificationChannel();
        startForeground("正在准备下载", 0, 0);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_PROCESS : intent.getAction();
        if (ACTION_ENQUEUE.equals(action)) {
            String taskJson = intent.getStringExtra(EXTRA_TASK);
            if (taskJson != null) {
                try {
                    JSONObject task = new JSONObject(taskJson);
                    task.put("status", "queued");
                    repository.save(task);
                    emit(task);
                } catch (Exception error) {
                    android.util.Log.e("SPlayerDownload", "保存下载任务失败", error);
                }
            }
        } else if (ACTION_CANCEL.equals(action)) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            if (taskId != null) cancelTask(taskId);
        }
        processQueue();
        return START_STICKY;
    }

    private void processQueue() {
        if (processing) return;
        processing = true;
        executor.execute(() -> {
            try {
                JSONObject task;
                while ((task = repository.nextPending()) != null) download(task);
            } finally {
                processing = false;
                if (repository.nextPending() == null) {
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
                    stopSelf();
                }
            }
        });
    }

    private void download(JSONObject task) {
        String taskId = task.optString("taskId");
        String extension = task.optString("extension", "mp3");
        File tempFile = new File(getExternalFilesDir("downloads"), taskId + ".part." + extension);
        HttpURLConnection connection = null;
        try {
            File parent = tempFile.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) {
                throw new IllegalStateException("无法创建下载临时目录");
            }
            long expectedBytes = task.optLong("totalBytes", 0);
            if (tempFile.exists() && (task.optBoolean("downloadComplete", false) || (expectedBytes > 0 && tempFile.length() >= expectedBytes))) {
                task.put("downloadComplete", true);
                repository.save(task);
                finishTask(task, tempFile);
                return;
            }
            long existingBytes = tempFile.exists() ? tempFile.length() : 0;
            URL url = URI.create(task.getString("url")).toURL();
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "SPlayer-Android");
            if (existingBytes > 0) connection.setRequestProperty("Range", "bytes=" + existingBytes + "-");
            int responseCode = connection.getResponseCode();
            boolean append = existingBytes > 0 && responseCode == HttpURLConnection.HTTP_PARTIAL;
            if (responseCode < 200 || responseCode >= 300) {
                throw new IllegalStateException("下载服务器返回 HTTP " + responseCode);
            }
            if (!append) existingBytes = 0;
            long responseLength = connection.getContentLengthLong();
            long totalBytes = responseLength > 0 ? existingBytes + responseLength : 0;
            task.put("status", "downloading");
            task.put("transferredBytes", existingBytes);
            task.put("totalBytes", totalBytes);
            update(task, true);

            try (
                InputStream input = connection.getInputStream();
                OutputStream output = new FileOutputStream(tempFile, append)
            ) {
                byte[] buffer = new byte[64 * 1024];
                long transferred = existingBytes;
                long lastUpdate = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (isCancelled(taskId)) throw new DownloadCancelledException();
                    output.write(buffer, 0, count);
                    transferred += count;
                    long now = System.currentTimeMillis();
                    if (now - lastUpdate >= 500) {
                        task.put("transferredBytes", transferred);
                        task.put("progress", totalBytes > 0 ? transferred * 100.0 / totalBytes : 0);
                        update(task, false);
                        lastUpdate = now;
                    }
                }
            }

            task.put("downloadComplete", true);
            repository.save(task);
            finishTask(task, tempFile);
        } catch (DownloadConflictException error) {
            put(task, "status", "conflict");
            put(task, "message", "目标文件已存在");
            update(task, true);
        } catch (DownloadCancelledException error) {
            tempFile.delete();
            put(task, "status", "cancelled");
            put(task, "message", "下载已取消");
            update(task, true);
        } catch (Exception error) {
            put(task, "status", "failed");
            put(task, "message", error.getMessage() == null ? "下载失败" : error.getMessage());
            update(task, true);
        } finally {
            if (connection != null) connection.disconnect();
            synchronized (cancelledTasks) {
                cancelledTasks.remove(taskId);
            }
        }
    }

    private void finishTask(JSONObject task, File tempFile) throws Exception {
        File publishFile = new File(
            tempFile.getParentFile(),
            task.getString("taskId") + ".publish." + task.getString("extension")
        );
        try {
            ensureNotCancelled(task.getString("taskId"));
            if (publishFile.exists() && !publishFile.delete()) {
                throw new IllegalStateException("无法清理下载发布缓存");
            }
            try (InputStream input = new FileInputStream(tempFile); OutputStream output = new FileOutputStream(publishFile)) {
                copy(input, output, task.getString("taskId"));
            }
            ensureNotCancelled(task.getString("taskId"));
            TextMetadataWriter.write(publishFile, task.optJSONObject("metadata"));
            ensureNotCancelled(task.getString("taskId"));
            String savedUri = publish(task, publishFile);
            task.put("status", "completed");
            task.put("progress", 100);
            task.put("transferredBytes", tempFile.length());
            task.put("savedUri", savedUri);
            update(task, true);
            tempFile.delete();
        } finally {
            publishFile.delete();
        }
    }

    private String publish(JSONObject task, File tempFile) throws Exception {
        String extension = task.getString("extension").toLowerCase(Locale.ROOT);
        if (!extension.equals("mp3") && !extension.equals("flac")) {
            throw new IllegalArgumentException("不支持的音频格式");
        }
        String baseName = sanitizeFileName(task.getString("fileName"));
        String fileName = baseName + "." + extension;
        String policy = task.optString("duplicatePolicy", "ask");
        Uri customDirectory = DownloadDirectoryStore.getWritableTreeUri(this);
        if (customDirectory != null) {
            return publishDocumentTree(task, tempFile, fileName, policy, customDirectory);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return publishMediaStore(task, tempFile, fileName, policy);
        }
        return publishLegacy(task, tempFile, fileName, policy);
    }

    private String publishDocumentTree(
        JSONObject task,
        File tempFile,
        String fileName,
        String policy,
        Uri treeUri
    ) throws Exception {
        Uri existing = findTreeFile(treeUri, fileName);
        if (existing != null && "ask".equals(policy)) throw new DownloadConflictException();
        if (existing != null && "rename".equals(policy)) {
            fileName = findAvailableTreeName(treeUri, fileName);
            existing = null;
        }
        if (existing == null) {
            Uri target = createTreeFile(treeUri, task.getString("mimeType"), fileName);
            try {
                writeTreeFile(task, tempFile, target);
                return target.toString();
            } catch (Exception error) {
                deleteTreeFile(target);
                throw error;
            }
        }

        String extension = task.getString("extension");
        String taskId = task.getString("taskId");
        String stagingName = findAvailableTreeName(treeUri, "." + taskId + ".splayer-publish." + extension);
        Uri staging = createTreeFile(treeUri, task.getString("mimeType"), stagingName);
        Uri backup = null;
        try {
            writeTreeFile(task, tempFile, staging);
            ensureNotCancelled(taskId);
            String backupName = findAvailableTreeName(treeUri, "." + taskId + ".splayer-backup." + extension);
            backup = DocumentsContract.renameDocument(getContentResolver(), existing, backupName);
            if (backup == null) throw new IllegalStateException("无法备份已有文件");
            Uri published = DocumentsContract.renameDocument(getContentResolver(), staging, fileName);
            if (published == null) throw new IllegalStateException("无法发布下载文件");
            deleteTreeFile(backup);
            return published.toString();
        } catch (Exception error) {
            if (backup != null && findTreeFile(treeUri, fileName) == null) {
                try {
                    DocumentsContract.renameDocument(getContentResolver(), backup, fileName);
                } catch (Exception ignored) {}
            }
            deleteTreeFile(staging);
            throw error;
        }
    }

    private void writeTreeFile(JSONObject task, File source, Uri target) throws Exception {
        try (
            InputStream input = new FileInputStream(source);
            OutputStream output = getContentResolver().openOutputStream(target, "rwt")
        ) {
            if (output == null) throw new IllegalStateException("无法打开下载目录文件");
            copy(input, output, task.getString("taskId"));
        }
        ensureNotCancelled(task.getString("taskId"));
    }

    private Uri createTreeFile(Uri treeUri, String mimeType, String fileName) throws Exception {
        Uri uri = DocumentsContract.createDocument(getContentResolver(), treeRoot(treeUri), mimeType, fileName);
        if (uri == null) throw new IllegalStateException("无法在所选目录创建文件");
        return uri;
    }

    private Uri findTreeFile(Uri treeUri, String fileName) {
        Uri root = treeRoot(treeUri);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, DocumentsContract.getDocumentId(root));
        try (
            Cursor cursor = getContentResolver()
                .query(
                    children,
                    new String[] {
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME
                    },
                    null,
                    null,
                    null
                )
        ) {
            if (cursor == null) return null;
            while (cursor.moveToNext()) {
                if (fileName.equals(cursor.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0));
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String findAvailableTreeName(Uri treeUri, String original) {
        if (findTreeFile(treeUri, original) == null) return original;
        String[] parts = splitName(original);
        for (int index = 1; index < 10000; index++) {
            String candidate = parts[0] + " (" + index + ")." + parts[1];
            if (findTreeFile(treeUri, candidate) == null) return candidate;
        }
        return System.currentTimeMillis() + "-" + original;
    }

    private Uri treeRoot(Uri treeUri) {
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
    }

    private void deleteTreeFile(Uri uri) {
        try {
            DocumentsContract.deleteDocument(getContentResolver(), uri);
        } catch (Exception ignored) {}
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private String publishMediaStore(JSONObject task, File tempFile, String fileName, String policy) throws Exception {
        ContentResolver resolver = getContentResolver();
        Uri existing = findMediaStoreFile(fileName);
        if (existing != null) {
            if ("ask".equals(policy)) throw new DownloadConflictException();
            if ("rename".equals(policy)) {
                fileName = findAvailableMediaStoreName(fileName);
                existing = null;
            }
        }
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, task.getString("mimeType"));
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SPlayer");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("无法创建系统下载文件");
        try {
            try (InputStream input = new FileInputStream(tempFile); OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("无法打开系统下载文件");
                copy(input, output, task.getString("taskId"));
            }
            ensureNotCancelled(task.getString("taskId"));
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, values, null, null) <= 0) {
                throw new IllegalStateException("无法发布系统下载文件");
            }
            ensureNotCancelled(task.getString("taskId"));
            if (existing != null && resolver.delete(existing, null, null) <= 0) {
                throw new IllegalStateException("无法覆盖已有文件");
            }
            return uri.toString();
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
    }

    private String publishLegacy(JSONObject task, File tempFile, String fileName, String policy) throws Exception {
        File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "SPlayer");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建 Download/SPlayer");
        recoverLegacyBackups(directory);
        File target = new File(directory, fileName);
        if (target.exists()) {
            if ("ask".equals(policy)) throw new DownloadConflictException();
            if ("rename".equals(policy)) target = findAvailableLegacyFile(directory, fileName);
        }
        File staging = new File(directory, "." + task.getString("taskId") + ".splayer-publish");
        if (staging.exists() && !staging.delete()) throw new IllegalStateException("无法清理下载发布缓存");
        File backup = null;
        boolean targetPublished = false;
        try {
            try (InputStream input = new FileInputStream(tempFile); OutputStream output = new FileOutputStream(staging)) {
                copy(input, output, task.getString("taskId"));
            }
            ensureNotCancelled(task.getString("taskId"));
            if (target.exists()) {
                backup = legacyBackupFile(directory, target.getName());
                if (backup.exists() && !backup.delete()) throw new IllegalStateException("无法清理文件覆盖备份");
                if (!target.renameTo(backup)) throw new IllegalStateException("无法备份已有文件");
            }
            ensureNotCancelled(task.getString("taskId"));
            if (!staging.renameTo(target)) throw new IllegalStateException("无法发布下载文件");
            targetPublished = true;
            ensureNotCancelled(task.getString("taskId"));
            if (backup != null) backup.delete();
        } catch (Exception error) {
            if (targetPublished) target.delete();
            if (backup != null && backup.exists() && !target.exists()) backup.renameTo(target);
            staging.delete();
            throw error;
        }
        MediaScannerConnection.scanFile(this, new String[] { target.getAbsolutePath() }, new String[] { task.getString("mimeType") }, null);
        return Uri.fromFile(target).toString();
    }

    private void recoverLegacyBackups(File directory) {
        File[] backups = directory.listFiles((dir, name) -> name.startsWith(".") && name.endsWith(".splayer-backup"));
        if (backups == null) return;
        for (File backup : backups) {
            String name = backup.getName();
            String originalName = name.substring(1, name.length() - ".splayer-backup".length());
            File original = new File(directory, originalName);
            if (original.exists()) {
                backup.delete();
            } else {
                backup.renameTo(original);
            }
        }
    }

    private File legacyBackupFile(File directory, String fileName) {
        return new File(directory, "." + fileName + ".splayer-backup");
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private Uri findMediaStoreFile(String fileName) {
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        String[] args = { fileName, Environment.DIRECTORY_DOWNLOADS + "/SPlayer/" };
        try (
            Cursor cursor = getContentResolver().query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[] { MediaStore.MediaColumns._ID },
                selection,
                args,
                null
            )
        ) {
            if (cursor != null && cursor.moveToFirst()) {
                return Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, String.valueOf(cursor.getLong(0)));
            }
        }
        return null;
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private String findAvailableMediaStoreName(String original) {
        String[] parts = splitName(original);
        for (int index = 1; index < 10000; index++) {
            String candidate = parts[0] + " (" + index + ")." + parts[1];
            if (findMediaStoreFile(candidate) == null) return candidate;
        }
        return System.currentTimeMillis() + "-" + original;
    }

    private File findAvailableLegacyFile(File directory, String original) {
        String[] parts = splitName(original);
        for (int index = 1; index < 10000; index++) {
            File candidate = new File(directory, parts[0] + " (" + index + ")." + parts[1]);
            if (!candidate.exists()) return candidate;
        }
        return new File(directory, System.currentTimeMillis() + "-" + original);
    }

    private String[] splitName(String name) {
        int dot = name.lastIndexOf('.');
        return new String[] { dot > 0 ? name.substring(0, dot) : name, dot > 0 ? name.substring(dot + 1) : "mp3" };
    }

    private String sanitizeFileName(String value) {
        String safe = value.replaceAll("[\\x00-\\x1f<>:\"/\\\\|?*]", "&").replaceAll("[ .]+$", "").trim();
        if (safe.trim().isEmpty()) safe = "未知歌曲";
        if (safe.length() > 180) safe = safe.substring(0, 179) + "…";
        return safe;
    }

    private void update(JSONObject task, boolean persistImmediately) {
        repository.save(task);
        emit(task);
        if ("downloading".equals(task.optString("status"))) {
            startForeground(
                "正在下载 " + task.optString("fileName"),
                task.optInt("progress", 0),
                task.optLong("totalBytes", 0)
            );
        }
    }

    private void emit(JSONObject task) {
        Intent event = new Intent(ACTION_TASK_CHANGED).setPackage(getPackageName());
        event.putExtra(EXTRA_TASK, task.toString());
        sendBroadcast(event);
    }

    private void cancelTask(String taskId) {
        synchronized (cancelledTasks) {
            cancelledTasks.add(taskId);
        }
        JSONObject task = repository.get(taskId);
        if (task != null && !"downloading".equals(task.optString("status"))) {
            repository.remove(taskId);
            deleteTempFiles(taskId);
            put(task, "status", "cancelled");
            emit(task);
        }
    }

    private void deleteTempFiles(String taskId) {
        File directory = getExternalFilesDir("downloads");
        File[] files = directory == null ? null : directory.listFiles((dir, name) -> name.startsWith(taskId + ".part."));
        if (files == null) return;
        for (File file : files) file.delete();
    }

    private boolean isCancelled(String taskId) {
        synchronized (cancelledTasks) {
            return cancelledTasks.contains(taskId);
        }
    }

    private void ensureNotCancelled(String taskId) throws DownloadCancelledException {
        if (isCancelled(taskId)) throw new DownloadCancelledException();
    }

    private void startForeground(String title, int progress, long total) {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .setProgress(100, progress, total <= 0);
        JSONObject current = repository == null ? null : repository.nextPending();
        if (current != null) {
            Intent cancelIntent = new Intent(this, SPlayerDownloadService.class)
                .setAction(ACTION_CANCEL)
                .putExtra(EXTRA_TASK_ID, current.optString("taskId"));
            PendingIntent cancelPending = PendingIntent.getService(
                this,
                current.optString("taskId").hashCode(),
                cancelIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "取消", cancelPending);
        }
        Notification notification = builder.build();
        int serviceType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, serviceType);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "歌曲下载", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("显示 SPlayer 歌曲下载进度");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void copy(InputStream input, OutputStream output, String taskId) throws Exception {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) {
            ensureNotCancelled(taskId);
            output.write(buffer, 0, count);
        }
    }

    private void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Exception ignored) {}
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf(startId);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private static final class DownloadCancelledException extends Exception {}

    private static final class DownloadConflictException extends Exception {}
}
