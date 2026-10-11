package io.github.chenleo7.splayerfix.download;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class DownloadRepository {

    private static final String PREFERENCES = "splayer_downloads";
    private static final String TASKS = "tasks";
    private final SharedPreferences preferences;

    DownloadRepository(Context context) {
        preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    synchronized List<JSONObject> list() {
        List<JSONObject> tasks = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(preferences.getString(TASKS, "[]"));
            for (int i = 0; i < array.length(); i++) tasks.add(array.getJSONObject(i));
        } catch (JSONException ignored) {
            preferences.edit().remove(TASKS).apply();
        }
        return tasks;
    }

    synchronized JSONObject get(String taskId) {
        for (JSONObject task : list()) {
            if (taskId.equals(task.optString("taskId"))) return task;
        }
        return null;
    }

    synchronized void save(JSONObject task) {
        List<JSONObject> tasks = list();
        boolean replaced = false;
        for (int i = 0; i < tasks.size(); i++) {
            if (task.optString("taskId").equals(tasks.get(i).optString("taskId"))) {
                tasks.set(i, task);
                replaced = true;
                break;
            }
        }
        if (!replaced) tasks.add(task);
        write(tasks);
    }

    synchronized void remove(String taskId) {
        List<JSONObject> tasks = list();
        tasks.removeIf(task -> taskId.equals(task.optString("taskId")));
        write(tasks);
    }

    synchronized JSONObject nextPending() {
        for (JSONObject task : list()) {
            String status = task.optString("status");
            if ("queued".equals(status) || "downloading".equals(status)) return task;
        }
        return null;
    }

    private void write(List<JSONObject> tasks) {
        JSONArray array = new JSONArray();
        for (JSONObject task : tasks) array.put(task);
        preferences.edit().putString(TASKS, array.toString()).apply();
    }
}
