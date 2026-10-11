package io.github.chenleo7.splayerfix.download;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.List;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "SPlayerDownload",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public final class SPlayerDownloadPlugin extends Plugin {

    private DownloadRepository repository;
    private boolean receiverRegistered;

    private final BroadcastReceiver taskReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String taskJson = intent.getStringExtra(SPlayerDownloadService.EXTRA_TASK);
            if (taskJson == null) return;
            try {
                notifyListeners("taskChanged", JSObject.fromJSONObject(new JSONObject(taskJson)));
            } catch (Exception ignored) {}
        }
    };

    @Override
    public void load() {
        repository = new DownloadRepository(getContext());
        ContextCompat.registerReceiver(
            getContext(),
            taskReceiver,
            new IntentFilter(SPlayerDownloadService.ACTION_TASK_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        receiverRegistered = true;
        resumePendingTasks();
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        try {
            JSONObject task = new JSONObject(call.getData().toString());
            validateTask(task);
            task.put("status", "queued");
            task.put("transferredBytes", 0);
            task.put("totalBytes", 0);
            task.put("progress", 0);
            task.put("downloadComplete", false);
            repository.save(task);
            startService(SPlayerDownloadService.ACTION_ENQUEUE, task);
            JSObject result = new JSObject();
            result.put("task", task);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法创建下载任务" : error.getMessage(), "INVALID_TASK", error);
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray tasks = new JSArray();
        for (JSONObject task : repository.list()) {
            tasks.put(task);
            String status = task.optString("status");
            if ("completed".equals(status) || "cancelled".equals(status)) {
                repository.remove(task.optString("taskId"));
            }
        }
        JSObject result = new JSObject();
        result.put("tasks", tasks);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String taskId = call.getString("taskId");
        if (!isValidTaskId(taskId)) {
            call.reject("下载任务 ID 不能为空");
            return;
        }
        Intent intent = new Intent(getContext(), SPlayerDownloadService.class)
            .setAction(SPlayerDownloadService.ACTION_CANCEL)
            .putExtra(SPlayerDownloadService.EXTRA_TASK_ID, taskId);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void retry(PluginCall call) {
        String taskId = call.getString("taskId");
        if (!isValidTaskId(taskId)) {
            call.reject("下载任务 ID 无效");
            return;
        }
        JSONObject task = repository.get(taskId);
        if (task == null) {
            call.reject("下载任务不存在");
            return;
        }
        try {
            String url = call.getString("url");
            boolean resourceChanged = false;
            if (url != null && !url.trim().isEmpty()) {
                validateUrl(url);
                resourceChanged = !url.equals(task.optString("url"));
                task.put("url", url);
            }
            String extension = call.getString("extension");
            String mimeType = call.getString("mimeType");
            if (extension != null || mimeType != null) {
                validateFormat(extension, mimeType);
                resourceChanged = resourceChanged || !extension.equals(task.optString("extension"));
                task.put("extension", extension);
                task.put("mimeType", mimeType);
            }
            if (resourceChanged) {
                deleteTempFiles(taskId);
                task.put("transferredBytes", 0);
                task.put("totalBytes", 0);
                task.put("progress", 0);
                task.put("downloadComplete", false);
            }
            task.put("status", "queued");
            task.remove("message");
            repository.save(task);
            startService(SPlayerDownloadService.ACTION_PROCESS, null);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法重试下载", error);
        }
    }

    @PluginMethod
    public void resolveConflict(PluginCall call) {
        String taskId = call.getString("taskId");
        String policy = call.getString("policy");
        if (!"replace".equals(policy) && !"rename".equals(policy)) {
            call.reject("重名处理方式无效");
            return;
        }
        JSONObject task = repository.get(taskId);
        if (task == null) {
            call.reject("下载任务不存在");
            return;
        }
        try {
            task.put("duplicatePolicy", policy);
            task.put("status", "queued");
            task.remove("message");
            repository.save(task);
            startService(SPlayerDownloadService.ACTION_PROCESS, null);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法处理重名文件", error);
        }
    }

    @PluginMethod
    public void getDownloadDirectory(PluginCall call) {
        call.resolve(directoryResult(DownloadDirectoryStore.get(getContext()), false));
    }

    @PluginMethod
    public void chooseDownloadDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "downloadDirectorySelected");
    }

    @ActivityCallback
    @SuppressLint("WrongConstant")
    private void downloadDirectorySelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(directoryResult(DownloadDirectoryStore.get(getContext()), true));
            return;
        }
        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if ((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
            call.reject("所选目录没有写入权限");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            Uri previous = DownloadDirectoryStore.getStoredTreeUri(getContext());
            DownloadDirectoryStore.DirectoryInfo directory = DownloadDirectoryStore.save(getContext(), uri);
            if (previous != null && !previous.equals(uri)) releaseDirectoryPermission(previous);
            call.resolve(directoryResult(directory, false));
        } catch (Exception error) {
            call.reject("无法保存下载目录权限", error);
        }
    }

    @PluginMethod
    public void resetDownloadDirectory(PluginCall call) {
        Uri previous = DownloadDirectoryStore.getStoredTreeUri(getContext());
        DownloadDirectoryStore.clear(getContext());
        if (previous != null) releaseDirectoryPermission(previous);
        call.resolve(directoryResult(DownloadDirectoryStore.get(getContext()), false));
    }

    @PluginMethod
    @Override
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionResult());
    }

    @PluginMethod
    @Override
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && Build.VERSION.SDK_INT > Build.VERSION_CODES.P) {
            call.resolve(permissionResult());
            return;
        }
        requestAllPermissions(call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(permissionResult());
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put(
            "notifications",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ? "granted" : stateName(getPermissionState("notifications"))
        );
        result.put("storage", Build.VERSION.SDK_INT > Build.VERSION_CODES.P ? "granted" : stateName(getPermissionState("storage")));
        return result;
    }

    private String stateName(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE) return "prompt";
        return "denied";
    }

    private JSObject directoryResult(DownloadDirectoryStore.DirectoryInfo directory, boolean cancelled) {
        JSObject result = new JSObject();
        result.put("displayName", directory.displayName);
        result.put("custom", directory.custom);
        result.put("cancelled", cancelled);
        return result;
    }

    private void releaseDirectoryPermission(Uri uri) {
        try {
            getContext()
                .getContentResolver()
                .releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
        } catch (Exception ignored) {}
    }

    private void validateTask(JSONObject task) throws Exception {
        if (!isValidTaskId(require(task, "taskId"))) throw new IllegalArgumentException("下载任务 ID 无效");
        require(task, "clientKey");
        validateUrl(require(task, "url"));
        require(task, "fileName");
        String extension = require(task, "extension");
        validateFormat(extension, require(task, "mimeType"));
        String policy = task.optString("duplicatePolicy", "ask");
        if (!policy.equals("ask") && !policy.equals("replace") && !policy.equals("rename")) {
            throw new IllegalArgumentException("重名处理方式无效");
        }
    }

    private void validateUrl(String value) {
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        if ((!"http".equals(scheme) && !"https".equals(scheme)) || uri.getHost() == null) {
            throw new IllegalArgumentException("下载地址无效");
        }
    }

    private String require(JSONObject task, String key) throws Exception {
        String value = task.optString(key);
        if (value.trim().isEmpty()) throw new IllegalArgumentException(key + " 不能为空");
        return value;
    }

    private void validateFormat(String extension, String mimeType) {
        boolean isMp3 = "mp3".equals(extension) && "audio/mpeg".equals(mimeType);
        boolean isFlac = "flac".equals(extension) && "audio/flac".equals(mimeType);
        if (!isMp3 && !isFlac) throw new IllegalArgumentException("不支持的音频格式");
    }

    private boolean isValidTaskId(String taskId) {
        return taskId != null && taskId.matches("[A-Za-z0-9_-]{1,128}");
    }

    private void deleteTempFiles(String taskId) {
        File directory = getContext().getExternalFilesDir("downloads");
        File[] files = directory == null ? null : directory.listFiles((dir, name) -> name.startsWith(taskId + ".part."));
        if (files == null) return;
        for (File file : files) file.delete();
    }

    private void startService(String action, JSONObject task) {
        Intent intent = new Intent(getContext(), SPlayerDownloadService.class).setAction(action);
        if (task != null) intent.putExtra(SPlayerDownloadService.EXTRA_TASK, task.toString());
        ContextCompat.startForegroundService(getContext(), intent);
    }

    private void resumePendingTasks() {
        List<JSONObject> tasks = repository.list();
        boolean hasPending = false;
        for (JSONObject task : tasks) {
            String status = task.optString("status");
            if ("downloading".equals(status) || "queued".equals(status)) {
                hasPending = true;
                break;
            }
        }
        if (hasPending) startService(SPlayerDownloadService.ACTION_PROCESS, null);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiverRegistered) {
            getContext().unregisterReceiver(taskReceiver);
            receiverRegistered = false;
        }
        super.handleOnDestroy();
    }
}
