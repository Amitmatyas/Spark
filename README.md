<div dir="rtl">

<p align="center">
  <img src="public/assets/spark-logo-3d.png" alt="SPARK" width="160">
</p>

<h1 align="center">SPARK</h1>

<p align="center">סטודיו לעריכת וידאו ובניית אתרים</p>

<p align="center">
  <a href="https://sparks.qd.je">sparks.qd.je</a> ·
  <a href="https://spark-studio-pi.vercel.app">Vercel</a>
</p>

## מה יש כאן

ה-repo מכיל את דף הנחיתה הציבורי של SPARK ואת הדפים המשפטיים שלו. זה אתר סטטי, בלי build ובלי תלויות.

המערכת עצמה (שרת, ממשק ניהול, אזור אישי ללקוחות, וואטסאפ ועוזר AI) רצה על ה-NAS של הסטודיו ולא נמצאת במאגר. טופס הפנייה בדף שולח אליה בקשות דרך `API_BASE`, שמוגדר ב-`public/index.html` וב-`public/assets/legal.js`.

## מבנה

```
.
├── .github/workflows/deploy.yml   פריסה ל-GitHub Pages בכל push ל-main
├── vercel.json                    פריסה ל-Vercel
└── public/                        כל מה שמתפרסם
    ├── index.html                 דף הנחיתה
    ├── privacy.html               מדיניות פרטיות
    ├── terms.html                 תנאי שימוש
    ├── accessibility.html         הצהרת נגישות
    ├── 404.html
    ├── robots.txt, sitemap.xml
    ├── favicon.ico, CNAME
    ├── assets/                    CSS, JS, פונט, לוגו ואייקונים
    └── media/                     סרטון הפרומו ותמונת השיתוף
```

## הרצה מקומית

```bash
npx serve public
```

הקישורים בדפים המשפטיים מתחילים ב-`/`, לכן צריך להריץ מתוך `public` ולא לפתוח את הקבצים ישירות מהדיסק.

## פריסה

- **GitHub Pages:** כל push ל-`main` מפעיל את `deploy.yml`, שמפרסם את `public` לדומיין `sparks.qd.je` (מתוך `public/CNAME`).
- **Vercel:** מפרסם את `public` לפי `vercel.json`.

בשני המקרים `__SITE_URL__` ב-`index.html`, `sitemap.xml` ו-`robots.txt` מוחלף בכתובת האתר בזמן הפריסה. כדאי להשאיר אותו כך בקוד.

## מה נכנס ל-repo

`.gitignore` עובד כרשימת היתרים: הכל מוחרג חוץ מהקבצים שמופיעים בו במפורש. קובץ חדש ב-`public` לא ייכנס ל-git עד שמוסיפים אותו לרשימה.

</div>
