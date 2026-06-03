# UM OMR Scanner Mobile App

This is a separate Expo app for scanning/reviewing MCQ OMR answers and saving results directly to the existing Question Bank backend.

The app uses Expo SDK 54, which matches the current Expo Go release.

## What It Connects To

The app uses the existing backend endpoints:

- `POST /api/auth/login`
- `GET /api/item-analysis/exams`
- `POST /api/item-analysis/:id/scanned-result`

## Setup

1. Make sure the backend server is running:

```bash
cd ..
node server.js
```

2. Find your computer's local network IP address.

Example:

```text
192.168.1.10
```

3. Create `.env` from `.env.example`:

```bash
copy .env.example .env
```

4. Update `.env`:

```text
EXPO_PUBLIC_API_BASE_URL=http://YOUR_COMPUTER_IP:5000/api
```

Do not use `localhost` from a phone. On the phone, `localhost` means the phone itself.

5. Install dependencies:

```bash
npm install
```

6. Start Expo:

```bash
npm start
```

If Expo Go still shows an old bundling error after dependencies change, restart Metro with a cleared cache:

```bash
npx expo start -c
```

7. Open the QR code with Expo Go.

## App Modes

### Native

The native mode lets the teacher:

- Log in
- Select an item analysis exam
- Scan the metadata QR code printed on generated OMR sheets
- Auto-select the matching item analysis exam from the QR code
- Enter student name, student ID, and section
- Capture an OMR sheet using the device camera
- Detect shaded A-D answers on-device
- Review and correct detected answers
- See the score live while answers are detected or edited
- Save the result directly to item analysis
- Keep batch mode on to clear the form after each save

### Scan History

The History tab shows saved scans for the selected item analysis exam:

- Student name
- Student ID
- Section
- Score

Use `Refresh` after saving from another device or browser.

### QR Metadata Flow

1. Download an OMR sheet from the web scanner or item analysis page.
2. Open the Expo app.
3. Log in and load item analysis exams.
4. Point the camera at the QR code on the sheet.
5. The app links the sheet to the matching item analysis exam.
6. Capture and detect the shaded answers.

### Web Scanner

The Web Scanner tab embeds the existing web OMR scanner page:

```text
/omr-scanner.html
```

Use this tab to access the browser-based OMR detector from inside the mobile app.

## Important Notes

- The backend and phone must be on the same Wi-Fi network.
- Windows Firewall may block phone access to port `5000`; allow Node.js if prompted.
- For production, serve the backend over HTTPS.
- The native screen currently provides camera preview plus answer review and saving. The embedded Web Scanner tab reuses the existing browser-based OMR scanner.
