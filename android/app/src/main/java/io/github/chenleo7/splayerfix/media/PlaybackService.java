package io.github.chenleo7.splayerfix.media;

import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.CommandButton;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

public final class PlaybackService extends MediaSessionService {

    public static final String ACTION_NAVIGATION = "io.github.chenleo7.splayerfix.MEDIA_NAVIGATION";
    public static final String EXTRA_DIRECTION = "direction";
    private static final SessionCommand PREVIOUS_COMMAND = new SessionCommand(
        "io.github.chenleo7.splayerfix.PREVIOUS",
        Bundle.EMPTY
    );
    private static final SessionCommand NEXT_COMMAND = new SessionCommand(
        "io.github.chenleo7.splayerfix.NEXT",
        Bundle.EMPTY
    );

    private MediaSession mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        ImmutableList<CommandButton> mediaButtons = ImmutableList.of(
            new CommandButton.Builder(CommandButton.ICON_PREVIOUS)
                .setDisplayName("上一首")
                .setSessionCommand(PREVIOUS_COMMAND)
                .setSlots(CommandButton.SLOT_BACK)
                .build(),
            new CommandButton.Builder(CommandButton.ICON_NEXT)
                .setDisplayName("下一首")
                .setSessionCommand(NEXT_COMMAND)
                .setSlots(CommandButton.SLOT_FORWARD)
                .build()
        );
        MediaSession.Callback callback = new MediaSession.Callback() {
            @Override
            public MediaSession.ConnectionResult onConnect(
                MediaSession session,
                MediaSession.ControllerInfo controller
            ) {
                SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS
                    .buildUpon()
                    .add(PREVIOUS_COMMAND)
                    .add(NEXT_COMMAND)
                    .build();
                return new MediaSession.ConnectionResult.AcceptedResultBuilder(session, controller)
                    .setAvailableSessionCommands(commands)
                    .setMediaButtonPreferences(mediaButtons)
                    .build();
            }

            @Override
            public ListenableFuture<SessionResult> onCustomCommand(
                MediaSession session,
                MediaSession.ControllerInfo controller,
                SessionCommand command,
                Bundle args
            ) {
                String direction = null;
                if (PREVIOUS_COMMAND.equals(command)) direction = "previous";
                if (NEXT_COMMAND.equals(command)) direction = "next";
                if (direction != null) {
                    Intent intent = new Intent(ACTION_NAVIGATION)
                        .setPackage(getPackageName())
                        .putExtra(EXTRA_DIRECTION, direction);
                    sendBroadcast(intent);
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                }
                return MediaSession.Callback.super.onCustomCommand(session, controller, command, args);
            }
        };
        mediaSession = new MediaSession.Builder(this, player)
            .setCallback(callback)
            .setMediaButtonPreferences(mediaButtons)
            .build();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.getPlayer().release();
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }
}
