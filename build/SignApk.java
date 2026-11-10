import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * 用 apksig 给 APK 做 v2 + v3 签名（v1 不签：minSdk 24 起 v2 已足够，
 * 而且 v1 会重写 zip，破坏我们预先做好的 4 字节对齐）。
 *
 * 用法：
 *   java -cp apksig.jar:. SignApk <in.apk> <out.apk> <keystore> <storepass> <keypass> <alias>
 *   java -cp apksig.jar:. SignApk --verify <apk>
 */
public class SignApk {
    public static void main(String[] args) throws Exception {
        if (args.length == 2 && "--verify".equals(args[0])) {
            verify(args[1]);
            return;
        }
        if (args.length < 6) {
            System.err.println("usage: SignApk <in> <out> <keystore> <storepass> <keypass> <alias>");
            System.err.println("       SignApk --verify <apk>");
            System.exit(2);
        }
        String in = args[0], out = args[1], ksPath = args[2];
        char[] storePass = args[3].toCharArray();
        char[] keyPass = args[4].toCharArray();
        String alias = args[5];

        KeyStore ks = KeyStore.getInstance(guessType(ksPath));
        try (FileInputStream fis = new FileInputStream(ksPath)) {
            ks.load(fis, storePass);
        }
        PrivateKey key = (PrivateKey) ks.getKey(alias, keyPass);
        X509Certificate cert = (X509Certificate) ks.getCertificate(alias);
        if (key == null || cert == null) {
            throw new IllegalStateException("keystore 里找不到别名 " + alias);
        }

        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder(
                "WMC", key, Collections.singletonList(cert)).build();

        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(new File(in))
                .setOutputApk(new File(out))
                .setV1SigningEnabled(false)
                .setV2SigningEnabled(true)
                .setV3SigningEnabled(true)
                .setMinSdkVersion(24)
                .build()
                .sign();

        System.out.println("SIGNED " + out);
    }

    private static void verify(String apk) throws Exception {
        ApkVerifier.Result r = new ApkVerifier.Builder(new File(apk)).build().verify();
        if (!r.isVerified()) {
            System.err.println("VERIFY FAILED: " + r.getErrors());
            System.exit(1);
        }
        System.out.println("VERIFIED v1=" + r.isVerifiedUsingV1Scheme()
                + " v2=" + r.isVerifiedUsingV2Scheme()
                + " v3=" + r.isVerifiedUsingV3Scheme()
                + " certs=" + r.getSignerCertificates().size());
    }

    private static String guessType(String p) {
        String s = p.toLowerCase();
        if (s.endsWith(".p12") || s.endsWith(".pfx") || s.endsWith(".pkcs12")) return "PKCS12";
        return "JKS";
    }
}
