package io.github.chenleo7.splayerfix;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import io.github.chenleo7.splayerfix.media.SPlayerMediaPlugin;
import io.github.chenleo7.splayerfix.download.SPlayerDownloadPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        EdgeToEdge.enable(this);
        registerPlugin(SPlayerMediaPlugin.class);
        registerPlugin(SPlayerDownloadPlugin.class);
        registerPlugin(SPlayerServerPlugin.class);
        registerPlugin(SPlayerAccountKeyPlugin.class);
        super.onCreate(savedInstanceState);
        if (getSupportActionBar() != null) getSupportActionBar().hide();
        configureEdgeToEdge();
    }

    private void configureEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            int top = Math.round(insets.top / density);
            int right = Math.round(insets.right / density);
            int bottom = Math.round(insets.bottom / density);
            int left = Math.round(insets.left / density);
            String script = String.format(
                java.util.Locale.US,
                "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');",
                top,
                right,
                bottom,
                left
            );
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(getWindow().getDecorView());
    }
}
