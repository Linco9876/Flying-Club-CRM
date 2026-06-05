# Student Progress Video

The CRM previews the Remotion student progress video directly inside a student profile popup.

1. Open a student profile.
2. Go to `Training Records` or `Courses`.
3. Click `Preview Video`.

Remotion still needs Node/Chromium to render a downloadable MP4. If the app later needs true MP4 downloads, add a server-side render worker or use the local render script with a props JSON file:

```powershell
npm run render:student-progress -- --props="C:\Path\To\student-progress-video.json" --out="student-progress.mp4"
```
