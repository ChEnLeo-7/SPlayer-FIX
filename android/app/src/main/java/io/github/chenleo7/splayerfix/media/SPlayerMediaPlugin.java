package io.github.chenleo7.splayerfix.media;

import android.content.ComponentName;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "SPlayerMedia")
public final class SPlayerMediaPlugin extends Plugin {

    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;
    private boolean wasPlaying;
    private boolean navigationReceiverRegistered;

    private final BroadcastReceiver navigationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String direction = intent.getStringExtra(PlaybackService.EXTRA_DIRECTION);
            if (direction == null) return;
            JSObject data = new JSObject();
            data.put("direction", direction);
            notifyListeners("navigation", data);
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int playbackState) {
            if (playbackState == Player.STATE_BUFFERING) {
                emitEvent("waiting");
            } else if (playbackState == Player.STATE_READY) {
                emitEvent("canplay");
            } else if (playbackState == Player.STATE_ENDED) {
                emitEvent("ended");
            }
            emitState();
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying != wasPlaying) {
                wasPlaying = isPlaying;
                emitEvent(isPlaying ? "play" : "pause");
            }
            emitState();
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            JSObject data = createState("error");
            data.put("errorCode", error.errorCode);
            data.put("message", error.getMessage());
            notifyListeners("playbackEvent", data);
        }
    };

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            emitState();
            progressHandler.postDelayed(this, 500);
        }
    };

    @Override
    public void load() {
        ContextCompat.registerReceiver(
            getContext(),
            navigationReceiver,
            new IntentFilter(PlaybackService.ACTION_NAVIGATION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        navigationReceiverRegistered = true;
        progressHandler.post(progressRunnable);
    }

    private void connectController(PluginCall pendingCall) {
        if (controller != null) {
            if (pendingCall != null) pendingCall.resolve();
            return;
        }
        if (controllerFuture != null) {
            if (pendingCall != null) pendingCall.reject("播放器正在初始化，请稍后重试");
            return;
        }
        SessionToken token = new SessionToken(
            getContext(),
            new ComponentName(getContext(), PlaybackService.class)
        );
        controllerFuture = new MediaController.Builder(getContext(), token)
            .setApplicationLooper(Looper.getMainLooper())
            .buildAsync();
        Executor executor = getContext().getMainExecutor();
        Futures.addCallback(
            controllerFuture,
            new FutureCallback<MediaController>() {
                @Override
                public void onSuccess(MediaController result) {
                    controller = result;
                    wasPlaying = result.isPlaying();
                    result.addListener(playerListener);
                    emitState();
                    if (pendingCall != null) pendingCall.resolve();
                }

                @Override
                public void onFailure(@NonNull Throwable error) {
                    controllerFuture = null;
                    if (pendingCall != null) {
                        pendingCall.reject("无法连接 Android 播放服务", new Exception(error));
                    }
                }
            },
            executor
        );
    }

    private boolean requireController(PluginCall call) {
        if (controller == null) {
            call.reject("Android 播放服务尚未就绪");
            connectController(null);
            return false;
        }
        return true;
    }

    private void runWithController(PluginCall call, Runnable action) {
        progressHandler.post(() -> {
            if (!requireController(call)) return;
            try {
                action.run();
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Android 播放操作失败", error);
            }
        });
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        progressHandler.post(() -> connectController(call));
    }

    @PluginMethod
    public void loadMedia(PluginCall call) {
        runWithController(call, () -> {
            JSObject item = call.getObject("item");
            if (item == null) throw new IllegalArgumentException("缺少媒体信息");
            String url = item.getString("url");
            if (url == null || url.isBlank()) throw new IllegalArgumentException("播放地址为空");
            String id = item.getString("id", url);
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(item.getString("title", "未知歌曲"))
                .setArtist(item.getString("artist", "未知歌手"))
                .setAlbumTitle(item.getString("album", "未知专辑"));
            String artworkUrl = item.getString("artworkUrl");
            if (artworkUrl != null && !artworkUrl.isBlank()) {
                metadata.setArtworkUri(Uri.parse(artworkUrl));
            }
            MediaItem mediaItem = new MediaItem.Builder()
                .setMediaId(id)
                .setUri(Uri.parse(url))
                .setMediaMetadata(metadata.build())
                .build();
            boolean autoPlay = call.getBoolean("autoPlay", true);
            long positionMs = Math.max(0L, call.getLong("positionMs", 0L));
            emitEvent("loadstart");
            controller.setMediaItem(mediaItem);
            controller.prepare();
            if (positionMs > 0) controller.seekTo(positionMs);
            if (autoPlay) controller.play();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        runWithController(call, () -> controller.play());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runWithController(call, () -> controller.pause());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runWithController(call, () -> {
            controller.stop();
            controller.clearMediaItems();
            emitEvent("emptied");
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        runWithController(call, () -> {
            long positionMs = Math.max(0L, call.getLong("positionMs", 0L));
            controller.seekTo(positionMs);
            emitState();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        runWithController(call, () -> {
            double value = call.getDouble("value", 1.0);
            controller.setVolume((float) Math.max(0.0, Math.min(1.0, value)));
        });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        runWithController(call, () -> {
            double value = call.getDouble("value", 1.0);
            controller.setPlaybackSpeed((float) Math.max(0.25, Math.min(4.0, value)));
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        progressHandler.post(() -> {
            if (!requireController(call)) return;
            call.resolve(createState("state"));
        });
    }

    private JSObject createState(String event) {
        JSObject data = new JSObject();
        data.put("event", event);
        if (controller == null) {
            data.put("positionMs", 0);
            data.put("durationMs", 0);
            data.put("isPlaying", false);
            data.put("playbackState", Player.STATE_IDLE);
            return data;
        }
        data.put("positionMs", Math.max(0L, controller.getCurrentPosition()));
        data.put("durationMs", Math.max(0L, controller.getDuration()));
        data.put("isPlaying", controller.isPlaying());
        data.put("playWhenReady", controller.getPlayWhenReady());
        data.put("playbackState", controller.getPlaybackState());
        return data;
    }

    private void emitEvent(String event) {
        notifyListeners("playbackEvent", createState(event));
    }

    private void emitState() {
        if (controller != null) notifyListeners("playbackEvent", createState("timeupdate"));
    }

    @Override
    protected void handleOnDestroy() {
        progressHandler.removeCallbacks(progressRunnable);
        if (navigationReceiverRegistered) {
            getContext().unregisterReceiver(navigationReceiver);
            navigationReceiverRegistered = false;
        }
        if (controller != null) {
            controller.removeListener(playerListener);
            controller = null;
        }
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
            controllerFuture = null;
        }
        super.handleOnDestroy();
    }
}
