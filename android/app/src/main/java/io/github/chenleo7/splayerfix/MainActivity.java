package io.github.chenleo7.splayerfix;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.chenleo7.splayerfix.media.SPlayerMediaPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SPlayerMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
