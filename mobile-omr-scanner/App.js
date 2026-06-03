import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { WebView } from "react-native-webview";

const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.1.10:5000/api";

const choices = ["A", "B", "C", "D"];
const OMR_ITEMS_PER_PAGE = 100;
const OMR_ROWS_PER_BLOCK = 25;

function parseQrMetadata(value = "") {
  try {
    const parsed = JSON.parse(String(value || "").trim());

    if (parsed && parsed.type === "UM_OMR_SHEET") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeMatchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function findExamFromQrMetadata(metadata, exams) {
  if (!metadata) {
    return null;
  }

  if (metadata.analysisExamId) {
    const exactMatch = exams.find((exam) => exam._id === metadata.analysisExamId);

    if (exactMatch) {
      return exactMatch;
    }
  }

  const fallbackMatches = exams.filter((exam) => {
    const sameTitle =
      !metadata.title ||
      normalizeMatchValue(exam.title) === normalizeMatchValue(metadata.title);
    const sameSubject =
      !metadata.subject ||
      normalizeMatchValue(exam.subject) === normalizeMatchValue(metadata.subject);
    const sameSection =
      !metadata.section ||
      normalizeMatchValue(exam.section) === normalizeMatchValue(metadata.section);
    const sameItemCount =
      !metadata.numberOfItems ||
      Number(exam.numberOfItems) === Number(metadata.numberOfItems);

    return sameTitle && sameSubject && sameSection && sameItemCount;
  });

  return fallbackMatches.length === 1 ? fallbackMatches[0] : null;
}

function upsertExam(exams, exam) {
  const existingIndex = exams.findIndex((item) => item._id === exam._id);

  if (existingIndex === -1) {
    return [exam, ...exams];
  }

  const next = [...exams];
  next[existingIndex] = exam;
  return next;
}

function getWebScannerUrl(apiBaseUrl) {
  return apiBaseUrl.replace(/\/api\/?$/, "/omr-scanner.html");
}

function getAnswerKeyMap(exam) {
  return new Map(
    (exam?.answerKey || []).map((item) => [
      Number(item.itemNo),
      String(item.answer || "").trim().toUpperCase(),
    ]),
  );
}

function scoreAnswers(exam, answers) {
  const answerKey = getAnswerKeyMap(exam);
  const total = exam?.numberOfItems || 0;
  const detected = answers.filter(Boolean).length;
  const score = answers.filter(
    (answer, index) => answer && answer === answerKey.get(index + 1),
  ).length;

  return { score, total, detected };
}

function getExpectedOmrPageCount(numberOfItems) {
  const total = Number(numberOfItems || 0);
  return total > 0 ? Math.ceil(total / OMR_ITEMS_PER_PAGE) : 0;
}

function getQrScanRange(metadata, exam) {
  const totalItems = Number(exam?.numberOfItems || metadata?.numberOfItems || 0);
  const startItem = Math.max(1, Number(metadata?.startItem || 1));
  const fallbackEnd = metadata?.itemsOnPage
    ? startItem + Number(metadata.itemsOnPage) - 1
    : totalItems || startItem;
  const endItem = Math.min(
    totalItems || fallbackEnd,
    Math.max(startItem, Number(metadata?.endItem || fallbackEnd)),
  );

  return {
    startItem,
    endItem,
    itemsOnPage: Math.max(1, endItem - startItem + 1),
    pageNo: Math.max(1, Number(metadata?.pageNo || 1)),
    pageCount: Math.max(1, Number(metadata?.pageCount || 1)),
  };
}

function buildDetectorHtml(imageUri, numberOfItems) {
  const safeUri = JSON.stringify(imageUri);
  const items = Number(numberOfItems || 0);

  return `
<!doctype html>
<html>
  <body>
    <canvas id="canvas"></canvas>
    <script>
      const imageUri = ${safeUri};
      const numberOfItems = ${items};
      const labels = ["A", "B", "C", "D"];
      const scan = { top: 0.12, bottom: 0.94, left: 0.06, right: 0.94, numberColumn: 0.16, headerRow: 0 };
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      function sampleBubble(x, y, radius) {
        const startX = Math.max(0, Math.round(x - radius));
        const startY = Math.max(0, Math.round(y - radius));
        const size = Math.max(2, Math.round(radius * 2));
        const imageData = ctx.getImageData(startX, startY, size, size).data;
        let total = 0;
        let darkPixels = 0;
        let count = 0;

        for (let index = 0; index < imageData.length; index += 4) {
          const brightness = (imageData[index] + imageData[index + 1] + imageData[index + 2]) / 3;
          total += 255 - brightness;
          if (brightness < 135) {
            darkPixels += 1;
          }
          count += 1;
        }

        return {
          darkness: count ? total / count : 0,
          darkRatio: count ? darkPixels / count : 0,
        };
      }

      function detect() {
        const image = new Image();

        image.onload = () => {
          const maxWidth = Math.min(900, image.naturalWidth || image.width);
          const scale = maxWidth / (image.naturalWidth || image.width);
          canvas.width = maxWidth;
          canvas.height = Math.round((image.naturalHeight || image.height) * scale);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

          const bounds = {
            x: canvas.width * scan.left,
            y: canvas.height * scan.top,
            width: canvas.width * (scan.right - scan.left),
            height: canvas.height * (scan.bottom - scan.top),
          };
          const rowsPerBlock = ${OMR_ROWS_PER_BLOCK};
          const blockCount = 4;
          const rowHeight = bounds.height / rowsPerBlock;
          const blockWidth = bounds.width / blockCount;
          const answers = [];
          const diagnostics = [];

          for (let itemIndex = 0; itemIndex < numberOfItems; itemIndex += 1) {
            const blockIndex = Math.floor(itemIndex / rowsPerBlock);
            const rowIndex = itemIndex % rowsPerBlock;
            const blockX = bounds.x + blockWidth * blockIndex;
            const y = bounds.y + rowHeight * (rowIndex + 0.5);
            const answerX = blockX + blockWidth * scan.numberColumn;
            const answerWidth = blockWidth * (1 - scan.numberColumn);
            const columnWidth = answerWidth / labels.length;
            const sampleRadius = Math.max(3, Math.min(rowHeight, columnWidth) * 0.18);
            const scores = labels.map((label, labelIndex) => {
              const x = answerX + columnWidth * (labelIndex + 0.5);
              return { label, ...sampleBubble(x, y, sampleRadius) };
            });
            const sorted = scores.sort((a, b) => b.darkness - a.darkness);
            const confidence = sorted[0].darkness - sorted[1].darkness;
            const rowAverage =
              scores.reduce((sum, score) => sum + score.darkness, 0) / scores.length;
            const answer =
              sorted[0].darkness > 38 &&
              sorted[0].darkRatio > 0.06 &&
              confidence > 9 &&
              sorted[0].darkness > rowAverage + 12
                ? sorted[0].label
                : "";

            answers.push(answer);
            diagnostics.push({
              itemNo: itemIndex + 1,
              answer,
              confidence,
              darkness: sorted[0].darkness,
              darkRatio: sorted[0].darkRatio,
            });
          }

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "detected",
            answers,
            diagnostics,
            detected: answers.filter(Boolean).length,
          }));
        };

        image.onerror = () => {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", message: "Unable to read captured image." }));
        };

        image.src = imageUri;
      }

      detect();
    </script>
  </body>
</html>`;
}

async function requestApi(apiBaseUrl, endpoint, options = {}) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

export default function App() {
  const cameraRef = useRef(null);
  const qrScanLockRef = useRef(false);
  const activeScanRangeRef = useRef(null);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [section, setSection] = useState("");
  const [answers, setAnswers] = useState([]);
  const [scannedPages, setScannedPages] = useState({});
  const [history, setHistory] = useState([]);
  const [capturedImage, setCapturedImage] = useState("");
  const [detectorHtml, setDetectorHtml] = useState("");
  const [detectionStatus, setDetectionStatus] = useState("Ready to scan.");
  const [activeScanRange, setActiveScanRange] = useState(null);
  const [qrScanEnabled, setQrScanEnabled] = useState(true);
  const [qrStatus, setQrStatus] = useState("QR scanner ready.");
  const [qrMetadata, setQrMetadata] = useState(null);
  const [batchMode, setBatchMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("scan");
  const [permission, requestPermission] = useCameraPermissions();

  const selectedExam = exams.find((exam) => exam._id === selectedExamId);
  const liveScore = useMemo(
    () => scoreAnswers(selectedExam, answers),
    [answers, selectedExam],
  );
  const webScannerUrl = getWebScannerUrl(apiBaseUrl);

  const login = async () => {
    try {
      setLoading(true);
      const data = await requestApi(apiBaseUrl, "/auth/login", {
        method: "POST",
        body: { email, password },
      });

      setToken(data.token);
      setUser(data.user);
      await loadExams(data.token);
    } catch (error) {
      Alert.alert("Login failed", error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadExams = async (authToken = token) => {
    const data = await requestApi(apiBaseUrl, "/item-analysis/exams", {
      token: authToken,
    });
    const scannerReadyExams = (data.exams || []).filter(
      (exam) => Array.isArray(exam.answerKey) && exam.answerKey.length > 0,
    );

    setExams(scannerReadyExams);

    if (scannerReadyExams.length > 0) {
      await selectExam(scannerReadyExams[0], authToken);
    }
  };

  const loadHistory = async (examId = selectedExamId, authToken = token) => {
    if (!examId) {
      setHistory([]);
      return;
    }

    const data = await requestApi(apiBaseUrl, `/item-analysis/${examId}/results`, {
      token: authToken,
    });
    setHistory(data.results || []);
  };

  const selectExam = async (exam, authToken = token, options = {}) => {
    setSelectedExamId(exam._id);
    setSection(exam.section || "");
    setAnswers(Array.from({ length: exam.numberOfItems }, () => ""));
    setScannedPages({});
    setCapturedImage("");
    setDetectorHtml("");
    setActiveScanRange(null);
    activeScanRangeRef.current = null;
    setDetectionStatus("Ready to scan.");

    if (!options.preserveQr) {
      setQrMetadata(null);
      setQrStatus("QR scanner ready.");
      setQrScanEnabled(true);
      qrScanLockRef.current = false;
    }

    if (Array.isArray(options.preloadedResults)) {
      setHistory(options.preloadedResults);
    } else {
      await loadHistory(exam._id, authToken);
    }
  };

  const handleQrScanned = async (event) => {
    if (!qrScanEnabled || qrScanLockRef.current) {
      return;
    }

    qrScanLockRef.current = true;
    const rawValue = event?.data || event?.nativeEvent?.data || "";
    const metadata = parseQrMetadata(rawValue);

    if (!metadata) {
      setQrStatus("QR detected, but it is not a UM OMR sheet code.");
      setTimeout(() => {
        qrScanLockRef.current = false;
      }, 1200);
      return;
    }

    setQrScanEnabled(false);
    setQrMetadata(metadata);
    setQrStatus(`QR read: ${metadata.title || "OMR sheet"}. Looking for exam...`);

    let matchingExam = findExamFromQrMetadata(metadata, exams);
    let preloadedResults = null;

    if (!matchingExam && metadata.analysisExamId) {
      try {
        const data = await requestApi(
          apiBaseUrl,
          `/item-analysis/${metadata.analysisExamId}/results`,
          { token },
        );

        if (
          data.exam &&
          Array.isArray(data.exam.answerKey) &&
          data.exam.answerKey.length > 0
        ) {
          matchingExam = data.exam;
          preloadedResults = data.results || [];
          setExams((current) => upsertExam(current, data.exam));
        } else if (data.exam) {
          setQrStatus("QR exam found, but it has no answer key for scoring.");
        }
      } catch (error) {
        setQrStatus(`QR read, but exam could not be loaded: ${error.message}`);
      }
    }

    if (!matchingExam) {
      setQrStatus(
        `QR read: ${metadata.title || "OMR sheet"}. Matching exam is not loaded.`,
      );
      Alert.alert(
        "Exam not found",
        "The QR was read, but the matching item-analysis exam could not be found for this account. Make sure the sheet was generated from a created scanning exam, then scan QR again.",
      );
      qrScanLockRef.current = false;
      return;
    }

    if (selectedExamId !== matchingExam._id || answers.length !== matchingExam.numberOfItems) {
      await selectExam(matchingExam, token, {
        preserveQr: true,
        preloadedResults,
      });
    } else if (Array.isArray(preloadedResults)) {
      setHistory(preloadedResults);
    }

    if (metadata.section) {
      setSection(metadata.section);
    }

    if (metadata.studentId) {
      setStudentId(metadata.studentId);
    }

    setQrStatus(
      `QR linked: ${metadata.title || matchingExam.title} | Page ${metadata.pageNo || 1}/${metadata.pageCount || 1} | Items ${metadata.startItem || 1}-${metadata.endItem || metadata.numberOfItems || matchingExam.numberOfItems}`,
    );
    qrScanLockRef.current = false;
  };

  const toggleQrScan = () => {
    const nextEnabled = !qrScanEnabled;
    qrScanLockRef.current = false;
    setQrScanEnabled(nextEnabled);

    if (nextEnabled) {
      setQrStatus("QR scanner ready.");
    }
  };

  const setAnswer = (index, answer) => {
    setAnswers((current) => {
      const next = [...current];
      next[index] = answer;
      return next;
    });
  };

  const clearAnswers = () => {
    if (!selectedExam) return;
    setAnswers(Array.from({ length: selectedExam.numberOfItems }, () => ""));
    setScannedPages({});
    setCapturedImage("");
    setDetectorHtml("");
    setActiveScanRange(null);
    activeScanRangeRef.current = null;
    setDetectionStatus("Ready to scan.");
    setQrMetadata(null);
    setQrStatus("QR scanner ready.");
    setQrScanEnabled(true);
  };

  const captureAndDetect = async () => {
    if (!selectedExam) {
      Alert.alert("No exam selected", "Choose an item analysis exam first.");
      return;
    }

    if (!qrMetadata) {
      Alert.alert(
        "Scan page QR first",
        "Scan the QR code in the OMR page header before capturing this page.",
      );
      return;
    }

    if (
      qrMetadata.analysisExamId &&
      String(qrMetadata.analysisExamId) !== String(selectedExam._id)
    ) {
      Alert.alert(
        "Wrong OMR page",
        "The scanned QR belongs to a different item-analysis exam. Scan the correct page QR first.",
      );
      return;
    }

    if (
      getExpectedOmrPageCount(selectedExam.numberOfItems) > 1 &&
      (!qrMetadata.startItem || !qrMetadata.endItem)
    ) {
      Alert.alert(
        "Updated OMR sheet needed",
        "This QR does not include a page item range. Download the latest multi-page OMR sheet, then scan the page QR again.",
      );
      return;
    }

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }

    try {
      setDetectionStatus("Capturing sheet...");
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.7,
        skipProcessing: false,
      });

      if (!photo?.base64) {
        throw new Error("Camera did not return an image.");
      }

      const scanRange = getQrScanRange(qrMetadata, selectedExam);
      activeScanRangeRef.current = scanRange;
      setActiveScanRange(scanRange);
      const imageUri = `data:image/jpg;base64,${photo.base64}`;
      setCapturedImage(imageUri);
      setDetectorHtml(buildDetectorHtml(imageUri, scanRange.itemsOnPage));
      setDetectionStatus(
        `Detecting page ${scanRange.pageNo}/${scanRange.pageCount}, items ${scanRange.startItem}-${scanRange.endItem}...`,
      );
    } catch (error) {
      setDetectionStatus("Detection failed.");
      setActiveScanRange(null);
      activeScanRangeRef.current = null;
      Alert.alert("Scan failed", error.message);
    }
  };

  const handleDetectorMessage = (event) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);

      if (payload.type === "detected") {
        const pageAnswers = payload.answers || [];
        const scanRange =
          activeScanRangeRef.current ||
          activeScanRange ||
          getQrScanRange(qrMetadata, selectedExam);
        const detected = pageAnswers.filter(Boolean).length;

        setAnswers((current) => {
          const next = Array.from(
            { length: selectedExam?.numberOfItems || current.length },
            (_, index) => current[index] || "",
          );

          pageAnswers.forEach((answer, index) => {
            const targetIndex = scanRange.startItem - 1 + index;

            if (targetIndex >= 0 && targetIndex < next.length) {
              next[targetIndex] = answer;
            }
          });

          return next;
        });
        setScannedPages((current) => ({
          ...current,
          [scanRange.pageNo]: {
            detected,
            endItem: scanRange.endItem,
            startItem: scanRange.startItem,
          },
        }));
        setDetectionStatus(
          detected > 0
            ? `Page ${scanRange.pageNo}/${scanRange.pageCount}: ${detected} answer${detected === 1 ? "" : "s"} detected for items ${scanRange.startItem}-${scanRange.endItem}.`
            : `Page ${scanRange.pageNo}/${scanRange.pageCount}: no confident shaded answers detected. Align this page and retake.`,
        );
        setActiveScanRange(null);
        activeScanRangeRef.current = null;
      } else if (payload.type === "error") {
        setDetectionStatus(payload.message || "Detection failed.");
        setActiveScanRange(null);
        activeScanRangeRef.current = null;
      }
    } catch {
      setDetectionStatus("Detection returned invalid data.");
    }
  };

  const saveResult = async (allowIncomplete = false) => {
    const shouldAllowIncomplete = allowIncomplete === true;

    if (!selectedExam) {
      Alert.alert("No exam selected", "Choose an item analysis exam first.");
      return;
    }

    if (!studentName.trim() || !studentId.trim()) {
      Alert.alert("Missing student", "Student name and student ID are required.");
      return;
    }

    const expectedPages = Math.max(
      1,
      getExpectedOmrPageCount(selectedExam.numberOfItems),
    );
    const scannedPageCount = Object.keys(scannedPages).length;

    if (
      !shouldAllowIncomplete &&
      expectedPages > 1 &&
      scannedPageCount < expectedPages
    ) {
      Alert.alert(
        "Incomplete OMR pages",
        `Only ${scannedPageCount}/${expectedPages} OMR pages have been scanned. Missing pages will be saved as blank answers.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Continue Saving",
            onPress: () => saveResult(true),
          },
        ],
      );
      return;
    }

    try {
      setLoading(true);
      const data = await requestApi(
        apiBaseUrl,
        `/item-analysis/${selectedExam._id}/scanned-result`,
        {
          method: "POST",
          token,
          body: {
            studentName: studentName.trim(),
            studentId: studentId.trim(),
            section: section.trim() || selectedExam.section,
            answers,
          },
        },
      );

      Alert.alert(
        "Saved",
        `${data.message}\nScore: ${data.result.totalScore}/${selectedExam.numberOfItems}`,
      );
      await loadHistory(selectedExam._id);

      if (batchMode) {
        setStudentName("");
        setStudentId("");
        clearAnswers();
        setQrMetadata(null);
        setQrStatus("QR scanner ready.");
        setQrScanEnabled(true);
        setActiveScanRange(null);
        activeScanRangeRef.current = null;
      }
    } catch (error) {
      Alert.alert("Save failed", error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.authPage}
        >
          <View style={styles.authCard}>
            <Text style={styles.kicker}>University of Mindanao</Text>
            <Text style={styles.title}>Mobile OMR Scanner</Text>
            <Text style={styles.muted}>
              Sign in with your Question Bank account and connect to your backend.
            </Text>

            <Text style={styles.label}>API Base URL</Text>
            <TextInput
              autoCapitalize="none"
              style={styles.input}
              value={apiBaseUrl}
              onChangeText={setApiBaseUrl}
              placeholder="http://192.168.1.10:5000/api"
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="teacher@example.com"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
            />

            <PrimaryButton disabled={loading} label="Login" onPress={login} />
            {loading ? <ActivityIndicator color="#980018" /> : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerKicker}>UM OMR Scanner</Text>
          <Text style={styles.headerTitle}>{user?.name || "Teacher"}</Text>
        </View>
        <Pressable
          style={styles.logoutButton}
          onPress={() => {
            setToken("");
            setUser(null);
            setExams([]);
            setHistory([]);
            setAnswers([]);
            setScannedPages({});
            setQrMetadata(null);
            setActiveScanRange(null);
            activeScanRangeRef.current = null;
          }}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.segmented}>
        {["scan", "history", "web"].map((item) => (
          <Pressable
            key={item}
            style={[styles.segment, mode === item && styles.segmentActive]}
            onPress={() => setMode(item)}
          >
            <Text style={[styles.segmentText, mode === item && styles.segmentTextActive]}>
              {item === "scan" ? "Scan" : item === "history" ? "History" : "Web"}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "web" ? (
        <WebView
          source={{ uri: webScannerUrl }}
          style={styles.webView}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ExamSelector
            exams={exams}
            loading={loading}
            onRefresh={() => loadExams()}
            onSelect={selectExam}
            selectedExamId={selectedExamId}
          />

          {mode === "history" ? (
            <HistoryCard
              history={history}
              numberOfItems={selectedExam?.numberOfItems || 0}
              onRefresh={() => loadHistory()}
            />
          ) : (
            <>
              <StudentCard
                batchMode={batchMode}
                section={section}
                setBatchMode={setBatchMode}
                setSection={setSection}
                setStudentId={setStudentId}
                setStudentName={setStudentName}
                studentId={studentId}
                studentName={studentName}
              />

              <ScoreCard
                liveScore={liveScore}
                numberOfItems={selectedExam?.numberOfItems || 0}
                scannedPages={scannedPages}
              />

              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionTitle}>Native OMR Detection</Text>
                  <Text style={styles.historyCount}>{history.length} saved</Text>
                </View>
                {!permission?.granted ? (
                  <PrimaryButton label="Allow Camera" onPress={requestPermission} />
                ) : (
                  <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{
                      barcodeTypes: ["qr"],
                    }}
                    onBarcodeScanned={qrScanEnabled ? handleQrScanned : undefined}
                  />
                )}
                <QrStatusCard
                  metadata={qrMetadata}
                  qrScanEnabled={qrScanEnabled}
                  qrStatus={qrStatus}
                  onToggleQrScan={toggleQrScan}
                />
                <Text style={styles.muted}>
                  Align the printed OMR table in the camera preview, then capture and detect.
                  Review answers before saving.
                </Text>
                <PrimaryButton
                  disabled={loading || !selectedExam}
                  label="Capture and Detect"
                  onPress={captureAndDetect}
                />
                <Text style={styles.statusText}>{detectionStatus}</Text>
                {capturedImage && detectorHtml ? (
                  <WebView
                    originWhitelist={["*"]}
                    source={{ html: detectorHtml }}
                    style={styles.detectorWebView}
                    onMessage={handleDetectorMessage}
                  />
                ) : null}
              </View>

              <AnswerReview
                answers={answers}
                clearAnswers={clearAnswers}
                loading={loading}
                saveResult={saveResult}
                setAnswer={setAnswer}
              />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ExamSelector({ exams, loading, onRefresh, onSelect, selectedExamId }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Item Analysis Exam</Text>
        <Pressable onPress={onRefresh} disabled={loading}>
          <Text style={styles.linkText}>Refresh</Text>
        </Pressable>
      </View>

      {exams.length === 0 ? (
        <Text style={styles.warning}>No item analysis exams with answer keys found.</Text>
      ) : (
        exams.map((exam) => (
          <Pressable
            key={exam._id}
            style={[
              styles.examOption,
              selectedExamId === exam._id && styles.examOptionActive,
            ]}
            onPress={() => onSelect(exam)}
          >
            <Text style={styles.examTitle}>{exam.title}</Text>
            <Text style={styles.examMeta}>
              {exam.subject} | {exam.section} | {exam.numberOfItems} items
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function StudentCard({
  batchMode,
  section,
  setBatchMode,
  setSection,
  setStudentId,
  setStudentName,
  studentId,
  studentName,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Batch Student Scan</Text>
        <Pressable
          style={[styles.toggle, batchMode && styles.toggleActive]}
          onPress={() => setBatchMode(!batchMode)}
        >
          <Text style={[styles.toggleText, batchMode && styles.toggleTextActive]}>
            {batchMode ? "Batch On" : "Batch Off"}
          </Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        value={studentName}
        onChangeText={setStudentName}
        placeholder="Student name"
      />
      <TextInput
        style={styles.input}
        value={studentId}
        onChangeText={setStudentId}
        placeholder="Student ID"
      />
      <TextInput
        style={styles.input}
        value={section}
        onChangeText={setSection}
        placeholder="Section"
      />
      <Text style={styles.muted}>
        Batch mode clears the student and answers after each save so you can scan
        the next sheet immediately.
      </Text>
    </View>
  );
}

function ScoreCard({ liveScore, numberOfItems, scannedPages }) {
  const expectedPages = Math.max(
    1,
    getExpectedOmrPageCount(numberOfItems),
  );
  const scannedPageCount = Object.keys(scannedPages || {}).length;

  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreLabel}>Live Score</Text>
      <Text style={styles.scoreText}>
        {liveScore.score}/{liveScore.total || "-"}
      </Text>
      <Text style={styles.scoreSubtext}>
        {liveScore.detected} answer{liveScore.detected === 1 ? "" : "s"} detected
      </Text>
      {expectedPages > 1 ? (
        <Text style={styles.scoreSubtext}>
          {scannedPageCount}/{expectedPages} OMR page{expectedPages === 1 ? "" : "s"} scanned
        </Text>
      ) : null}
    </View>
  );
}

function QrStatusCard({ metadata, qrScanEnabled, qrStatus, onToggleQrScan }) {
  return (
    <View style={styles.qrCard}>
      <View style={styles.rowBetween}>
        <View>
          <Text style={styles.qrTitle}>Metadata QR</Text>
          <Text style={styles.qrStatus}>{qrStatus}</Text>
        </View>
        <Pressable
          style={[styles.toggle, qrScanEnabled && styles.toggleActive]}
          onPress={onToggleQrScan}
        >
          <Text style={[styles.toggleText, qrScanEnabled && styles.toggleTextActive]}>
            {qrScanEnabled ? "QR On" : "QR Off"}
          </Text>
        </Pressable>
      </View>
      {metadata ? (
        <Text style={styles.qrMeta}>
          {metadata.subject || "No subject"} | {metadata.section || "No section"} |{" "}
          {metadata.numberOfItems || "-"} items
          {metadata.pageNo
            ? ` | Page ${metadata.pageNo}/${metadata.pageCount || 1} | Items ${metadata.startItem || 1}-${metadata.endItem || metadata.numberOfItems || "-"}`
            : ""}
        </Text>
      ) : null}
    </View>
  );
}

function AnswerReview({ answers, clearAnswers, loading, saveResult, setAnswer }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Review Answers</Text>
        <Pressable onPress={clearAnswers}>
          <Text style={styles.linkText}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.answerGrid}>
        {answers.map((answer, index) => (
          <View key={String(index)} style={styles.answerRow}>
            <Text style={styles.itemNo}>{index + 1}</Text>
            {choices.map((choice) => (
              <Pressable
                key={choice}
                style={[
                  styles.choiceButton,
                  answer === choice && styles.choiceButtonActive,
                ]}
                onPress={() => setAnswer(index, choice)}
              >
                <Text
                  style={[
                    styles.choiceText,
                    answer === choice && styles.choiceTextActive,
                  ]}
                >
                  {choice}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <PrimaryButton
        disabled={loading}
        label="Save and Next"
        onPress={() => saveResult()}
      />
      {loading ? <ActivityIndicator color="#980018" /> : null}
    </View>
  );
}

function HistoryCard({ history, numberOfItems, onRefresh }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Scan History</Text>
        <Pressable onPress={onRefresh}>
          <Text style={styles.linkText}>Refresh</Text>
        </Pressable>
      </View>
      {history.length === 0 ? (
        <Text style={styles.warning}>No saved scans yet.</Text>
      ) : (
        history.map((result) => (
          <View key={result._id} style={styles.historyItem}>
            <View>
              <Text style={styles.examTitle}>{result.studentName}</Text>
              <Text style={styles.examMeta}>
                {result.studentId} | {result.section}
              </Text>
            </View>
            <Text style={styles.historyScore}>
              {result.totalScore}/{numberOfItems}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function PrimaryButton({ disabled, label, onPress }) {
  return (
    <Pressable
      disabled={disabled}
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
      onPress={onPress}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#76000f",
  },
  authPage: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  authCard: {
    borderRadius: 10,
    backgroundColor: "#fffaf3",
    padding: 18,
  },
  kicker: {
    color: "#d79500",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    color: "#24000a",
    fontSize: 30,
    fontWeight: "900",
  },
  muted: {
    color: "#6d5960",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  label: {
    color: "#4d1b23",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    color: "#24000a",
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  primaryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#980018",
    marginTop: 8,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  headerKicker: {
    color: "#ffd77a",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logoutText: {
    color: "#fff7ec",
    fontWeight: "900",
  },
  segmented: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  segment: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: "#f0b318",
    borderColor: "#f0b318",
  },
  segmentText: {
    color: "#fff7ec",
    fontWeight: "900",
  },
  segmentTextActive: {
    color: "#5b000b",
  },
  webView: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    padding: 16,
    paddingBottom: 36,
  },
  card: {
    borderRadius: 10,
    backgroundColor: "#fffaf3",
    marginBottom: 12,
    padding: 14,
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionTitle: {
    color: "#24000a",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 10,
  },
  linkText: {
    color: "#980018",
    fontWeight: "900",
  },
  warning: {
    color: "#980018",
    fontWeight: "800",
  },
  examOption: {
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    marginBottom: 8,
    padding: 10,
  },
  examOptionActive: {
    borderColor: "#980018",
    backgroundColor: "#fff1e1",
  },
  examTitle: {
    color: "#24000a",
    fontWeight: "900",
  },
  examMeta: {
    color: "#6d5960",
    fontSize: 12,
    marginTop: 3,
  },
  scoreCard: {
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#f0b318",
    marginBottom: 12,
    padding: 16,
  },
  scoreLabel: {
    color: "#5b000b",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  scoreText: {
    color: "#5b000b",
    fontSize: 42,
    fontWeight: "900",
    lineHeight: 48,
  },
  scoreSubtext: {
    color: "#5b000b",
    fontWeight: "800",
  },
  camera: {
    height: 260,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 10,
  },
  detectorWebView: {
    height: 1,
    opacity: 0,
  },
  statusText: {
    color: "#4d1b23",
    fontWeight: "800",
    marginTop: 8,
  },
  qrCard: {
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    marginBottom: 10,
    padding: 10,
  },
  qrTitle: {
    color: "#24000a",
    fontWeight: "900",
  },
  qrStatus: {
    color: "#6d5960",
    fontSize: 12,
    marginTop: 2,
  },
  qrMeta: {
    color: "#980018",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
  },
  answerGrid: {
    gap: 7,
    marginBottom: 12,
  },
  answerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  itemNo: {
    width: 34,
    color: "#4d1b23",
    fontWeight: "900",
    textAlign: "center",
  },
  choiceButton: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  choiceButtonActive: {
    borderColor: "#980018",
    backgroundColor: "#980018",
  },
  choiceText: {
    color: "#4d1b23",
    fontWeight: "900",
  },
  choiceTextActive: {
    color: "#ffffff",
  },
  toggle: {
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  toggleActive: {
    backgroundColor: "#980018",
    borderColor: "#980018",
  },
  toggleText: {
    color: "#4d1b23",
    fontWeight: "900",
  },
  toggleTextActive: {
    color: "#ffffff",
  },
  historyCount: {
    color: "#980018",
    fontWeight: "900",
  },
  historyItem: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    padding: 10,
  },
  historyScore: {
    color: "#980018",
    fontSize: 18,
    fontWeight: "900",
  },
});
