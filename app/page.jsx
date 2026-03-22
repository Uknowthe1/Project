"use client";

import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const HISTORY_KEY = "brid-focus-demo-history";
const MEDIAPIPE_VERSION = "0.10.32";
const LONG_ABSENCE_MS = 10 * 1000;
const STRONG_WARNING_MS = 30 * 1000;
const AUTO_END_MS = 60 * 1000;
const FACE_RECHECK_GRACE_MS = 1500;
const AWAY_FRAME_CONFIRM_COUNT = 3;
const RETURN_FRAME_CONFIRM_COUNT = 2;

function isValidTime(value) {
  return Number.isFinite(value) && value >= 0;
}

function getStudyPlan(goodTime, normalTime, badTime) {
  if (!isValidTime(goodTime) || !isValidTime(normalTime) || !isValidTime(badTime)) return null;

  const total = goodTime + normalTime + badTime;
  if (total === 0) return null;

  const ratio = (goodTime / total) * 100;

  if (ratio >= 80) {
    return {
      level: "좋음",
      ratio,
      message: "공부 시작 상태가 좋아서 조금 더 길게 집중해볼 수 있어요.",
      studyMinutes: 50,
      breakMinutes: 10,
      badge: "50분 집중 / 10분 휴식",
    };
  }

  if (ratio >= 50) {
    return {
      level: "보통",
      ratio,
      message: "무난한 상태이므로 가장 기본적인 공부 시간을 추천해요.",
      studyMinutes: 25,
      breakMinutes: 5,
      badge: "25분 집중 / 5분 휴식",
    };
  }

  return {
    level: "낮음",
    ratio,
    message: "오늘은 짧게 시작하면서 천천히 집중을 올리는 것이 좋아요.",
    studyMinutes: 15,
    breakMinutes: 5,
    badge: "15분 집중 / 5분 휴식",
  };
}

function getBehaviorSummary(longAbsences, endReason) {
  if (endReason === "auto-away") {
    return {
      focusScore: 0,
      label: "자동 종료",
      message: "60초 연속 이탈로 세션이 자동 종료되어 이번 행동 지표 점수는 0점으로 처리했습니다.",
    };
  }

  const focusScore = Math.max(0, 100 - (longAbsences * 15));

  if (focusScore >= 85) {
    return {
      focusScore,
      label: "안정적이었어요",
      message: "추천한 시간 동안 자리 이탈이 거의 없어 학습 흐름이 안정적이었어요.",
    };
  }

  if (focusScore >= 60) {
    return {
      focusScore,
      label: "무난했어요",
      message: "자리 비움은 조금 있었지만 전체 학습 흐름은 비교적 유지됐어요.",
    };
  }

  if (focusScore >= 30) {
    return {
      focusScore,
      label: "흔들렸어요",
      message: "자리 비움이 여러 번 있어 추천 시간을 끝까지 유지하기 어려웠어요.",
    };
  }

  return {
    focusScore,
    label: "다음엔 더 짧게",
    message: "자리 비움이 많아 다음에는 더 짧은 추천 시간부터 시작하는 것이 좋아요.",
  };
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remains = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remains}`;
}

function getAwayFeedback(awayDurationMs) {
  if (awayDurationMs >= STRONG_WARNING_MS) {
    return {
      warningLevel: "danger",
      text: "2차 경고: 빨리 자리로 돌아오세요",
      hint: "30초 이상 연속 이탈이 감지되어 빨간 경고가 켜졌습니다.",
      stageLabel: "2차 경고",
    };
  }

  if (awayDurationMs >= LONG_ABSENCE_MS) {
    return {
      warningLevel: "caution",
      text: "1차 경고: 자리 복귀 필요",
      hint: "10초 이상 연속 이탈이 감지되어 주황 경고가 켜졌습니다.",
      stageLabel: "1차 경고",
    };
  }

  return {
    warningLevel: "neutral",
    text: "자리 비움 확인 중",
    hint: "10초 이상 연속으로 자리를 비우면 1차 경고가 켜집니다.",
    stageLabel: "확인 중",
  };
}

function getSessionEndInfo(reason) {
  if (reason === "auto-away") {
    return {
      reason,
      label: "자동 종료",
      title: "자동 종료됨",
      message: "60초 이상 연속으로 자리를 비워 세션이 자동 종료되었습니다.",
      tone: "red",
    };
  }

  if (reason === "timer") {
    return {
      reason,
      label: "시간 완료",
      title: "추천 시간 완료",
      message: "추천 시간이 끝나 결과를 정리했습니다.",
      tone: "green",
    };
  }

  return {
    reason,
    label: "사용자 종료",
    title: "사용자 종료",
    message: "원할 때 세션을 마무리하고 결과를 확인했습니다.",
    tone: "amber",
  };
}

function getFaceBox(landmarks) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;

  landmarks.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function analyzeFace(landmarks) {
  if (!landmarks?.length) {
    return {
      kind: "missing",
      isPresent: false,
      text: "얼굴 재확인 중",
      hint: "얼굴이 잠깐 가려졌어요. 점선 안쪽으로 다시 맞춰주세요.",
    };
  }

  const box = getFaceBox(landmarks);
  const nose = landmarks[1];
  const isLargeEnough = box.width >= 0.14 && box.height >= 0.18;
  const isCentered =
    box.centerX >= 0.18 &&
    box.centerX <= 0.82 &&
    box.centerY >= 0.18 &&
    box.centerY <= 0.84;
  const isNoseVisible =
    Boolean(nose) &&
    nose.x >= 0.08 &&
    nose.x <= 0.92 &&
    nose.y >= 0.08 &&
    nose.y <= 0.94;

  if (!isLargeEnough) {
    return {
      kind: "too-far",
      isPresent: false,
      text: "얼굴 위치 조정 중",
      hint: "카메라와 조금 더 가깝게 앉아주세요.",
    };
  }

  if (!isCentered || !isNoseVisible) {
    return {
      kind: "off-center",
      isPresent: false,
      text: "얼굴 위치 조정 중",
      hint: "얼굴을 점선 안쪽 중앙에 맞추면 인식이 더 안정적입니다.",
    };
  }

  return {
    kind: "present",
    isPresent: true,
    text: "카메라가 얼굴을 인식하고 있습니다.",
    hint: "얼굴 위치가 안정적으로 인식되고 있어요.",
  };
}

function getDateLabel() {
  return new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function runDemoTrackingFrame(context) {
  const {
    animationRef,
    finishLockRef,
    isVideoPlayingRef,
    videoRef,
    landmarkerRef,
    lastVideoTimeRef,
    lastDetectionTimestampRef,
    absenceStartTimeRef,
    trackingStateRef,
    setTrackingText,
    setTrackingHint,
    setWarningLevel,
    setAwayDurationSeconds,
    setCameraMessage,
    incrementAbsence,
    finishSession,
  } = context;

  if (finishLockRef.current) {
    return;
  }

  if (!isVideoPlayingRef.current || !videoRef.current || !landmarkerRef.current) {
    animationRef.current = requestAnimationFrame(() => runDemoTrackingFrame(context));
    return;
  }

  const videoElement = videoRef.current;

  if (
    videoElement.readyState < 2 ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0 ||
    videoElement.paused ||
    videoElement.ended ||
    videoElement.currentTime <= 0
  ) {
    animationRef.current = requestAnimationFrame(() => runDemoTrackingFrame(context));
    return;
  }

  let nowInMs = Math.round(performance.now());
  const realNowMs = Date.now();

  if (videoElement.currentTime !== lastVideoTimeRef.current) {
    lastVideoTimeRef.current = videoElement.currentTime;

    if (nowInMs <= lastDetectionTimestampRef.current) {
      nowInMs = lastDetectionTimestampRef.current + 1;
    }
    lastDetectionTimestampRef.current = nowInMs;

    try {
      const results = landmarkerRef.current.detectForVideo(videoElement, nowInMs);
      const assessment = analyzeFace(results.faceLandmarks?.[0]);
      const trackingState = trackingStateRef.current;

      setCameraMessage("");
      setTrackingHint(assessment.hint);

      if (assessment.isPresent) {
        trackingState.presentFrames += 1;
        trackingState.awayFrames = 0;
        trackingState.lastSeenAt = realNowMs;

        if (trackingState.presentFrames >= RETURN_FRAME_CONFIRM_COUNT) {
          absenceStartTimeRef.current = null;
          trackingState.countedBuckets = 0;
          trackingState.awaySeconds = 0;
          setAwayDurationSeconds(0);
          setWarningLevel("neutral");
          setTrackingText(assessment.text);
        } else {
          setTrackingText("카메라가 얼굴을 확인하고 있습니다.");
        }
      } else {
        trackingState.presentFrames = 0;

        const shouldGracefullyRecheck =
          assessment.kind === "missing" &&
          trackingState.lastSeenAt &&
          realNowMs - trackingState.lastSeenAt < FACE_RECHECK_GRACE_MS;

        if (shouldGracefullyRecheck) {
          trackingState.awayFrames = 0;
          absenceStartTimeRef.current = null;
          trackingState.countedBuckets = 0;
          trackingState.awaySeconds = 0;
          setAwayDurationSeconds(0);
          setWarningLevel("neutral");
          setTrackingText("얼굴 재확인 중");
        } else {
          trackingState.awayFrames += 1;

          if (trackingState.awayFrames >= AWAY_FRAME_CONFIRM_COUNT) {
            if (!absenceStartTimeRef.current) {
              absenceStartTimeRef.current = realNowMs;
              trackingState.countedBuckets = 0;
            }

            const awayDurationMs = realNowMs - absenceStartTimeRef.current;
            const awaySeconds = Math.floor(awayDurationMs / 1000);

            if (awaySeconds !== trackingState.awaySeconds) {
              trackingState.awaySeconds = awaySeconds;
              setAwayDurationSeconds(awaySeconds);
            }

            const countedBuckets = Math.floor(awayDurationMs / LONG_ABSENCE_MS);
            if (countedBuckets > trackingState.countedBuckets) {
              incrementAbsence(countedBuckets - trackingState.countedBuckets);
              trackingState.countedBuckets = countedBuckets;
            }

            const feedback = getAwayFeedback(awayDurationMs);
            setWarningLevel(feedback.warningLevel);
            setTrackingText(feedback.text);
            setTrackingHint(feedback.hint);

            if (awayDurationMs >= AUTO_END_MS) {
              finishSession({ reason: "auto-away" });
              return;
            }
          } else {
            absenceStartTimeRef.current = null;
            trackingState.countedBuckets = 0;
            trackingState.awaySeconds = 0;
            setAwayDurationSeconds(0);
            setWarningLevel("neutral");
            setTrackingText(assessment.text);
          }
        }
      }
    } catch (error) {
      setTrackingText("카메라 확인 중");
      setTrackingHint("카메라 준비 중에는 잠시 인식이 흔들릴 수 있어요.");
      setCameraMessage("조명이나 네트워크 상태에 따라 초기 인식이 잠깐 늦어질 수 있어요.");
    }
  }

  if (finishLockRef.current) {
    return;
  }

  animationRef.current = requestAnimationFrame(() => runDemoTrackingFrame(context));
}

export default function Page() {
  const [step, setStep] = useState("input");
  const [goodTime, setGoodTime] = useState("");
  const [normalTime, setNormalTime] = useState("");
  const [badTime, setBadTime] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [longAbsences, setLongAbsences] = useState(0);
  const [awayDurationSeconds, setAwayDurationSeconds] = useState(0);
  const [warningLevel, setWarningLevel] = useState("neutral");
  const [trackingText, setTrackingText] = useState("카메라 대기 중");
  const [trackingHint, setTrackingHint] = useState("얼굴을 점선 안쪽에 맞추면 인식이 더 안정적입니다.");
  const [cameraMessage, setCameraMessage] = useState("");
  const [sessionEndInfo, setSessionEndInfo] = useState(null);
  const [history, setHistory] = useState([]);

  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const animationRef = useRef(null);
  const isVideoPlayingRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectionTimestampRef = useRef(-1);
  const absenceStartTimeRef = useRef(null);
  const trackingStateRef = useRef({
    presentFrames: 0,
    awayFrames: 0,
    lastSeenAt: null,
    countedBuckets: 0,
    awaySeconds: 0,
  });
  const planRef = useRef(null);
  const historyRef = useRef([]);
  const longAbsencesRef = useRef(0);
  const finishLockRef = useRef(false);

  const goodValue = parseFloat(goodTime);
  const normalValue = parseFloat(normalTime);
  const badValue = parseFloat(badTime);
  const hasRangeError =
    (goodTime !== "" && !isValidTime(goodValue)) ||
    (normalTime !== "" && !isValidTime(normalValue)) ||
    (badTime !== "" && !isValidTime(badValue));
  const plan =
    !hasRangeError && isValidTime(goodValue) && isValidTime(normalValue) && isValidTime(badValue)
      ? getStudyPlan(goodValue, normalValue, badValue)
      : null;
  const behaviorSummary = getBehaviorSummary(longAbsences, sessionEndInfo?.reason);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    longAbsencesRef.current = longAbsences;
  }, [longAbsences]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const parsedHistory = JSON.parse(saved);
        historyRef.current = parsedHistory;
        setHistory(parsedHistory);
      }
    } catch {
      historyRef.current = [];
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!isRunning) return undefined;

    const timer = setInterval(() => {
      setTimeLeft((current) => {
        if (current > 1) {
          return current - 1;
        }

        window.setTimeout(() => {
          finishSession({ reason: "timer" });
        }, 0);

        return 0;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, []);

  function resetTrackingRefs() {
    trackingStateRef.current = {
      presentFrames: 0,
      awayFrames: 0,
      lastSeenAt: null,
      countedBuckets: 0,
      awaySeconds: 0,
    };
    absenceStartTimeRef.current = null;
    lastVideoTimeRef.current = -1;
    lastDetectionTimestampRef.current = -1;
  }

  function resetSessionSignals() {
    setAwayDurationSeconds(0);
    setWarningLevel("neutral");
    setTrackingText("카메라 대기 중");
    setTrackingHint("얼굴을 점선 안쪽에 맞추면 인식이 더 안정적입니다.");
  }

  function incrementLongAbsences(amount) {
    if (!amount) return;

    longAbsencesRef.current += amount;
    setLongAbsences(longAbsencesRef.current);
  }

  async function startTracking() {
    try {
      setCameraMessage("");
      setWarningLevel("neutral");
      setAwayDurationSeconds(0);
      setTrackingText("카메라 연결 중");
      setTrackingHint("전면 카메라를 열고 얼굴 위치를 확인하고 있어요.");
      resetTrackingRefs();

      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
      );

      landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          aspectRatio: { ideal: 4 / 3 },
        },
      });

      const videoElement = videoRef.current;

      if (!videoElement) {
        stopTracking();
        setCameraMessage("카메라 화면을 준비하지 못했습니다. 새로고침 후 다시 시도해주세요.");
        return;
      }

      videoElement.srcObject = stream;
      videoElement.addEventListener(
        "loadeddata",
        () => {
          videoElement
            .play()
            .then(() => {
              isVideoPlayingRef.current = true;
              animationRef.current = requestAnimationFrame(() =>
                runDemoTrackingFrame({
                  animationRef,
                  finishLockRef,
                  isVideoPlayingRef,
                  videoRef,
                  landmarkerRef,
                  lastVideoTimeRef,
                  lastDetectionTimestampRef,
                  absenceStartTimeRef,
                  trackingStateRef,
                  setTrackingText,
                  setTrackingHint,
                  setWarningLevel,
                  setAwayDurationSeconds,
                  setCameraMessage,
                  incrementAbsence: incrementLongAbsences,
                  finishSession,
                })
              );
            })
            .catch(() => {
              stopTracking();
              setWarningLevel("neutral");
              setAwayDurationSeconds(0);
              setCameraMessage("카메라를 시작하지 못했습니다. 브라우저 권한을 다시 확인해주세요.");
              setTrackingText("카메라 없이 진행 중");
              setTrackingHint("권한을 허용하면 자리 비움 확인도 함께 사용할 수 있어요.");
            });
        },
        { once: true }
      );
    } catch (error) {
      console.error(error);
      stopTracking();
      setWarningLevel("neutral");
      setAwayDurationSeconds(0);
      setCameraMessage("카메라가 없어도 타이머는 사용할 수 있어요. 이 경우 자리 비움 확인은 생략됩니다.");
      setTrackingText("카메라 없이 진행 중");
      setTrackingHint("모바일에서는 전면 카메라 권한을 허용하면 인식이 더 안정적입니다.");
    }
  }

  function stopTracking() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    resetTrackingRefs();
    isVideoPlayingRef.current = false;

    const videoElement = videoRef.current;
    if (videoElement?.srcObject) {
      videoElement.srcObject.getTracks().forEach((track) => track.stop());
      videoElement.srcObject = null;
    }

    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close();
      } catch {
        // Ignore cleanup errors.
      }
      landmarkerRef.current = null;
    }
  }

  function handleStartStudy() {
    if (!plan) return;

    finishLockRef.current = false;
    planRef.current = plan;
    longAbsencesRef.current = 0;
    setSessionEndInfo(null);
    setStep("session");
    setTimeLeft(plan.studyMinutes * 60);
    setLongAbsences(0);
    setAwayDurationSeconds(0);
    setWarningLevel("neutral");
    setTrackingText("카메라 연결 중");
    setTrackingHint("전면 카메라를 열고 얼굴 위치를 확인하고 있어요.");
    setIsRunning(true);
    void startTracking();
  }

  function finishSession(options = {}) {
    if (finishLockRef.current) return;

    const currentPlan = planRef.current;
    if (!currentPlan) return;

    const reason = options.reason || "manual";
    const nextEndInfo = getSessionEndInfo(reason);

    finishLockRef.current = true;
    setIsRunning(false);
    stopTracking();
    setSessionEndInfo(nextEndInfo);
    setStep("result");

    const nextBehaviorSummary = getBehaviorSummary(longAbsencesRef.current, reason);
    const record = {
      date: getDateLabel(),
      startLevel: currentPlan.level,
      schedule: currentPlan.badge,
      endLabel: nextEndInfo.label,
      focusScore: nextBehaviorSummary.focusScore,
    };

    const nextHistory = [record, ...historyRef.current].slice(0, 3);
    historyRef.current = nextHistory;
    setHistory(nextHistory);

    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      // Ignore localStorage failure.
    }
  }

  function resetDemo() {
    finishLockRef.current = false;
    longAbsencesRef.current = 0;
    setSessionEndInfo(null);
    setStep("input");
    setIsRunning(false);
    setTimeLeft(0);
    setLongAbsences(0);
    setCameraMessage("");
    resetSessionSignals();
    stopTracking();
  }

  function resetForNewValues() {
    resetDemo();
    setGoodTime("");
    setNormalTime("");
    setBadTime("");
  }

  function clearHistory() {
    historyRef.current = [];
    setHistory([]);

    try {
      window.localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Ignore localStorage failure.
    }
  }

  function removeHistoryItem(targetIndex) {
    const nextHistory = historyRef.current.filter((_, index) => index !== targetIndex);
    historyRef.current = nextHistory;
    setHistory(nextHistory);

    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      // Ignore localStorage failure.
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <span className="tag">교내 과학탐구발명대회 시제품</span>
        <h1>FOCUSMATE</h1>
        <p>
          BRID 멘탈루틴 명상 중 뇌파 상태(좋음/보통/나쁨 시간)에서 좋음 비율을 계산해 공부 시간을 추천하고,
          공부하는 동안 자리 이탈 같은 행동 지표를 간단히 관찰하는 과학탐구형 웹앱입니다.
        </p>
        <div className="hero-meta">
          <span>주제: 맞춤형 공부 시간 추천</span>
          <span>근거: 멘탈루틴 좋음 비율 실측 데이터</span>
          <span>과정: 좋음 비율 계산 → 구간 분류 → 관찰</span>
          <span>형태: 직접 제작한 웹앱 시제품</span>
          <span>안전: 영상 미저장</span>
        </div>
      </section>

      {step === "input" && (
        <section className="grid">
          <div className="main-stack">
            <article className="card">
              <div className="card-head">
                <h2>1. 멘탈루틴 좋음 비율 입력</h2>
                <p>BRID 멘탈루틴 명상 화면에서 좋음·보통·나쁨 시간(초)을 읽어 입력하면 좋음 비율로 공부 시작 상태를 추천합니다.</p>
              </div>

              <div className="input-grid">
                <label>
                  <span>좋음 시간(초)</span>
                  <input
                    type="number"
                    min="0"
                    value={goodTime}
                    onChange={(event) => setGoodTime(event.target.value)}
                    placeholder="예: 270"
                  />
                </label>
                <label>
                  <span>보통 시간(초)</span>
                  <input
                    type="number"
                    min="0"
                    value={normalTime}
                    onChange={(event) => setNormalTime(event.target.value)}
                    placeholder="예: 54"
                  />
                </label>
                <label>
                  <span>나쁨 시간(초)</span>
                  <input
                    type="number"
                    min="0"
                    value={badTime}
                    onChange={(event) => setBadTime(event.target.value)}
                    placeholder="예: 0"
                  />
                </label>
              </div>

              {plan ? (
                <div className="highlight blue">
                  <div className="row">
                    <strong>공부 시작 상태</strong>
                    <span className="pill">{plan.level}</span>
                  </div>
                  <p className="numbers">
                    좋음 비율 {plan.ratio.toFixed(1)}%
                  </p>
                  <p className="big">{plan.badge}</p>
                  <p>{plan.message}</p>
                  <p className="compact-note">좋음 비율 80% 이상 50분, 50~80% 25분, 50% 미만 15분 기준입니다.</p>
                  <button className="primary-btn" onClick={handleStartStudy}>
                    이 추천으로 공부 시작
                  </button>
                </div>
              ) : hasRangeError ? (
                <div className="warning-box">시간은 0 이상의 숫자로 입력해주세요.</div>
              ) : (
                <div className="empty-box">숫자를 입력하면 추천 공부 시간이 바로 나옵니다.</div>
              )}
            </article>

            <article className="card">
              <div className="card-head">
                <div className="section-head-row">
                  <h2>최근 기록</h2>
                  {history.length > 0 && (
                    <button className="mini-action" onClick={clearHistory}>
                      전체 삭제
                    </button>
                  )}
                </div>
              </div>
              <div className="history">
                {history.length === 0 ? (
                  <p className="muted">아직 기록이 없습니다.</p>
                ) : (
                  history.map((item, index) => (
                    <div key={`${item.date}-${index}`} className="history-item">
                      <div className="history-top">
                        <strong>{item.date}</strong>
                        <button className="mini-action" onClick={() => removeHistoryItem(index)}>
                          삭제
                        </button>
                      </div>
                      <p>
                        {item.startLevel} / {item.schedule}
                      </p>
                      <span>
                        {item.endLabel || "세션 종료"} · 행동 지표 점수 {item.focusScore}%
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>

          <aside className="side">
            <article className="card">
              <div className="card-head">
                <h2>핵심 기능</h2>
              </div>
              <div className="list">
                <p>1. 멘탈루틴 명상 중 좋음 비율을 계산해 공부 시간을 추천합니다.</p>
                <p>2. 공부하는 동안 오래 자리를 비우면 횟수를 셉니다.</p>
                <p>3. 공부가 끝나면 자리 이탈 기반 행동 지표 결과를 보여줍니다.</p>
              </div>
            </article>

            <article className="card">
              <div className="card-head">
                <h2>사용 설명서</h2>
                <p>실험 순서와 판단 기준을 한 화면에서 바로 볼 수 있게 정리했습니다.</p>
              </div>
              <div className="list">
                <p>1. BRID 멘탈루틴 명상 화면에서 좋음·보통·나쁨 시간(초)을 읽어 입력합니다.</p>
                <p>2. 좋음 비율(좋음 시간 ÷ 전체 시간 × 100)을 계산해 80% / 50% 기준으로 15분·25분·50분 중 하나를 추천합니다.</p>
                <p>3. 카메라를 켜고 공부를 시작하면 자리 이탈 시간만 관찰하고 영상은 저장하지 않습니다.</p>
                <p>4. 10초 이상 이탈은 1회, 30초 이상은 2차 경고, 60초 연속 이탈은 자동 종료입니다.</p>
                <p>5. 행동 지표 점수는 100점에서 시작해 오래 자리 비움 1회마다 15점 감점하고, 자동 종료면 0점 처리합니다.</p>
              </div>
            </article>

          </aside>
        </section>
      )}

      {step === "session" && plan && (
        <section className="grid">
          <article className="card">
            <div className="card-head">
              <h2>2. 추천 시간 실험</h2>
              <p>추천된 시간 동안 타이머를 사용하고, 오래 자리 비웠는지와 연속 이탈 시간만 간단히 관찰합니다.</p>
            </div>

            <div className="timer-box">
              <p>추천 공부 시간</p>
              <strong>{plan.badge}</strong>
              <div className="timer">{formatTime(timeLeft)}</div>
            </div>

            <div className="status-stack roomy">
              <div className="mini-card">
                <p>오래 자리 비움</p>
                <strong>{longAbsences}회</strong>
                <span>10초 이상 비우면 1회로 셉니다.</span>
              </div>
              <div className={`mini-card ${warningLevel}`}>
                <p>연속 이탈 시간</p>
                <strong>{formatTime(awayDurationSeconds)}</strong>
                <span>
                  {(awayDurationSeconds > 0
                    ? getAwayFeedback(awayDurationSeconds * 1000).stageLabel
                    : "정상") + " · 60초 이상이면 자동 종료됩니다."}
                </span>
              </div>
              <div className="mini-card">
                <p>현재 상태</p>
                <strong>{trackingText}</strong>
                <span>{trackingHint}</span>
              </div>
            </div>

            <div className="actions session-actions">
              <button className="sub-btn" onClick={resetDemo}>
                처음으로
              </button>
              <button className="primary-btn" onClick={() => finishSession({ reason: "manual" })}>
                공부 종료
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-head">
              <h2>카메라 화면</h2>
            </div>
            <div className={`video-box ${warningLevel}`}>
              <video ref={videoRef} autoPlay playsInline muted />
              <div className={`video-status ${warningLevel}`}>{trackingText}</div>
            </div>
            <div className={`guide-strip ${warningLevel}`}>{trackingHint}</div>
            <div className="guide-list">
              <p>얼굴이 점선 안쪽 중앙에 오도록 맞춰주세요.</p>
              <p>모바일에서는 세워서 두고 전면 카메라를 사용하는 편이 더 안정적입니다.</p>
              <p>10초는 주황 경고, 30초는 빨간 경고, 60초는 자동 종료 기준입니다.</p>
              <p>이 데모는 영상 저장 없이 얼굴 위치와 자리 비움만 확인합니다.</p>
            </div>
            {cameraMessage && <div className="warning-box">{cameraMessage}</div>}
          </article>
        </section>
      )}

      {step === "result" && plan && (
        <section className="grid">
          <article className="card">
            <div className="card-head">
              <h2>3. 결과 보기</h2>
              <p>공부 시작 상태와 자리 이탈 기반 행동 지표 결과를 쉬운 말로 보여줍니다.</p>
            </div>

            <div className="result-stack">
              <div className="highlight blue">
                <strong>공부 시작 상태</strong>
                <p className="big">{plan.level}</p>
                <p>{plan.badge}</p>
              </div>

              <div className="highlight green">
                <strong>행동 지표 결과</strong>
                <p className="big">{behaviorSummary.focusScore}%</p>
                <p>{behaviorSummary.label}</p>
                <p>{behaviorSummary.message}</p>
                <p>기준: 1회당 15점 감점, 60초 연속 자동 종료는 0점</p>
              </div>

              {sessionEndInfo && (
                <div className={`highlight ${sessionEndInfo.tone}`}>
                  <strong>{sessionEndInfo.title}</strong>
                  <p className="big">{sessionEndInfo.label}</p>
                  <p>{sessionEndInfo.message}</p>
                </div>
              )}

              <div className="highlight amber">
                <strong>오래 자리 비운 횟수</strong>
                <p className="big">{longAbsences}회</p>
                <p>다음에는 이 횟수를 줄이는 것이 목표입니다.</p>
              </div>
            </div>

            <div className="actions roomy-actions">
              <button className="sub-btn" onClick={resetDemo}>
                같은 값으로 다시
              </button>
              <button className="primary-btn" onClick={resetForNewValues}>
                값 다시 입력하기
              </button>
            </div>
          </article>

          <article className="card">
            <div className="card-head">
              <h2>발표용 설명</h2>
            </div>
            <div className="list">
              <p>이 앱은 BRID 멘탈루틴 명상 중 뇌파 상태에서 좋음 비율을 계산해 오늘의 공부 시간을 추천합니다.</p>
              <p>추천 기준은 좋음 비율 80% / 50% 임계값으로 낮음·보통·좋음 세 구간을 나눠 실측 데이터에서 설정했습니다.</p>
              <p>공부 중에는 오래 자리 비우는지만 확인해 행동 지표를 비교하고, 10초, 30초, 60초 단계별 피드백도 제공합니다.</p>
              <p>영상 저장 없이 직접 제작한 시제품이라 과학 탐구 과정과 안전성을 함께 설명하기 좋습니다.</p>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
