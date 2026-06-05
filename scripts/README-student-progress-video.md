# Student Progress Video Export

The CRM exports Remotion render data from a student profile. Remotion needs Node/Chromium to render an MP4, so the browser downloads a JSON file first.

1. Open a student profile.
2. Go to `Training Records` or `Courses`.
3. Click `Export Video Data`.
4. Render the MP4 locally:

```powershell
npm run render:student-progress -- --props="C:\Path\To\student-progress-video.json" --out="student-progress.mp4"
```

The MP4 will be written to the path passed in `--out`.
