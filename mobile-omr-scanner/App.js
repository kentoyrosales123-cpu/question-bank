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
const OMR_MAX_BLOCKS_PER_PAGE = 4;
const DEFAULT_SCAN_SETTINGS = {
  top: 4,
  bottom: 96,
  left: 4,
  right: 96,
  numberColumn: 18,
  headerRow: 12,
};
const scanSettingLimits = {
  top: { min: 0, max: 45, step: 1 },
  bottom: { min: 55, max: 100, step: 1 },
  left: { min: 0, max: 45, step: 1 },
  right: { min: 55, max: 100, step: 1 },
  numberColumn: { min: 0, max: 30, step: 1 },
  headerRow: { min: 0, max: 12, step: 1 },
};

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
  return String(value || "")
    .trim()
    .toLowerCase();
}

function findExamFromQrMetadata(metadata, exams) {
  if (!metadata) {
    return null;
  }

  if (metadata.analysisExamId) {
    const exactMatch = exams.find(
      (exam) => exam._id === metadata.analysisExamId,
    );

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
      normalizeMatchValue(exam.subject) ===
        normalizeMatchValue(metadata.subject);
    const sameSection =
      !metadata.section ||
      normalizeMatchValue(exam.section) ===
        normalizeMatchValue(metadata.section);
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

function getServerUrl(apiBaseUrl, path) {
  return apiBaseUrl.replace(/\/api\/?$/, path);
}

function getWebScannerUrl(apiBaseUrl) {
  return getServerUrl(apiBaseUrl, "/omr-scanner.html");
}

function getOpenCvUrl(apiBaseUrl) {
  return getServerUrl(apiBaseUrl, "/js/opencv.js");
}

function getAnswerKeyMap(exam) {
  return new Map(
    (exam?.answerKey || []).map((item) => [
      Number(item.itemNo),
      String(item.answer || "")
        .trim()
        .toUpperCase(),
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
  const totalItems = Number(
    exam?.numberOfItems || metadata?.numberOfItems || 0,
  );
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

function clampScanSetting(key, value) {
  const limits = scanSettingLimits[key];
  const next = Number(value);

  if (!limits || Number.isNaN(next)) {
    return DEFAULT_SCAN_SETTINGS[key] || 0;
  }

  return Math.min(limits.max, Math.max(limits.min, next));
}

function normalizeScanSettings(settings = DEFAULT_SCAN_SETTINGS) {
  const next = {
    top: clampScanSetting("top", settings.top),
    bottom: clampScanSetting("bottom", settings.bottom),
    left: clampScanSetting("left", settings.left),
    right: clampScanSetting("right", settings.right),
    numberColumn: clampScanSetting("numberColumn", settings.numberColumn),
    headerRow: clampScanSetting("headerRow", settings.headerRow),
  };

  if (next.bottom <= next.top) {
    next.bottom = Math.min(100, next.top + 10);
  }

  if (next.right <= next.left) {
    next.right = Math.min(100, next.left + 10);
  }

  return {
    top: next.top / 100,
    bottom: next.bottom / 100,
    left: next.left / 100,
    right: next.right / 100,
    numberColumn: next.numberColumn / 100,
    headerRow: next.headerRow / 100,
  };
}

function buildDetectorHtml(
  imageUri,
  numberOfItems,
  scanSettings,
  opencvScriptUrl,
) {
  const safeUri = JSON.stringify(imageUri);
  const safeOpenCvUrl = JSON.stringify(opencvScriptUrl);
  const items = Number(numberOfItems || 0);
  const scan = JSON.stringify(normalizeScanSettings(scanSettings));
  const blockCount = Math.min(
    OMR_MAX_BLOCKS_PER_PAGE,
    Math.max(1, Math.ceil(items / OMR_ROWS_PER_BLOCK)),
  );

  return `
<!doctype html>
<html>
  <body>
    <canvas id="canvas"></canvas>
    <script src=${safeOpenCvUrl}></script>
    <script>
      const imageUri = ${safeUri};
      const numberOfItems = ${items};
      const labels = ["A", "B", "C", "D"];
      const scan = ${scan};
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");
      let cvReady = false;

      function postMessage(payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      function waitForOpenCv() {
        return new Promise((resolve, reject) => {
          const startedAt = Date.now();
          const poll = () => {
            if (window.cv && typeof cv.Mat === "function") {
              if (cv.Mat.ones) {
                cvReady = true;
                resolve();
                return;
              }

              cv.onRuntimeInitialized = () => {
                cvReady = true;
                resolve();
              };
            }

            if (Date.now() - startedAt > 12000) {
              reject(new Error("OpenCV did not load. Check that the backend can serve /js/opencv.js to this phone."));
              return;
            }

            setTimeout(poll, 100);
          };

          poll();
        });
      }

      function sampleBubble(x, y, radius) {
        if (cvReady) {
          return sampleBubbleWithOpenCv(x, y, radius);
        }

        const startX = Math.max(0, Math.round(x - radius));
        const startY = Math.max(0, Math.round(y - radius));
        const size = Math.max(2, Math.round(radius * 2));
        const imageData = ctx.getImageData(startX, startY, size, size).data;
        let total = 0;
        let darkPixels = 0;
        let count = 0;
        const center = size / 2;

        for (let index = 0; index < imageData.length; index += 4) {
          const pixelIndex = index / 4;
          const px = pixelIndex % size;
          const py = Math.floor(pixelIndex / size);
          const dx = px - center;
          const dy = py - center;

          if (Math.sqrt(dx * dx + dy * dy) > center) {
            continue;
          }

          const brightness = (imageData[index] + imageData[index + 1] + imageData[index + 2]) / 3;
          total += 255 - brightness;
          if (brightness < 165) {
            darkPixels += 1;
          }
          count += 1;
        }

        return {
          darkness: count ? total / count : 0,
          darkRatio: count ? darkPixels / count : 0,
        };
      }

      function sampleBubbleWithOpenCv(x, y, radius) {
        const startX = Math.max(0, Math.round(x - radius));
        const startY = Math.max(0, Math.round(y - radius));
        const size = Math.max(2, Math.round(radius * 2));
        const width = Math.max(1, Math.min(canvas.width - startX, size));
        const height = Math.max(1, Math.min(canvas.height - startY, size));

        if (width <= 0 || height <= 0) {
          return { darkness: 0, darkRatio: 0 };
        }

        const imageData = ctx.getImageData(startX, startY, width, height);
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const thresh = new cv.Mat();
        const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
        const masked = new cv.Mat();
        const center = new cv.Point(width / 2, height / 2);
        const maskRadius = Math.max(1, Math.round(Math.min(width, height) / 2));

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, thresh, 165, 255, cv.THRESH_BINARY_INV);
        cv.circle(mask, center, maskRadius, new cv.Scalar(255), -1);

        cv.bitwise_and(thresh, mask, masked);

        const maskedDarkPixels = cv.countNonZero(masked);
        const maskPixels = Math.max(1, cv.countNonZero(mask));
        const darkness = (cv.mean(thresh, mask)[0] / 255) * 100;

        src.delete();
        gray.delete();
        thresh.delete();
        mask.delete();
        masked.delete();

        return {
          darkness,
          darkRatio: maskedDarkPixels / maskPixels,
        };
      }

      function detectCornerMarkers(manualBounds) {
  if (cvReady) {
    return detectCornerMarkersWithOpenCv(manualBounds);
  }

  const imageData = ctx.getImageData(
    Math.round(manualBounds.x),
    Math.round(manualBounds.y),
    Math.round(manualBounds.width),
    Math.round(manualBounds.height),
  );

  const data = imageData.data;
  const candidates = [];

  for (let y = 0; y < imageData.height - 15; y += 2) {
    for (let x = 0; x < imageData.width - 15; x += 2) {
      let darkCount = 0;

      for (let yy = 0; yy < 12; yy++) {
        for (let xx = 0; xx < 12; xx++) {
          const index =
            ((y + yy) * imageData.width + (x + xx)) * 4;

          const brightness =
            (data[index] +
              data[index + 1] +
              data[index + 2]) / 3;

          if (brightness < 40) {
            darkCount++;
          }
        }
      }

      if (darkCount > 90) {
        candidates.push({
          x: manualBounds.x + x,
          y: manualBounds.y + y,
        });
      }
    }
  }

  if (candidates.length < 4) {
    return null;
  }

  const topLeft = candidates.reduce((a, b) =>
    a.x + a.y < b.x + b.y ? a : b
  );

  const topRight = candidates.reduce((a, b) =>
    canvas.width - a.x + a.y <
    canvas.width - b.x + b.y
      ? a
      : b
  );

  const bottomLeft = candidates.reduce((a, b) =>
    a.x + (canvas.height - a.y) <
    b.x + (canvas.height - b.y)
      ? a
      : b
  );

  const bottomRight = candidates.reduce((a, b) =>
    canvas.width - a.x +
      (canvas.height - a.y) <
    canvas.width - b.x +
      (canvas.height - b.y)
      ? a
      : b
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: topRight.x - topLeft.x,
    height: bottomLeft.y - topLeft.y,
  };
}

      function detectCornerMarkersWithOpenCv(manualBounds) {
        const padding = Math.round(Math.min(manualBounds.width, manualBounds.height) * 0.04);
        const x = Math.max(0, Math.round(manualBounds.x - padding));
        const y = Math.max(0, Math.round(manualBounds.y - padding));
        const width = Math.min(
          canvas.width - x,
          Math.round(manualBounds.width + padding * 2),
        );
        const height = Math.min(
          canvas.height - y,
          Math.round(manualBounds.height + padding * 2),
        );
        const imageData = ctx.getImageData(x, y, width, height);
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const thresh = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        const candidates = [];

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, thresh, 60, 255, cv.THRESH_BINARY_INV);

        const denseBounds = detectDenseCornerMarkers(thresh, x, y);
        if (denseBounds) {
          src.delete();
          gray.delete();
          thresh.delete();
          contours.delete();
          hierarchy.delete();
          return denseBounds;
        }

        cv.findContours(
          thresh,
          contours,
          hierarchy,
          cv.RETR_EXTERNAL,
          cv.CHAIN_APPROX_SIMPLE,
        );

        for (let index = 0; index < contours.size(); index += 1) {
          const contour = contours.get(index);
          const rect = cv.boundingRect(contour);
          const area = cv.contourArea(contour);
          const minSize = Math.max(8, Math.min(width, height) * 0.012);
          const maxSize = Math.max(24, Math.min(width, height) * 0.12);
          const aspectRatio = rect.width / Math.max(1, rect.height);
          const fillRatio = area / Math.max(1, rect.width * rect.height);

          if (
            rect.width >= minSize &&
            rect.height >= minSize &&
            rect.width <= maxSize &&
            rect.height <= maxSize &&
            aspectRatio > 0.65 &&
            aspectRatio < 1.45 &&
            fillRatio > 0.5
          ) {
            candidates.push({
              x: x + rect.x + rect.width / 2,
              y: y + rect.y + rect.height / 2,
            });
          }

          contour.delete();
        }

        src.delete();
        gray.delete();
        thresh.delete();
        contours.delete();
        hierarchy.delete();

        if (candidates.length < 4) {
          return null;
        }

        const topLeft = candidates.reduce((a, b) =>
          a.x + a.y < b.x + b.y ? a : b
        );
        const topRight = candidates.reduce((a, b) =>
          canvas.width - a.x + a.y <
          canvas.width - b.x + b.y
            ? a
            : b
        );
        const bottomLeft = candidates.reduce((a, b) =>
          a.x + (canvas.height - a.y) <
          b.x + (canvas.height - b.y)
            ? a
            : b
        );
        const bottomRight = candidates.reduce((a, b) =>
          canvas.width - a.x +
            (canvas.height - a.y) <
          canvas.width - b.x +
            (canvas.height - b.y)
            ? a
            : b
        );

        return {
          x: Math.min(topLeft.x, bottomLeft.x),
          y: Math.min(topLeft.y, topRight.y),
          width: Math.max(1, Math.max(topRight.x, bottomRight.x) - Math.min(topLeft.x, bottomLeft.x)),
          height: Math.max(1, Math.max(bottomLeft.y, bottomRight.y) - Math.min(topLeft.y, topRight.y)),
          points: {
            topLeft,
            topRight,
            bottomLeft,
            bottomRight,
          },
        };
      }

      function detectDenseCornerMarkers(thresh, offsetX, offsetY) {
        const markerWindow = Math.max(
          12,
          Math.round(Math.min(thresh.cols, thresh.rows) * 0.025),
        );
        const cornerWidth = Math.round(thresh.cols * 0.28);
        const cornerHeight = Math.round(thresh.rows * 0.28);
        const regions = [
          { x: 0, y: 0, width: cornerWidth, height: cornerHeight },
          { x: thresh.cols - cornerWidth, y: 0, width: cornerWidth, height: cornerHeight },
          { x: 0, y: thresh.rows - cornerHeight, width: cornerWidth, height: cornerHeight },
          {
            x: thresh.cols - cornerWidth,
            y: thresh.rows - cornerHeight,
            width: cornerWidth,
            height: cornerHeight,
          },
        ];
        const points = regions.map((region) =>
          findDarkestPatch(thresh, region, markerWindow),
        );

        if (points.some((point) => !point || point.ratio < 0.55)) {
          return null;
        }

        return {
          x: offsetX + Math.min(points[0].x, points[2].x),
          y: offsetY + Math.min(points[0].y, points[1].y),
          width: Math.max(1, Math.max(points[1].x, points[3].x) - Math.min(points[0].x, points[2].x)),
          height: Math.max(1, Math.max(points[2].y, points[3].y) - Math.min(points[0].y, points[1].y)),
          points: {
            topLeft: { x: offsetX + points[0].x, y: offsetY + points[0].y },
            topRight: { x: offsetX + points[1].x, y: offsetY + points[1].y },
            bottomLeft: { x: offsetX + points[2].x, y: offsetY + points[2].y },
            bottomRight: { x: offsetX + points[3].x, y: offsetY + points[3].y },
          },
        };
      }

      function findDarkestPatch(thresh, region, markerWindow) {
        const step = Math.max(3, Math.round(markerWindow / 4));
        const data = thresh.data;
        let best = null;

        for (
          let y = region.y;
          y <= region.y + region.height - markerWindow;
          y += step
        ) {
          for (
            let x = region.x;
            x <= region.x + region.width - markerWindow;
            x += step
          ) {
            let dark = 0;

            for (let yy = 0; yy < markerWindow; yy += 1) {
              const rowOffset = (y + yy) * thresh.cols + x;
              for (let xx = 0; xx < markerWindow; xx += 1) {
                if (data[rowOffset + xx] > 0) {
                  dark += 1;
                }
              }
            }

            const ratio = dark / (markerWindow * markerWindow);

            if (!best || ratio > best.ratio) {
              best = {
                x: x + markerWindow / 2,
                y: y + markerWindow / 2,
                ratio,
              };
            }
          }
        }

        return best;
      }

      function warpCanvasToMarkerBounds(markerBounds) {
        if (!cvReady || !markerBounds?.points) {
          return markerBounds;
        }

        const { topLeft, topRight, bottomLeft, bottomRight } = markerBounds.points;
        const targetWidth = Math.max(
          1,
          Math.round(
            Math.max(
              Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
              Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y),
            ),
          ),
        );
        const targetHeight = Math.max(
          1,
          Math.round(
            Math.max(
              Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
              Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y),
            ),
          ),
        );
        const src = cv.imread(canvas);
        const warped = new cv.Mat();
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
          topLeft.x,
          topLeft.y,
          topRight.x,
          topRight.y,
          bottomLeft.x,
          bottomLeft.y,
          bottomRight.x,
          bottomRight.y,
        ]);
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0,
          0,
          targetWidth,
          0,
          0,
          targetHeight,
          targetWidth,
          targetHeight,
        ]);
        const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);

        cv.warpPerspective(
          src,
          warped,
          transform,
          new cv.Size(targetWidth, targetHeight),
          cv.INTER_LINEAR,
          cv.BORDER_CONSTANT,
          new cv.Scalar(255, 255, 255, 255),
        );
        cv.imshow(canvas, warped);

        src.delete();
        warped.delete();
        srcPoints.delete();
        dstPoints.delete();
        transform.delete();

        return {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
        };
      }

      function sampleStrip(x, y, width, height) {
        if (cvReady) {
          return sampleStripWithOpenCv(x, y, width, height);
        }

        const startX = Math.max(0, Math.round(x));
        const startY = Math.max(0, Math.round(y));
        const sampleWidth = Math.max(1, Math.min(canvas.width - startX, Math.round(width)));
        const sampleHeight = Math.max(1, Math.min(canvas.height - startY, Math.round(height)));

        if (sampleWidth <= 0 || sampleHeight <= 0) {
          return { darkness: 0, darkRatio: 0 };
        }

        const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight).data;
        let total = 0;
        let darkPixels = 0;
        let count = 0;

        for (let index = 0; index < imageData.length; index += 4) {
          const brightness = (imageData[index] + imageData[index + 1] + imageData[index + 2]) / 3;
          total += 255 - brightness;

          if (brightness < 225) {
            darkPixels += 1;
          }

          count += 1;
        }

        return {
          darkness: count ? total / count : 0,
          darkRatio: count ? darkPixels / count : 0,
        };
      }

      function sampleStripWithOpenCv(x, y, width, height) {
        const startX = Math.max(0, Math.round(x));
        const startY = Math.max(0, Math.round(y));
        const sampleWidth = Math.max(1, Math.min(canvas.width - startX, Math.round(width)));
        const sampleHeight = Math.max(1, Math.min(canvas.height - startY, Math.round(height)));

        if (sampleWidth <= 0 || sampleHeight <= 0) {
          return { darkness: 0, darkRatio: 0 };
        }

        const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight);
        const src = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        const thresh = new cv.Mat();

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, thresh, 225, 255, cv.THRESH_BINARY_INV);

        const darkPixels = cv.countNonZero(thresh);
        const darkness = (cv.mean(thresh)[0] / 255) * 100;
        const count = sampleWidth * sampleHeight;

        src.delete();
        gray.delete();
        thresh.delete();

        return {
          darkness,
          darkRatio: count ? darkPixels / count : 0,
        };
      }

      function detectOmrTable(bounds, answerY, answerHeight, rowHeight, blockWidth, blockCount) {
        const lineThickness = Math.max(2, Math.round(Math.min(rowHeight, blockWidth) * 0.04));
        const horizontalSamples = [];
        const verticalSamples = [];

        for (let rowIndex = 0; rowIndex <= ${OMR_ROWS_PER_BLOCK}; rowIndex += 1) {
          const y = answerY + rowHeight * rowIndex - lineThickness / 2;
          horizontalSamples.push(
            sampleStrip(
              bounds.x + bounds.width * 0.02,
              y,
              bounds.width * 0.96,
              lineThickness,
            ),
          );
        }

        for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
          const blockX = bounds.x + blockWidth * blockIndex;
          const answerX = blockX + blockWidth * scan.numberColumn;
          const answerWidth = blockWidth * (1 - scan.numberColumn);
          const columnWidth = answerWidth / labels.length;
          const xPositions = [
            blockX,
            answerX,
            answerX + columnWidth,
            answerX + columnWidth * 2,
            answerX + columnWidth * 3,
            answerX + columnWidth * 4,
          ];

          xPositions.forEach((x) => {
            verticalSamples.push(
              sampleStrip(
                x - lineThickness / 2,
                answerY,
                lineThickness,
                answerHeight,
              ),
            );
          });
        }

        const allSamples = [...horizontalSamples, ...verticalSamples];
        const averageDarkness =
          allSamples.reduce((sum, sample) => sum + sample.darkness, 0) /
          Math.max(1, allSamples.length);
        const lineHits = allSamples.filter(
          (sample) => sample.darkness > 12 && sample.darkRatio > 0.08,
        ).length;
        const horizontalHits = horizontalSamples.filter(
          (sample) => sample.darkness > 10 && sample.darkRatio > 0.07,
        ).length;
        const verticalHits = verticalSamples.filter(
          (sample) => sample.darkness > 10 && sample.darkRatio > 0.07,
        ).length;

        return {
              averageDarkness,
              hitRatio: lineHits / Math.max(1, allSamples.length),
              horizontalHitRatio: horizontalHits / Math.max(1, horizontalSamples.length),
              verticalHitRatio: verticalHits / Math.max(1, verticalSamples.length),
              engine: cvReady ? "opencv" : "canvas",
            };
      }

      async function detect() {
        try {
          await waitForOpenCv();
        } catch (error) {
          postMessage({
            type: "error",
            message: error.message,
          });
          return;
        }

        const image = new Image();

        image.onload = () => {
          const maxWidth = Math.min(900, image.naturalWidth || image.width);
          const scale = maxWidth / (image.naturalWidth || image.width);
          canvas.width = maxWidth;
          canvas.height = Math.round((image.naturalHeight || image.height) * scale);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

          const manualBounds = {
            x: canvas.width * 0.06,
            y: canvas.height * 0.08,
            width: canvas.width * 0.88,
            height: canvas.height * 0.78,
          };

const markerBounds = detectCornerMarkers(manualBounds);

const bounds = markerBounds ? warpCanvasToMarkerBounds(markerBounds) : manualBounds;
          const rowsPerBlock = ${OMR_ROWS_PER_BLOCK};
          const blockCount = ${blockCount};
          const answerY = bounds.y + bounds.height * scan.headerRow;
          const answerHeight = bounds.height * (1 - scan.headerRow);
          const rowHeight = answerHeight / rowsPerBlock;
          const blockWidth = bounds.width / blockCount;
          const answers = [];
          const diagnostics = [];
          const tableEvidence = detectOmrTable(
            bounds,
            answerY,
            answerHeight,
            rowHeight,
            blockWidth,
            blockCount,
          );

          if (
            tableEvidence.averageDarkness < 10 ||
            tableEvidence.hitRatio < 0.22 ||
            tableEvidence.horizontalHitRatio < 0.2 ||
            tableEvidence.verticalHitRatio < 0.18
          ) {
            postMessage({
              type: "no_sheet",
              message: "No OMR sheet detected. Align the answer table inside the camera guide and capture again.",
              tableEvidence,
            });
            return;
          }

          for (let itemIndex = 0; itemIndex < numberOfItems; itemIndex += 1) {
            const blockIndex = Math.floor(itemIndex / rowsPerBlock);
            const rowIndex = itemIndex % rowsPerBlock;
            const blockX = bounds.x + blockWidth * blockIndex;
            const y = answerY + rowHeight * (rowIndex + 0.5);
            const answerX = blockX + blockWidth * scan.numberColumn;
            const answerWidth = blockWidth * (1 - scan.numberColumn);
            const columnWidth = answerWidth / labels.length;
            const sampleRadius = Math.max(4, Math.min(rowHeight, columnWidth) * 0.24);
            const scores = labels.map((label, labelIndex) => {
              const x = answerX + columnWidth * (labelIndex + 0.5);
              return { label, ...sampleBubble(x, y, sampleRadius) };
            });
            const sorted = [...scores].sort((a, b) => b.darkness - a.darkness);
            const confidence = sorted[0].darkness - sorted[1].darkness;
            const rowAverage =
              scores.reduce((sum, score) => sum + score.darkness, 0) / scores.length;
            const variance =
              scores.reduce((sum, score) => sum + Math.pow(score.darkness - rowAverage, 2), 0) /
              scores.length;
            const rowSpread = Math.sqrt(variance);
            const rowDarkRatio =
              scores.reduce((sum, score) => sum + score.darkRatio, 0) / scores.length;
            const relativeLift = sorted[0].darkness - rowAverage;
            const darkRatioLift = sorted[0].darkRatio - rowDarkRatio;
            const duplicateMark =
  sorted[1].darkRatio > 0.18 &&
  sorted[1].darkness > rowAverage + 12 &&
  confidence < Math.max(14, rowSpread * 0.7);
            const answer =
  !duplicateMark &&
  sorted[0].darkness > 38 &&
  sorted[0].darkRatio > 0.12 &&
  confidence >= Math.max(12, rowSpread * 0.7) &&
  relativeLift >= Math.max(12, rowSpread * 0.8) &&
  darkRatioLift > 0.04
    ? sorted[0].label
    : "";

            answers.push(answer);
            diagnostics.push({
              itemNo: itemIndex + 1,
              answer,
              confidence,
              darkness: sorted[0].darkness,
              darkRatio: sorted[0].darkRatio,
              duplicateMark,
              relativeLift,
              rowAverage,
              rowSpread,
            });
          }

          postMessage({
            type: "detected",
            answers,
            diagnostics,
            detected: answers.filter(Boolean).length,
            engine: "opencv",
            bounds: {
              x: bounds.x / canvas.width,
              y: bounds.y / canvas.height,
              width: bounds.width / canvas.width,
              height: bounds.height / canvas.height,
            }
          });
        };

        image.onerror = () => {
          postMessage({ type: "error", message: "Unable to read captured image." });
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
  const [guideBox, setGuideBox] = useState({
    top: 12,
    left: 5,
    width: 90,
    height: 72,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [exams, setExams] = useState([]);
  const [cameraZoom, setCameraZoom] = useState(0);
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
  const [scanSettings, setScanSettings] = useState(DEFAULT_SCAN_SETTINGS);
  const [qrScanEnabled, setQrScanEnabled] = useState(true);
  const [qrStatus, setQrStatus] = useState("QR scanner ready.");
  const [qrMetadata, setQrMetadata] = useState(null);
  const [batchMode, setBatchMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("scan");
  const [fullScanner, setFullScanner] = useState(true);
  const [scanStep, setScanStep] = useState("scan");
  const [markerGuide, setMarkerGuide] = useState(null);
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

    const data = await requestApi(
      apiBaseUrl,
      `/item-analysis/${examId}/results`,
      {
        token: authToken,
      },
    );
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
    setScanStep("scan");
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
    const itemCount = Number(
      metadata.itemsOnPage || metadata.numberOfItems || 50,
    );

    if (itemCount <= 10) {
      setScanSettings({
        top: 4,
        bottom: 96,
        left: 4,
        right: 96,
        numberColumn: 18,
        headerRow: 12,
      });
    } else if (itemCount <= 25) {
      setScanSettings({
        top: 22,
        bottom: 88,
        left: 11,
        right: 89,
        numberColumn: 14,
        headerRow: 4,
      });
    } else {
      setScanSettings({
        top: 12,
        bottom: 94,
        left: 10,
        right: 90,
        numberColumn: 12,
        headerRow: 3,
      });
    }
    setQrStatus(
      `QR read: ${metadata.title || "OMR sheet"}. Looking for exam...`,
    );

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

    if (
      selectedExamId !== matchingExam._id ||
      answers.length !== matchingExam.numberOfItems
    ) {
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
    setMarkerGuide(null);
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
        quality: 1,
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
      setDetectorHtml(
        buildDetectorHtml(
          imageUri,
          scanRange.itemsOnPage,
          scanSettings,
          getOpenCvUrl(apiBaseUrl),
        ),
      );
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
        if (payload.bounds) {
          setMarkerGuide(payload.bounds);
        }
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
        setDetectorHtml("");
        setCapturedImage("");
        setScanStep("review");
      } else if (payload.type === "no_sheet") {
        setDetectionStatus(
          payload.message ||
            "No OMR sheet detected. Align the answer table and retake.",
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
      Alert.alert(
        "Missing student",
        "Student name and student ID are required.",
      );
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
      setScanStep("scan");

      if (batchMode) {
        setStudentName("");
        setStudentId("");
        clearAnswers();
        setQrMetadata(null);
        setQrStatus("QR scanner ready.");
        setQrScanEnabled(true);
        setActiveScanRange(null);
        activeScanRangeRef.current = null;
        setScanStep("scan");
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
            <Text style={styles.kicker}>Mobile OMR Scanner</Text>
            <Text style={styles.title}>Mobile OMR Scanner</Text>
            <Text style={styles.muted}>
              Sign in with your Question Bank account and connect to your
              backend.
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
            <Text
              style={[
                styles.segmentText,
                mode === item && styles.segmentTextActive,
              ]}
            >
              {item === "scan"
                ? "Scan"
                : item === "history"
                  ? "History"
                  : "Web"}
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
        <View style={{ flex: 1 }}>
          {/*
          <ExamSelector
            exams={exams}
            loading={loading}
            onRefresh={() => loadExams()}
            onSelect={selectExam}
            selectedExamId={selectedExamId}
          />
          */}

          {mode === "history" ? (
            <HistoryCard
              history={history}
              numberOfItems={selectedExam?.numberOfItems || 0}
              onRefresh={() => loadHistory()}
            />
          ) : (
            <>
              {/*
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
            */}

              {/*
              <ScoreCard
                liveScore={liveScore}
                numberOfItems={selectedExam?.numberOfItems || 0}
                scannedPages={scannedPages}
              />
              */}

              <View style={{ flex: 1 }}>
                {/**
                 *<View style={styles.rowBetween}>
                  <Text style={styles.sectionTitle}>Native OMR Detection</Text>
                  <Text style={styles.historyCount}>
                    {history.length} saved
                  </Text>
                </View>
                 */}

                <QrStatusCard
                  metadata={qrMetadata}
                  qrScanEnabled={qrScanEnabled}
                  qrStatus={qrStatus}
                  onToggleQrScan={toggleQrScan}
                />

                {scanStep === "review" ? (
                  <ScrollView contentContainerStyle={styles.reviewScreen}>
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
                    <AnswerReview
                      answers={answers}
                      clearAnswers={clearAnswers}
                      loading={loading}
                      saveResult={saveResult}
                      setAnswer={setAnswer}
                    />

                    <PrimaryButton
                      label="Scan Again"
                      onPress={() => {
                        setScanStep("scan");
                      }}
                    />

                    <PrimaryButton
                      disabled={loading}
                      label="Submit Answer"
                      onPress={() => saveResult()}
                    />
                  </ScrollView>
                ) : !permission?.granted ? (
                  <PrimaryButton
                    label="Allow Camera"
                    onPress={requestPermission}
                  />
                ) : (
                  <View style={styles.cameraFrame}>
                    <CameraView
                      ref={cameraRef}
                      style={styles.camera}
                      facing="back"
                      zoom={cameraZoom}
                      barcodeScannerSettings={{
                        barcodeTypes: ["qr"],
                      }}
                      onBarcodeScanned={
                        qrScanEnabled ? handleQrScanned : undefined
                      }
                    />
                    <CameraAlignmentGuide
                      guideBox={guideBox}
                      markerGuide={markerGuide}
                      itemsOnPage={
                        qrMetadata
                          ? getQrScanRange(qrMetadata, selectedExam).itemsOnPage
                          : Math.min(
                              selectedExam?.numberOfItems || OMR_ITEMS_PER_PAGE,
                              OMR_ITEMS_PER_PAGE,
                            )
                      }
                      scanSettings={scanSettings}
                    />
                    <View style={styles.guidePanel}>
                      <View style={styles.guideControls}>
                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              top: Math.max(0, g.top - 1),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>↑</Text>
                        </Pressable>
                      </View>

                      <View style={styles.guideControls}>
                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              left: Math.max(0, g.left - 1),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>←</Text>
                        </Pressable>

                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              left: Math.min(50, g.left + 1),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>→</Text>
                        </Pressable>
                      </View>

                      <View style={styles.guideControls}>
                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              top: Math.min(50, g.top + 1),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>↓</Text>
                        </Pressable>
                      </View>

                      <View style={styles.guideControls}>
                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              width: Math.max(50, g.width - 2),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>W−</Text>
                        </Pressable>

                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              width: Math.min(98, g.width + 2),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>W+</Text>
                        </Pressable>

                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              height: Math.max(50, g.height - 2),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>H−</Text>
                        </Pressable>

                        <Pressable
                          style={styles.guideButton}
                          onPress={() =>
                            setGuideBox((g) => ({
                              ...g,
                              height: Math.min(95, g.height + 2),
                            }))
                          }
                        >
                          <Text style={styles.guideButtonText}>H+</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View style={styles.zoomControls}>
                      <Pressable
                        style={styles.zoomButton}
                        onPress={() =>
                          setCameraZoom((z) => Math.max(0, z - 0.05))
                        }
                      >
                        <Text style={styles.zoomText}>−</Text>
                      </Pressable>

                      <Text style={styles.zoomLabel}>
                        {Math.round(cameraZoom * 100)}%
                      </Text>

                      <Pressable
                        style={styles.zoomButton}
                        onPress={() =>
                          setCameraZoom((z) => Math.min(1, z + 0.05))
                        }
                      >
                        <Text style={styles.zoomText}>+</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={styles.captureFloating}
                      onPress={captureAndDetect}
                    >
                      <Text style={styles.captureText}>Capture</Text>
                    </Pressable>
                  </View>
                )}
                {/*
<Text style={styles.muted}>
  Align the printed OMR table in the camera preview, then
  capture and detect. Review answers before saving.
</Text>
*/}
                {/*
                <ScanAreaControls
                  scanSettings={scanSettings}
                  setScanSettings={setScanSettings}
                />
                */}

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

              {/*
<AnswerReview
  answers={answers}
  clearAnswers={clearAnswers}
  loading={loading}
  saveResult={saveResult}
  setAnswer={setAnswer}
/>
*/}
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function ScanAreaControls({ scanSettings, setScanSettings }) {
  const fields = [
    ["top", "Top"],
    ["bottom", "Bottom"],
    ["left", "Left"],
    ["right", "Right"],
    ["numberColumn", "No. Column"],
    ["headerRow", "Header Row"],
  ];

  const adjustValue = (key, delta) => {
    setScanSettings((current) => ({
      ...current,
      [key]: clampScanSetting(key, (current[key] || 0) + delta),
    }));
  };

  const resetScanArea = () => {
    setScanSettings(DEFAULT_SCAN_SETTINGS);
  };

  return (
    <View style={styles.scanAreaPanel}>
      {/**
       <View style={styles.rowBetween}>
        <Text style={styles.scanAreaTitle}>Scan Area</Text>
        <Pressable onPress={resetScanArea}>
          <Text style={styles.linkText}>Reset</Text>
        </Pressable>
      </View>
       */}
      <View style={styles.scanAreaGrid}>
        {fields.map(([key, label]) => (
          <View key={key} style={styles.scanField}>
            <Text style={styles.scanFieldLabel}>{label}</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepButton}
                onPress={() => adjustValue(key, -scanSettingLimits[key].step)}
              >
                <Text style={styles.stepButtonText}>-</Text>
              </Pressable>
              <Text style={styles.stepValue}>{scanSettings[key]}%</Text>
              <Pressable
                style={styles.stepButton}
                onPress={() => adjustValue(key, scanSettingLimits[key].step)}
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function CameraAlignmentGuide({
  itemsOnPage,
  scanSettings,
  markerGuide,
  guideBox,
}) {
  const scan = normalizeScanSettings(scanSettings);
  const blockCount = Math.min(
    OMR_MAX_BLOCKS_PER_PAGE,
    Math.max(1, Math.ceil(Number(itemsOnPage || 0) / OMR_ROWS_PER_BLOCK)),
  );
  const guideStyle = {
    top: `${guideBox.top}%`,
    left: `${guideBox.left}%`,
    width: `${guideBox.width}%`,
    height: `${guideBox.height}%`,
  };
  const headerStyle = markerGuide
    ? {
        top: `${scan.headerRow * 100}%`,
      }
    : {
        top: `${scan.headerRow * 100}%`,
      };
  const numberColumnStyle = {
    left: `${scan.numberColumn * 100}%`,
  };
  const bubbleGuides = Array.from({ length: blockCount }, (_, blockIndex) => {
    const blockLeft = blockIndex / blockCount;
    const blockWidth = 1 / blockCount;
    const answerLeft = blockLeft + blockWidth * scan.numberColumn;
    const answerWidth = blockWidth * (1 - scan.numberColumn);

    return choices.map((choice, choiceIndex) => ({
      choice,
      key: `${blockIndex}-${choice}`,
      left: `${(answerLeft + answerWidth * ((choiceIndex + 0.5) / choices.length)) * 100}%`,
    }));
  }).flat();

  return (
    <View pointerEvents="none" style={styles.cameraGuideLayer}>
      <View style={[styles.cameraGuideBox, guideStyle]}>
        {/*
        <View style={[styles.cameraGuideHeaderLine, headerStyle]} />
        <View style={[styles.cameraGuideNumberLine, numberColumnStyle]} />
        */}
        {/*
          {bubbleGuides.map((guide) => (
            <View
              key={guide.key}
              style={[styles.cameraBubbleGuideLine, { left: guide.left }]}
            >
              <Text style={styles.cameraBubbleGuideLabel}>
                {guide.choice}
              </Text>
            </View>
          ))}
          */}
        {/**
         * {Array.from({ length: Math.max(0, blockCount - 1) }, (_, index) => (
          <View
            key={String(index)}
            style={[
              styles.cameraGuideBlockLine,
              { left: `${((index + 1) / blockCount) * 100}%` },
            ]}
          />
        ))}
         */}
        {/* Top edge */}
        <View
          style={[
            styles.guideEdge,
            {
              top: 0,
              left: 0,
              right: 0,
              height: 2,
            },
          ]}
        />

        {/* Bottom edge */}
        <View
          style={[
            styles.guideEdge,
            {
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
            },
          ]}
        />

        {/* Left edge */}
        <View
          style={[
            styles.guideEdge,
            {
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
            },
          ]}
        />

        {/* Right edge */}
        <View
          style={[
            styles.guideEdge,
            {
              right: 0,
              top: 0,
              bottom: 0,
              width: 2,
            },
          ]}
        />
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
        <Text style={styles.cameraGuideText}></Text>
      </View>
    </View>
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
        <Text style={styles.warning}>
          No item analysis exams with answer keys found.
        </Text>
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
          <Text
            style={[styles.toggleText, batchMode && styles.toggleTextActive]}
          >
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
        Batch mode clears the student and answers after each save so you can
        scan the next sheet immediately.
      </Text>
    </View>
  );
}

function ScoreCard({ liveScore, numberOfItems, scannedPages }) {
  const expectedPages = Math.max(1, getExpectedOmrPageCount(numberOfItems));
  const scannedPageCount = Object.keys(scannedPages || {}).length;

  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreLabel}>Live Score</Text>
      <Text style={styles.scoreText}>
        {liveScore.score}/{liveScore.total || "-"}
      </Text>
      <Text style={styles.scoreSubtext}>
        {liveScore.detected} answer{liveScore.detected === 1 ? "" : "s"}{" "}
        detected
      </Text>
      {expectedPages > 1 ? (
        <Text style={styles.scoreSubtext}>
          {scannedPageCount}/{expectedPages} OMR page
          {expectedPages === 1 ? "" : "s"} scanned
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
          <Text
            style={[
              styles.toggleText,
              qrScanEnabled && styles.toggleTextActive,
            ]}
          >
            {qrScanEnabled ? "QR On" : "QR Off"}
          </Text>
        </Pressable>
      </View>
      {metadata ? (
        <Text style={styles.qrMeta}>
          {metadata.subject || "No subject"} |{" "}
          {metadata.section || "No section"} | {metadata.numberOfItems || "-"}{" "}
          items
          {metadata.pageNo
            ? ` | Page ${metadata.pageNo}/${metadata.pageCount || 1} | Items ${metadata.startItem || 1}-${metadata.endItem || metadata.numberOfItems || "-"}`
            : ""}
        </Text>
      ) : null}
    </View>
  );
}

function AnswerReview({
  answers,
  clearAnswers,
  loading,
  saveResult,
  setAnswer,
}) {
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
  guideControls: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  guideButton: {
    backgroundColor: "rgba(0,0,0,0.75)",
    borderColor: "rgba(255,255,255,0.6)",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  guideButtonText: {
    color: "#ffffff",
    fontWeight: "900",
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
    flex: 1,
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
  cameraFrame: {
    flex: 1,
    width: "100%",
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  camera: {
    width: "100%",
    height: "100%",
  },
  cameraGuideLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
  },
  cameraGuideBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.90)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  guideEdge: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  cameraGuideHeaderLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: "#00FF00",
  },
  reviewScreen: {
    flex: 1,
    padding: 12,
  },
  cameraGuideNumberLine: {
    position: "absolute",
    bottom: 0,
    top: 0,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.9)",
  },
  cameraGuideBlockLine: {
    position: "absolute",
    bottom: 0,
    top: 0,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(240,179,24,0.7)",
  },
  cameraBubbleGuideLine: {
    position: "absolute",
    bottom: 0,
    top: 0,
    alignItems: "center",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(63,212,255,0.65)",
  },
  cameraBubbleGuideLabel: {
    backgroundColor: "rgba(36,0,10,0.72)",
    borderRadius: 5,
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 24,
    minWidth: 16,
    paddingHorizontal: 3,
    paddingVertical: 2,
    textAlign: "center",
  },
  cameraGuideText: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.80)",
    borderRadius: 6,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  corner: {
    position: "absolute",
    borderColor: "#00FF00",
    height: 70,
    width: 70,
  },
  cornerTopLeft: {
    borderLeftWidth: 6,
    borderTopWidth: 6,
    left: -3,
    top: -3,
  },
  cornerTopRight: {
    borderRightWidth: 6,
    borderTopWidth: 6,
    right: -3,
    top: -3,
  },
  cornerBottomLeft: {
    borderBottomWidth: 6,
    borderLeftWidth: 6,
    bottom: -3,
    left: -3,
  },
  cornerBottomRight: {
    borderBottomWidth: 6,
    borderRightWidth: 6,
    bottom: -3,
    right: -3,
  },
  detectorWebView: {
    height: 1,
    opacity: 0,
  },
  statusText: {
    color: "#ffffff",
    fontWeight: "800",
    marginTop: 8,
    paddingHorizontal: 12,
  },
  scanAreaPanel: {
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    marginBottom: 10,
    padding: 10,
  },
  guidePanel: {
    position: "absolute",
    left: 10,
    bottom: 120,
    zIndex: 60,
    elevation: 60,
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 10,
    borderRadius: 12,
  },
  scanAreaTitle: {
    color: "#24000a",
    fontWeight: "900",
  },
  scanAreaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  scanField: {
    width: "48%",
  },
  scanFieldLabel: {
    color: "#6d5960",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  stepper: {
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ead5c8",
    borderRadius: 8,
    flexDirection: "row",
  },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#fff1e1",
    justifyContent: "center",
    minHeight: 34,
    width: 34,
  },
  stepButtonText: {
    color: "#980018",
    fontSize: 18,
    fontWeight: "900",
  },
  stepValue: {
    color: "#24000a",
    flex: 1,
    fontWeight: "900",
    textAlign: "center",
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
  zoomControls: {
    position: "absolute",
    right: 16,
    top: 16,
    zIndex: 40,
    elevation: 40,
    alignItems: "center",
    gap: 8,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
  },
  zoomText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
  },
  zoomLabel: {
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  captureFloating: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "#980018",
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: 50,
    zIndex: 30,
    elevation: 30,
  },

  captureText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 18,
  },
});
