package io.github.chenleo7.splayerfix;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SPlayerAccountKey")
public final class SPlayerAccountKeyPlugin extends Plugin {

    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "splayer_account_vault_key_v1";
    private static final String KEY_PREFERENCES = "splayer_account_keys";
    private static final String SERVER_PREFERENCES = "splayer_server";
    private static final String SERVER_URL_KEY = "server_url";

    @PluginMethod
    public void saveKey(PluginCall call) {
        try {
            requireSecureServer();
            String accountId = requireString(call, "accountId");
            String key = requireString(call, "key");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] ciphertext = cipher.doFinal(key.getBytes(StandardCharsets.UTF_8));
            String value = encode(cipher.getIV()) + "." + encode(ciphertext);
            preferences().edit().putString(scopeKey(accountId), value).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存账户设备密钥", "KEY_STORE_ERROR", error);
        }
    }

    @PluginMethod
    public void getKey(PluginCall call) {
        try {
            requireSecureServer();
            String accountId = requireString(call, "accountId");
            String scopeKey = scopeKey(accountId);
            String value = preferences().getString(scopeKey, null);
            JSObject result = new JSObject();
            if (value == null || value.trim().isEmpty()) {
                result.put("key", JSObject.NULL);
                call.resolve(result);
                return;
            }
            String[] parts = value.split("\\.", 2);
            if (parts.length != 2) throw new IllegalStateException("设备密钥格式无效");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, decode(parts[0])));
            String key = new String(cipher.doFinal(decode(parts[1])), StandardCharsets.UTF_8);
            result.put("key", key);
            call.resolve(result);
        } catch (Exception error) {
            try {
                String accountId = call.getString("accountId");
                if (accountId != null) preferences().edit().remove(scopeKey(accountId)).apply();
            } catch (Exception ignored) {
                // 忽略损坏记录清理失败
            }
            call.reject("账户设备密钥已失效", "KEY_INVALID", error);
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        try {
            String accountId = requireString(call, "accountId");
            preferences().edit().remove(scopeKey(accountId)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法删除账户设备密钥", "KEY_STORE_ERROR", error);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(KEY_PREFERENCES, 0);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE);
        keyGenerator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return keyGenerator.generateKey();
    }

    private void requireSecureServer() {
        String serverUrl = getContext()
            .getSharedPreferences(SERVER_PREFERENCES, 0)
            .getString(SERVER_URL_KEY, "");
        if (!serverUrl.startsWith("https://")) {
            throw new SecurityException("HTTP 服务不允许持久化账户密钥");
        }
    }

    private String scopeKey(String accountId) throws Exception {
        String serverUrl = getContext()
            .getSharedPreferences(SERVER_PREFERENCES, 0)
            .getString(SERVER_URL_KEY, "");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest((serverUrl + "\n" + accountId).getBytes(StandardCharsets.UTF_8));
        return encode(hash);
    }

    private static String requireString(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException(name + " 不能为空");
        return value;
    }

    private static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.NO_WRAP | Base64.URL_SAFE);
    }

    private static byte[] decode(String value) {
        return Base64.decode(value, Base64.NO_WRAP | Base64.URL_SAFE);
    }
}
