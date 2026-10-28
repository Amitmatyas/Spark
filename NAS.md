# התקנה על NAS (QNAP)

המערכת רצה ב-Docker על ה-NAS, 24/7, בלי מחשב דלוק. כל המערכת צורכת בערך 200MB זיכרון, ובמנוחה כמעט לא משתמשת במעבד.

**כתובת קבועה עם HTTPS:** Tailscale Funnel נותן כתובת בסגנון `https://spark.xxxx.ts.net`. היא בחינם, ולא צריך לפתוח פורטים בראוטר.

## 1. Tailscale (פעם אחת, בערך 5 דקות)

1. נרשמים ב-[login.tailscale.com](https://login.tailscale.com) עם חשבון Google. החשבון חינמי.
2. מפעילים HTTPS: **DNS** ← בתחתית העמוד ← **Enable HTTPS**. אם MagicDNS כבוי, מפעילים אותו גם.
3. בודקים שיש הרשאה ל-Funnel: **Access controls**. בחשבונות חדשים יש כבר בלוק `nodeAttrs` עם `"funnel"`. אם אין, מוסיפים:
   ```json
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
   ```
4. יוצרים מפתח: **Settings ← Keys ← Generate auth key**. לא מסמנים Ephemeral, ומעתיקים את המפתח.
5. ב-**DNS** רואים את שם ה-tailnet, למשל `tail1234.ts.net`. הכתובת של המערכת תהיה `https://spark.tail1234.ts.net`.

## 2. ה-NAS

1. ב-App Center מתקינים **Container Station**.
2. מפעילים SSH: **Control Panel ← Network & File Services ← Telnet / SSH ← Allow SSH connection**.
3. ב-File Station יוצרים את התיקייה `Container/spark`, ומעתיקים אליה את כל התיקייה `~/Documents/SPARK/system` מהמק. אפשר לגרור דרך Finder, תחת "התחבר לשרת" ← `smb://<IP-של-ה-NAS>`.
   - **מעתיקים גם** את `.env`, `oauth-client.json` ואת התיקייה `data`, שבה נמצאים הלקוחות, הפניות והחיבור לדרייב (`data/token.json`).
   - **לא צריך** את `node_modules`.
4. עורכים בתיקייה את הקובץ `.env`:
   ```
   PUBLIC_URL=https://spark.tail1234.ts.net
   TS_AUTHKEY=tskey-auth-...
   ```

## 3. הפעלה

מהמק, בטרמינל:

```bash
ssh admin@<IP-של-ה-NAS>
```

ובתוך ה-NAS:

```bash
cd /share/Container/spark && docker compose up -d --build
```

הבנייה הראשונה לוקחת כמה דקות. אחר כך רואים את הלוגים עם:

```bash
docker compose logs -f spark
```

## 4. לפני שנכנסים

1. **עוצרים את המערכת במק.** אסור שאותו חיבור וואטסאפ ירוץ בשני מקומות.
2. **Google:** ב-Google Cloud Console ← Credentials ← ה-OAuth client ← Authorized redirect URIs, מוסיפים:
   ```
   https://spark.tail1234.ts.net/oauth2callback
   ```
3. נכנסים ל-`https://spark.tail1234.ts.net/admin`, ותחת **הגדרות** סורקים את ה-QR של וואטסאפ מהטלפון של הסטודיו.
4. ללקוחות קיימים שולחים קישור חדש לאזור האישי.

## 5. דף הנחיתה ב-Vercel

הדף כבר שולח את הטופס לשרת ב-NAS כשהוא לא רץ עליו (`API_BASE` ב-`public/index.html`), והשרת מקבל פניות מכל דומיין. אם כתובת ה-NAS משתנה, מעדכנים אותה בשני מקומות:

- `API_BASE` ב-`public/index.html`.
- כל ה-`destination` ב-`vercel.json` (הניהול, האזור האישי וההתחברות עוברים ל-NAS).

## עדכון קוד

מעתיקים את הקבצים שהשתנו לתיקייה ב-NAS, ואז:

```bash
cd /share/Container/spark && docker compose up -d --build
```

## אם משהו לא עובד

- **הכתובת לא נפתחת:** בודקים ב-`docker compose logs tailscale` שאין שגיאה. אחרי ההפעלה הראשונה, Funnel יכול לקחת עד כמה דקות.
- **redirect_uri_mismatch:** הכתובת ב-Google לא זהה בדיוק לכתובת ב-`PUBLIC_URL`.
- **הניהול מהבית:** אפשר גם בכתובת `http://<IP-של-ה-NAS>:3000/admin`, אבל ההתחברות עם Google עובדת רק בכתובת שהוגדרה.
