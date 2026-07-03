import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {
  getServerStatus,
  getSpeechAudio,
  sendChatMessage,
  transcribeAudio,
  SeesamRequestError,
  type ServerStatusResponse,
} from '../services/seesamApi';

const SPEAKER_OPENING_SIZE = 208;
const GRILLE_BAR_COUNT = 12;
const GRILLE_BAR_WIDTH = 10;
const GRILLE_EDGE_INSET = 2;
const GRILLE_GAP =
  (SPEAKER_OPENING_SIZE -
    GRILLE_EDGE_INSET * 2 -
    GRILLE_BAR_COUNT * GRILLE_BAR_WIDTH) /
  (GRILLE_BAR_COUNT - 1);
const GRILLE_BARS = Array.from({ length: GRILLE_BAR_COUNT }, (_, index) => index);
const STATIC_LINES = Array.from({ length: 18 }, (_, index) => index);
const SERVICE_STATUS_FIELDS = [
  { label: 'API', keys: ['api', 'serverOnline', 'server_online', 'serverStatus', 'server_status', 'status', 'health'] },
  { label: 'Memory File', keys: ['memoryFile', 'memory_file', 'memoryFound', 'memory_found', 'memoryFileFound', 'memory_file_found'] },
  { label: 'Ollama', keys: ['ollama'] },
  { label: 'Server Time', keys: ['serverTime', 'server_time', 'timestamp', 'time'] },
  { label: 'Version', keys: ['version', 'apiVersion', 'api_version', 'commit', 'commitSha', 'commit_sha'] },
];

type IntercomState = 'idle' | 'listening' | 'thinking';

type StatusRow = {
  label: string;
  value: string;
};

type MaintenanceStatusState = {
  loading: boolean;
  status: string | null;
  detailRows: StatusRow[];
  error: string | null;
  updatedAt: string | null;
  lastSuccessfulConnectionAt: string | null;
};

type PushToTalkStep = 'recording' | 'transcribe' | 'chat' | 'speak' | 'playback';

const STATUS_TEXT: Record<IntercomState, string> = {
  idle: 'Valmiina',
  listening: 'Kuuntelen...',
  thinking: 'Ajattelen...',
};

const MIN_RECORDING_DURATION_MS = 300;
const RECORDING_FILE_READY_DELAY_MS = 250;
const TRANSCRIBE_RETRY_DELAY_MS = 500;
const STEP_ERROR_TEXT: Record<PushToTalkStep, string> = {
  recording: 'Äänitys epäonnistui.',
  transcribe: 'Puheen tunnistus epäonnistui.',
  chat: 'Seesam-yhteys epäonnistui.',
  speak: 'Puheen muodostus epäonnistui.',
  playback: 'Äänen toisto epäonnistui.',
};


const EMPTY_MAINTENANCE_STATUS: MaintenanceStatusState = {
  detailRows: [],
  error: null,
  loading: false,
  status: null,
  updatedAt: null,
  lastSuccessfulConnectionAt: null,
};

export default function HomeScreen() {
  const [intercomState, setIntercomState] = useState<IntercomState>('idle');
  const [answerText, setAnswerText] = useState<string | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceStatus, setMaintenanceStatus] =
    useState<MaintenanceStatusState>(EMPTY_MAINTENANCE_STATUS);
  const [errorDetailText, setErrorDetailText] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [textMode, setTextMode] = useState(false);
  const staticOpacity = useRef(new Animated.Value(0)).current;
  const blueGlow = useRef(new Animated.Value(0)).current;
  const amberGlow = useRef(new Animated.Value(0)).current;
  const amberLoop = useRef<Animated.CompositeAnimation | null>(null);
  const flowTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeRequestId = useRef(0);
  const statusRequestId = useRef(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const buttonPress = useRef(new Animated.Value(0)).current;
  const hatchProgress = useRef(new Animated.Value(0)).current;
  const speechGlow = useRef(new Animated.Value(0)).current;
  const speechGlowLoop = useRef<Animated.CompositeAnimation | null>(null);
  const speechSound = useRef<Audio.Sound | null>(null);
  const speechAudioUri = useRef<string | null>(null);
  const speechAudioSequence = useRef(0);
  const recording = useRef<Audio.Recording | null>(null);
  const recordingRequestId = useRef<number | null>(null);
  const recordingStartInProgress = useRef(false);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingStopInProgress = useRef(false);
  const stopRecordingAfterStart = useRef(false);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });


    return () => {
      activeRequestId.current += 1;
      statusRequestId.current += 1;
      amberLoop.current?.stop();
      speechGlowLoop.current?.stop();
      void unloadSpeechSound();
      void recording.current?.stopAndUnloadAsync();
      flowTimers.current.forEach(clearTimeout);
    };
  }, []);

  const blueScale = blueGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.99, 1.04],
  });

  const amberScale = amberGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.99, 1.045],
  });

  const buttonTranslateY = buttonPress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 2],
  });

  const frontCoverTranslateY = hatchProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 285],
  });

  const serviceConsoleOpacity = hatchProgress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 0.2, 1],
  });

  const speechGlowScale = speechGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.99, 1.035],
  });

  const textModeHasMessage = questionText.trim().length > 0;
  const terminalOutput = errorDetailText ?? answerText ?? 'TEXT LINK READY';


  function clearFlowTimers() {
    flowTimers.current.forEach(clearTimeout);
    flowTimers.current = [];
  }

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  function delay(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function isNetworkRequestFailed(error: unknown): boolean {
    const candidateError = error instanceof SeesamRequestError ? error.originalError : error;

    return getErrorMessage(candidateError) === 'Network request failed';
  }

  async function getRecordingFileReadiness(audioUri: string) {
    const fileInfo = await FileSystem.getInfoAsync(audioUri);
    const fileSize = fileInfo.exists ? fileInfo.size ?? 0 : 0;

    return {
      exists: fileInfo.exists,
      size: fileSize,
    };
  }

  async function waitForRecordingFileReady(audioUri: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await delay(RECORDING_FILE_READY_DELAY_MS);

      const fileReadiness = await getRecordingFileReadiness(audioUri);


      if (fileReadiness.exists && fileReadiness.size > 0) {
        return;
      }
    }

    throw new Error('Tallennettu äänitiedosto ei ole valmis.');
  }

  function arrayBufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    const base64Characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let base64 = "";

    for (let index = 0; index < bytes.length; index += 3) {
      const firstByte = bytes[index];
      const secondByte = bytes[index + 1];
      const thirdByte = bytes[index + 2];
      const hasSecondByte = index + 1 < bytes.length;
      const hasThirdByte = index + 2 < bytes.length;
      const triplet =
        (firstByte << 16) |
        ((hasSecondByte ? secondByte : 0) << 8) |
        (hasThirdByte ? thirdByte : 0);

      base64 += base64Characters[(triplet >> 18) & 63];
      base64 += base64Characters[(triplet >> 12) & 63];
      base64 += hasSecondByte ? base64Characters[(triplet >> 6) & 63] : "=";
      base64 += hasThirdByte ? base64Characters[triplet & 63] : "=";
    }

    return base64;
  }

  async function unloadSpeechSound() {
    const currentSound = speechSound.current;
    const currentAudioUri = speechAudioUri.current;

    speechSound.current = null;
    speechAudioUri.current = null;

    if (!currentSound) {
      if (currentAudioUri) {
        await FileSystem.deleteAsync(currentAudioUri, { idempotent: true });
      }
      return;
    }

    await currentSound.unloadAsync();

    if (currentAudioUri) {
      await FileSystem.deleteAsync(currentAudioUri, { idempotent: true });
    }
  }

  async function deleteCachedSpeechAudioFiles() {
    const cacheDirectory = FileSystem.cacheDirectory;

    if (!cacheDirectory) {
      return;
    }

    const cachedFiles = await FileSystem.readDirectoryAsync(cacheDirectory);

    await Promise.all(
      cachedFiles
        .filter((fileName) => fileName.startsWith("seesam-answer-") && fileName.endsWith(".wav"))
        .map((fileName) => FileSystem.deleteAsync(cacheDirectory + fileName, { idempotent: true })),
    );
  }

  function createSpeechAudioUri(requestId: number) {
    speechAudioSequence.current += 1;
    return (
      FileSystem.cacheDirectory +
      "seesam-answer-" +
      requestId +
      "-" +
      speechAudioSequence.current +
      "-" +
      Date.now() +
      ".wav"
    );
  }

  function startSpeechGlow() {
    speechGlowLoop.current?.stop();
    speechGlow.stopAnimation();
    speechGlow.setValue(0);

    speechGlowLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(speechGlow, {
          toValue: 1,
          duration: 820,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(speechGlow, {
          toValue: 0.18,
          duration: 820,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    speechGlowLoop.current.start();
  }

  function stopSpeechGlow() {
    speechGlowLoop.current?.stop();
    speechGlowLoop.current = null;
    Animated.timing(speechGlow, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }

  async function restorePlaybackAudioMode() {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });
  }

  async function playAnswerAudio(answer: string, requestId: number) {
    try {
      await unloadSpeechSound();
      await deleteCachedSpeechAudioFiles();
    } catch (error) {
      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('playback', error, 'local-playback');
      return;
    }

    let speechAudio;

    try {
      speechAudio = await getSpeechAudio(answer);
    } catch (error) {
      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('speak', error);
      return;
    }

    if (activeRequestId.current !== requestId) {
      return;
    }

    try {
      const audioUri = createSpeechAudioUri(requestId);
      await FileSystem.deleteAsync(audioUri, { idempotent: true });
      await FileSystem.writeAsStringAsync(audioUri, arrayBufferToBase64(speechAudio.audio), {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (activeRequestId.current !== requestId) {
        await FileSystem.deleteAsync(audioUri, { idempotent: true });
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: false },
      );

      if (activeRequestId.current !== requestId) {
        await sound.unloadAsync();
        await FileSystem.deleteAsync(audioUri, { idempotent: true });
        return;
      }

      speechSound.current = sound;
      speechAudioUri.current = audioUri;
      startSpeechGlow();
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((playbackStatus) => {
        if (!playbackStatus.isLoaded) {
          return;
        }

        if (playbackStatus.didJustFinish) {
          if (activeRequestId.current !== requestId) {
            return;
          }

          stopSpeechGlow();
          void unloadSpeechSound();
          returnToIdle();
        }
      });
    } catch (error) {
      if (activeRequestId.current !== requestId) {
        return;
      }

      stopSpeechGlow();
      void unloadSpeechSound();
      showStepFailure('playback', error, 'local-playback');
    }
  }

  function normalizeStatusKey(key: string) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function formatStatusValue(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function findStatusValue(value: unknown, keys: string[]): unknown {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const normalizedKeys = keys.map(normalizeStatusKey);

    for (const [entryKey, entryValue] of Object.entries(value)) {
      const normalizedEntryKey = normalizeStatusKey(entryKey);

      if (normalizedEntryKey.includes('sensor')) {
        continue;
      }

      if (normalizedKeys.includes(normalizedEntryKey)) {
        return entryValue;
      }
    }

    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (normalizeStatusKey(entryKey).includes('sensor')) {
        continue;
      }

      const nestedValue = findStatusValue(entryValue, keys);

      if (nestedValue !== undefined) {
        return nestedValue;
      }
    }

    return undefined;
  }

  function readNestedStatusValue(value: unknown) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const statusValue = findStatusValue(value, ['ok', 'online', 'found', 'exists', 'present', 'status', 'state', 'health']);

    return statusValue ?? value;
  }

  function getBooleanStatusText(value: unknown, trueText: string, falseText: string) {
    const statusValue = readNestedStatusValue(value);

    if (typeof statusValue === 'boolean') {
      return statusValue ? trueText : falseText;
    }

    if (typeof statusValue === 'string') {
      const normalizedValue = statusValue.toLowerCase();

      if (['available', 'found', 'ok', 'online', 'present', 'running', 'true', 'up'].includes(normalizedValue)) {
        return trueText;
      }

      if (['false', 'missing', 'offline', 'down', 'error', 'failed', 'stopped'].includes(normalizedValue)) {
        return falseText;
      }
    }

    return formatStatusValue(statusValue);
  }

  function getStatusRowValue(label: string, rawValue: unknown, status: ServerStatusResponse) {
    if (label === 'API') {
      return status.serverStatus;
    }

    if (label === 'Memory File') {
      return getBooleanStatusText(rawValue, 'Found', 'Missing');
    }

    if (label === 'Ollama') {
      return getBooleanStatusText(rawValue, 'OK', 'Offline');
    }

    if (label === 'Version' && (rawValue === null || rawValue === undefined || rawValue === '')) {
      return 'dev';
    }

    return formatStatusValue(rawValue);
  }

  function getServiceLedStyle(label: string, value: string) {
    const normalizedLabel = label.toLowerCase();
    const normalizedValue = value.toLowerCase();

    if (normalizedLabel === 'server time' || normalizedLabel === 'version') {
      return value === '-' ? styles.serviceLedAmber : styles.serviceLedGreen;
    }

    if (normalizedLabel === 'api') {
      return normalizedValue === 'online' ? styles.serviceLedGreen : styles.serviceLedAmber;
    }

    if (normalizedLabel === 'memory file') {
      return normalizedValue === 'found' ? styles.serviceLedGreen : styles.serviceLedAmber;
    }

    if (normalizedLabel === 'ollama') {
      return normalizedValue === 'ok' ? styles.serviceLedGreen : styles.serviceLedAmber;
    }

    return styles.serviceLedAmber;
  }

  function getServerStatusRows(status: ServerStatusResponse) {
    return SERVICE_STATUS_FIELDS.map((field) => {
      const rawValue =
        field.label === 'API'
          ? status.serverStatus
          : findStatusValue(status.details, field.keys);

      return {
        label: field.label,
        value: getStatusRowValue(field.label, rawValue, status),
      };
    });
  }

  async function refreshMaintenanceStatus() {
    const requestId = statusRequestId.current + 1;
    statusRequestId.current = requestId;

    setMaintenanceStatus((currentStatus) => ({
      ...currentStatus,
      error: null,
      loading: true,
    }));

    try {
      const serverStatus = await getServerStatus();
      const successfulConnectionAt = new Date().toLocaleString('fi-FI', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
      });

      if (statusRequestId.current !== requestId) {
        return;
      }

      setMaintenanceStatus({
        detailRows: getServerStatusRows(serverStatus),
        error: null,
        loading: false,
        status: serverStatus.serverStatus,
        updatedAt: successfulConnectionAt,
        lastSuccessfulConnectionAt: successfulConnectionAt,
      });
    } catch (error) {
      if (statusRequestId.current !== requestId) {
        return;
      }

      setMaintenanceStatus((currentStatus) => ({
        detailRows: [
          { label: 'API', value: 'Offline' },
        ],
        error: getErrorMessage(error),
        loading: false,
        status: 'Offline',
        updatedAt: currentStatus.updatedAt,
        lastSuccessfulConnectionAt: currentStatus.lastSuccessfulConnectionAt,
      }));
    }
  }

  function openMaintenanceMode() {
    setMaintenanceMode(true);
    Animated.timing(hatchProgress, {
      toValue: 1,
      duration: 950,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  function closeMaintenanceMode() {
    statusRequestId.current += 1;
    Animated.timing(hatchProgress, {
      toValue: 0,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMaintenanceMode(false);
    });
  }

  function toggleMaintenanceMode() {
    if (maintenanceMode) {
      closeMaintenanceMode();
      return;
    }

    openMaintenanceMode();
  }

  useEffect(() => {
    if (!maintenanceMode) {
      return undefined;
    }

    void refreshMaintenanceStatus();

    return () => {
      statusRequestId.current += 1;
    };
    // refreshMaintenanceStatus only uses component-local stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceMode]);

  function toggleTextMode() {
    setTextMode((enabled) => {
      const nextEnabled = !enabled;

      if (!nextEnabled) {
        Keyboard.dismiss();
      }

      return nextEnabled;
    });
  }

  function showAnswer(answer: string) {
    setAnswerText(answer);
    setErrorDetailText(null);
  }

  function getStepFailureDetails(
    step: PushToTalkStep,
    error: unknown,
    fallbackRequestUrl = 'local',
  ): { originalError: unknown; requestUrl: string; step: PushToTalkStep } {
    if (error instanceof SeesamRequestError && error.step !== 'status') {
      return {
        originalError: error.originalError,
        requestUrl: error.requestUrl,
        step: error.step,
      };
    }

    if (error instanceof SeesamRequestError) {
      return {
        originalError: error.originalError,
        requestUrl: error.requestUrl,
        step,
      };
    }

    return {
      originalError: error,
      requestUrl: fallbackRequestUrl,
      step,
    };
  }

  function showStepFailure(step: PushToTalkStep, error: unknown, fallbackRequestUrl = 'local') {
    const failureDetails = getStepFailureDetails(step, error, fallbackRequestUrl);

    console.warn('Seesam step failed', {
      originalError: failureDetails.originalError,
      requestUrl: failureDetails.requestUrl,
      step: failureDetails.step,
    });
    setAnswerText(STEP_ERROR_TEXT[failureDetails.step]);
    setErrorDetailText(null);
    returnToIdle();
  }

  async function askSeesam(message: string, requestId: number) {
    try {
      const response = await sendChatMessage(message);

      if (activeRequestId.current !== requestId) {
        return;
      }

      showAnswer(response.answer);

      if (!textMode) {
        void playAnswerAudio(response.answer, requestId);
        return;
      }

      returnToIdle();
    } catch (error) {
      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('chat', error);
    }
  }

  function pressButton() {
    buttonPress.stopAnimation();
    Animated.timing(buttonPress, {
      toValue: 1,
      duration: 60,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }

  function releaseButton() {
    buttonPress.stopAnimation();
    Animated.spring(buttonPress, {
      toValue: 0,
      friction: 3,
      tension: 180,
      useNativeDriver: true,
    }).start();
  }

  function startListeningGlow() {
    amberLoop.current?.stop();
    amberGlow.stopAnimation();
    Animated.parallel([
      Animated.timing(amberGlow, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(blueGlow, {
        toValue: 0.58,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }

  function startThinkingGlow() {
    amberLoop.current?.stop();
    blueGlow.stopAnimation();
    Animated.timing(blueGlow, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    amberLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(amberGlow, {
          toValue: 0.74,
          duration: 760,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(amberGlow, {
          toValue: 0.28,
          duration: 760,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    amberLoop.current.start();
  }

  function returnToIdle() {
    amberLoop.current?.stop();
    setIntercomState('idle');
    Animated.parallel([
      Animated.timing(blueGlow, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(amberGlow, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }

  function prepareInteraction(requestId: number) {
    clearFlowTimers();
    activeRequestId.current = requestId;
    amberLoop.current?.stop();
    stopSpeechGlow();
    void unloadSpeechSound();
    setAnswerText(null);
    setErrorDetailText(null);
    staticOpacity.stopAnimation();
    staticOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(blueGlow, {
        toValue: 0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(amberGlow, {
        toValue: 0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }

  function startProcessing() {
    staticOpacity.stopAnimation();
    staticOpacity.setValue(0);
    setIntercomState('thinking');
    startThinkingGlow();
  }

  async function processSpokenQuestion(audioUri: string, requestId: number) {
    startProcessing();

    let transcribedText = '';

    try {
      let transcription;

      try {
        transcription = await transcribeAudio(audioUri);
      } catch (error) {
        if (!isNetworkRequestFailed(error)) {
          throw error;
        }

        await delay(TRANSCRIBE_RETRY_DELAY_MS);
        transcription = await transcribeAudio(audioUri);
      }

      if (activeRequestId.current !== requestId) {
        return;
      }

      transcribedText = transcription.text.trim();

      if (!transcribedText) {
        throw new Error('Seesam ei kuullut kysymystä.');
      }
    } catch (error) {
      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('transcribe', error);
      return;
    }

    setQuestionText(transcribedText);
    await askSeesam(transcribedText, requestId);
  }

  async function startPushToTalk() {
    if (recording.current || recordingStartInProgress.current || recordingStopInProgress.current) {
      return;
    }

    const requestId = activeRequestId.current + 1;
    recordingRequestId.current = requestId;
    recordingStartInProgress.current = true;
    recordingStartedAt.current = null;
    recordingStopInProgress.current = false;
    stopRecordingAfterStart.current = false;
    prepareInteraction(requestId);
    setIntercomState('listening');
    startListeningGlow();

    try {
      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        throw new Error('Mikrofonin käyttöoikeutta ei myönnetty.');
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });

      const { recording: nextRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording.current = nextRecording;
      recordingStartedAt.current = Date.now();
      recordingStartInProgress.current = false;

      if (stopRecordingAfterStart.current) {
        stopRecordingAfterStart.current = false;
        void stopPushToTalk();
      }
    } catch (error) {
      recordingStartInProgress.current = false;
      recordingRequestId.current = null;
      recordingStartedAt.current = null;
      recordingStopInProgress.current = false;
      stopRecordingAfterStart.current = false;
      recording.current = null;
      void restorePlaybackAudioMode();

      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('recording', error, 'local-recording');
    }
  }

  async function stopPushToTalk() {
    if (recordingStopInProgress.current) {
      return;
    }

    if (recordingStartInProgress.current) {
      stopRecordingAfterStart.current = true;
      return;
    }

    const currentRecording = recording.current;
    const requestId = recordingRequestId.current;
    const startedAt = recordingStartedAt.current;

    if (!currentRecording || requestId === null) {
      return;
    }

    recordingStopInProgress.current = true;
    recording.current = null;
    recordingRequestId.current = null;
    recordingStartedAt.current = null;

    const recordingDuration = startedAt === null ? 0 : Date.now() - startedAt;
    const shouldCancelQuietly = recordingDuration < MIN_RECORDING_DURATION_MS;

    if (shouldCancelQuietly) {
      try {
        await currentRecording.stopAndUnloadAsync();
      } catch {
      } finally {
        recordingStopInProgress.current = false;
        await restorePlaybackAudioMode();

        if (activeRequestId.current === requestId) {
          returnToIdle();
        }
      }

      return;
    }

    try {
      await currentRecording.stopAndUnloadAsync();
      const audioUri = currentRecording.getURI();
      await restorePlaybackAudioMode();

      if (!audioUri) {
        throw new Error('Tallennettua ääntä ei löytynyt.');
      }

      await waitForRecordingFileReady(audioUri);

      if (activeRequestId.current !== requestId) {
        return;
      }

      void processSpokenQuestion(audioUri, requestId);
    } catch (error) {
      void restorePlaybackAudioMode();

      if (activeRequestId.current !== requestId) {
        return;
      }

      showStepFailure('recording', error, 'local-recording');
    } finally {
      recordingStopInProgress.current = false;
    }
  }

  function sendMessage() {
    const chatMessage = questionText.trim();

    if (!chatMessage) {
      return;
    }

    const requestId = activeRequestId.current + 1;
    prepareInteraction(requestId);
    startProcessing();
    void askSeesam(chatMessage, requestId);
  }

  return (
    <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      <View style={styles.screen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.screen}
        >
      <ScrollView
        contentContainerStyle={styles.screenScroll}
        ref={scrollViewRef}
        style={styles.screenScroller}
        endFillColor="#17120f"
        keyboardShouldPersistTaps="handled"
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.device}>
        <Text style={styles.title}>SEESAM</Text>

        <Animated.View
          pointerEvents={maintenanceMode ? "auto" : "none"}
          style={[
            styles.serviceConsole,
            { opacity: serviceConsoleOpacity },
          ]}
        >
          <View style={styles.serviceHeader}>
            <Text style={styles.serviceTitle}>SERVICE CONSOLE</Text>
            <Pressable
              accessibilityLabel="Refresh service status"
              disabled={maintenanceStatus.loading}
              onPress={() => {
                void refreshMaintenanceStatus();
              }}
              style={[
                styles.serviceRefreshButton,
                maintenanceStatus.loading && styles.serviceRefreshButtonDisabled,
              ]}
            >
              <Text style={styles.serviceRefreshButtonText}>REFRESH</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityLabel="Toggle text mode"
            accessibilityRole="switch"
            accessibilityState={{ checked: textMode }}
            onPress={toggleTextMode}
            style={[
              styles.textModeToggle,
              textMode && styles.textModeToggleActive,
            ]}
          >
            <View style={styles.textModeToggleText}>
              <Text style={styles.serviceLabel}>TEXT MODE</Text>
              <Text style={styles.textModeToggleValue}>
                {textMode ? 'ENABLED' : 'DISABLED'}
              </Text>
            </View>
            <View
              style={[
                styles.textModeToggleTrack,
                textMode && styles.textModeToggleTrackActive,
              ]}
            >
              <View
                style={[
                  styles.textModeToggleKnob,
                  textMode && styles.textModeToggleKnobActive,
                ]}
              />
            </View>
          </Pressable>
          <View style={styles.serviceStatusList}>
            {maintenanceStatus.lastSuccessfulConnectionAt ? (
              <View style={styles.serviceLine}>
                <View style={[styles.serviceLed, styles.serviceLedAmber]} />
                <View style={styles.serviceTextGroup}>
                  <Text style={styles.serviceLabel}>LAST OK</Text>
                  <Text style={styles.serviceValue}>{maintenanceStatus.lastSuccessfulConnectionAt}</Text>
                </View>
              </View>
            ) : null}
            {maintenanceStatus.error ? (
              <View style={styles.serviceLine}>
                <View style={[styles.serviceLed, styles.serviceLedAmber]} />
                <View style={styles.serviceTextGroup}>
                  <Text style={styles.serviceLabel}>STATUS</Text>
                  <Text style={styles.serviceValue}>{maintenanceStatus.error}</Text>
                </View>
              </View>
            ) : null}

            {maintenanceStatus.loading ? (
              <View style={styles.serviceLine}>
                <View style={[styles.serviceLed, styles.serviceLedAmber]} />
                <View style={styles.serviceTextGroup}>
                  <Text style={styles.serviceLabel}>STATUS</Text>
                  <Text style={styles.serviceValue}>SYNCING...</Text>
                </View>
              </View>
            ) : (
              maintenanceStatus.detailRows.map((row) => (
                <View key={row.label} style={styles.serviceLine}>
                  <View
                    style={[
                      styles.serviceLed,
                      getServiceLedStyle(row.label, row.value),
                    ]}
                  />
                  <View style={styles.serviceTextGroup}>
                    <Text style={styles.serviceLabel}>{row.label}</Text>
                    <Text style={styles.serviceValue}>{row.value}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.frontCover,
            { transform: [{ translateY: frontCoverTranslateY }] },
          ]}
        >
          <View style={styles.speakerWrap}>
            <Animated.View
              style={[
                styles.ledRing,
                styles.blueLedRing,
                {
                  opacity: blueGlow,
                  transform: [{ scale: blueScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ledRing,
                styles.amberLedRing,
                {
                  opacity: amberGlow,
                  transform: [{ scale: amberScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ledRing,
                styles.speechLedRing,
                {
                  opacity: speechGlow,
                  transform: [{ scale: speechGlowScale }],
                },
              ]}
            />
            <Pressable
              accessibilityLabel={maintenanceMode ? "Close maintenance mode" : "Open maintenance mode"}
              delayLongPress={700}
              onLongPress={toggleMaintenanceMode}
              style={styles.speakerPressable}
            >
              <View style={styles.speakerHousing}>
                <View style={styles.fabric}>
                  {textMode ? (
                    <View key="text-terminal" style={styles.terminalDisplay}>
                      <View style={styles.terminalScanlines} />
                      <Text style={styles.terminalHeader}>SEESAM TTY</Text>
                      <View style={styles.terminalOutputArea}>
                        <Text style={styles.terminalOutput}>{terminalOutput}</Text>
                      </View>
                      <TextInput
                        accessibilityLabel="Seesam text mode input"
                        autoCapitalize="sentences"
                        blurOnSubmit={false}
                        multiline
                        onChangeText={setQuestionText}
                        placeholder="TYPE MESSAGE"
                        placeholderTextColor="#3f7d45"
                        scrollEnabled
                        style={styles.terminalInput}
                        textAlignVertical="top"
                        value={questionText}
                      />
                    </View>
                  ) : (
                    <View key="speaker-grille" style={styles.hatchGrille}>
                      {GRILLE_BARS.map((bar) => (
                        <View
                          key={bar}
                          style={[
                            styles.grilleBar,
                            {
                              left: GRILLE_EDGE_INSET + bar * (GRILLE_BAR_WIDTH + GRILLE_GAP),
                            },
                          ]}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          </View>

          <Text style={styles.status}>{STATUS_TEXT[intercomState]}</Text>

          <Animated.View
            style={{
              transform: [
                { translateY: buttonTranslateY },
              ],
            }}
          >
            <Pressable
              accessibilityLabel={textMode ? "Send text mode message" : "Push to listen"}
              disabled={textMode && !textModeHasMessage}
              onPressIn={() => {
                pressButton();

                if (textMode) {
                  sendMessage();
                  return;
                }

                void startPushToTalk();
              }}
              onPressOut={() => {
                releaseButton();

                if (textMode) {
                  return;
                }

                void stopPushToTalk();
              }}
              style={({ pressed }) => [
                styles.buttonWell,
                pressed && styles.buttonWellPressed,
                textMode && !textModeHasMessage && styles.buttonWellDisabled,
              ]}
            >
              <View
                style={[
                  styles.pushButton,
                  textMode && !textModeHasMessage && styles.pushButtonDisabled,
                ]}
              >
                <View style={styles.brushedBandTop} />
                <View style={styles.brushedBandMiddle} />
                <View style={styles.brushedBandBottom} />
                <View style={styles.metalSheen} />
              </View>
            </Pressable>
          </Animated.View>
        </Animated.View>
        </View>
      </ScrollView>

      <Animated.View
        pointerEvents="none"
        style={[styles.noiseOverlay, { opacity: staticOpacity }]}
      >
        {STATIC_LINES.map((line) => (
          <View
            key={line}
            style={[
              styles.staticLine,
              {
                left: `${(line * 13) % 42}%`,
                top: `${line * 5 + 3}%`,
                width: `${34 + ((line * 19) % 55)}%`,
              },
            ]}
          />
        ))}
      </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#17120f',
    flex: 1,
  },
  screenScroller: {
    backgroundColor: '#17120f',
    flex: 1,
  },
  screenScroll: {
    alignItems: 'center',
    backgroundColor: '#17120f',
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
    paddingBottom: 22,
  },
  device: {
    alignItems: 'center',
    backgroundColor: '#d7b98c',
    borderColor: '#7c5b37',
    borderRadius: 30,
    borderWidth: 4,
    elevation: 10,
    maxWidth: 390,
    minHeight: 630,
    paddingBottom: 34,
    paddingHorizontal: 26,
    paddingTop: 34,
    shadowColor: '#000000',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 16,
    width: '100%',
    position: 'relative',
  },
  title: {
    color: '#3f2b1d',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 32,
  },
  speakerWrap: {
    alignItems: 'center',
    height: 292,
    justifyContent: 'center',
    marginBottom: 28,
    width: 292,
  },
  speakerPressable: {
    alignItems: 'center',
    height: 292,
    justifyContent: 'center',
    width: 292,
  },
  ledRing: {
    borderRadius: 146,
    borderWidth: 5,
    height: 292,
    position: 'absolute',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.56,
    shadowRadius: 16,
    width: 292,
  },
  blueLedRing: {
    backgroundColor: '#2f6f99',
    borderColor: '#8ec9e8',
    shadowColor: '#4aa6dd',
  },
  amberLedRing: {
    backgroundColor: '#d46f2b',
    borderColor: '#ffc06f',
    shadowColor: '#f0a245',
  },
  speechLedRing: {
    backgroundColor: '#3f8f75',
    borderColor: '#9bd7c4',
    shadowColor: '#69d8b3',
  },
  speakerHousing: {
    alignItems: 'center',
    backgroundColor: '#b99669',
    borderColor: '#6f4f2f',
    borderRadius: 124,
    borderWidth: 8,
    height: 248,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#2a1d15',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: 248,
  },
  fabric: {
    alignItems: 'center',
    backgroundColor: '#11100f',
    borderColor: '#2b2119',
    borderRadius: 104,
    borderWidth: 5,
    height: SPEAKER_OPENING_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: SPEAKER_OPENING_SIZE,
  },
  hatchGrille: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#11100f',
    borderRadius: 98,
    overflow: 'hidden',
  },
  terminalDisplay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#07100a',
    borderColor: '#223b22',
    borderRadius: 98,
    borderWidth: 2,
    overflow: 'hidden',
    paddingBottom: 78,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  terminalScanlines: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(141, 245, 140, 0.04)',
    borderRadius: 98,
    borderTopColor: 'rgba(141, 245, 140, 0.18)',
    borderTopWidth: 2,
  },
  terminalHeader: {
    color: '#f0aa3c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 5,
    textAlign: 'center',
  },
  terminalOutputArea: {
    height: 86,
    marginBottom: 5,
    maxHeight: 86,
    minHeight: 0,
  },
  terminalOutput: {
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 15,
  },
  terminalInput: {
    backgroundColor: '#0b160d',
    borderColor: '#315a31',
    borderRadius: 5,
    borderWidth: 1,
    bottom: 22,
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    fontWeight: '800',
    left: 22,
    letterSpacing: 0,
    lineHeight: 15,
    maxHeight: 80,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingTop: 7,
    paddingBottom: 7,
    position: 'absolute',
    right: 22,
  },

  frontCover: {
    alignItems: 'center',
    backgroundColor: '#d7b98c',
    position: 'relative',
    width: '100%',
    zIndex: 3,
  },
  serviceConsole: {
    backgroundColor: '#080b09',
    borderColor: '#17251b',
    borderRadius: 8,
    borderWidth: 3,
    bottom: 116,
    left: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    position: 'absolute',
    right: 18,
    shadowColor: '#000000',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    top: 116,
    zIndex: 1,
  },
  serviceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  serviceTitle: {
    color: '#8df58c',
    flexShrink: 1,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    paddingRight: 10,
  },
  serviceRefreshButton: {
    alignItems: 'center',
    borderColor: 'rgba(141, 245, 140, 0.42)',
    borderRadius: 5,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  serviceRefreshButtonDisabled: {
    opacity: 0.55,
  },
  serviceRefreshButtonText: {
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0,
  },
  textModeToggle: {
    alignItems: 'center',
    borderColor: 'rgba(141, 245, 140, 0.22)',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  textModeToggleActive: {
    backgroundColor: 'rgba(141, 245, 140, 0.08)',
    borderColor: 'rgba(141, 245, 140, 0.42)',
  },
  textModeToggleText: {
    flex: 1,
    paddingRight: 10,
  },
  textModeToggleValue: {
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  textModeToggleTrack: {
    backgroundColor: '#1b241b',
    borderColor: '#355033',
    borderRadius: 10,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 38,
  },
  textModeToggleTrackActive: {
    backgroundColor: '#244522',
    borderColor: '#8df58c',
  },
  textModeToggleKnob: {
    backgroundColor: '#f0aa3c',
    borderRadius: 7,
    height: 14,
    shadowColor: '#f0aa3c',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    width: 14,
  },
  textModeToggleKnobActive: {
    backgroundColor: '#8df58c',
    shadowColor: '#8df58c',
    transform: [{ translateX: 18 }],
  },
  serviceStatusList: {
    height: 270,
    maxHeight: 270,
    minHeight: 0,
  },
  serviceLine: {
    alignItems: 'flex-start',
    borderTopColor: 'rgba(141, 245, 140, 0.12)',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: 4,
  },
  serviceLed: {
    borderRadius: 4,
    height: 8,
    marginRight: 7,
    marginTop: 4,
    width: 8,
  },
  serviceLedGreen: {
    backgroundColor: '#4cff78',
    shadowColor: '#4cff78',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 4,
  },
  serviceLedAmber: {
    backgroundColor: '#f0aa3c',
    shadowColor: '#f0aa3c',
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
  },
  serviceTextGroup: {
    flex: 1,
  },
  serviceLabel: {
    color: '#f0aa3c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  serviceValue: {
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  grilleBar: {
    backgroundColor: '#ad8758',
    borderLeftColor: '#caa676',
    borderLeftWidth: 1,
    borderRadius: 1,
    borderRightColor: '#765233',
    borderRightWidth: 2,
    bottom: 0,
    position: 'absolute',
    shadowColor: '#4d3521',
    shadowOffset: { height: 0, width: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1,
    top: 0,
    width: GRILLE_BAR_WIDTH,
  },
  inputArea: {
    alignItems: 'center',
    width: '100%',
  },
  status: {
    color: '#3f2b1d',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 6,
  },
  answer: {
    color: '#3f2b1d',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0,
    marginBottom: 0,
    minHeight: 20,
    textAlign: 'center',
  },
  errorDetail: {
    color: '#3f2b1d',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0,
    marginTop: 4,
    maxWidth: 300,
    textAlign: 'center',
  },
  questionInput: {
    backgroundColor: 'rgba(255, 255, 248, 0.22)',
    borderColor: '#7c5b37',
    borderRadius: 8,
    borderWidth: 2,
    color: '#3f2b1d',
    fontSize: 15,
    fontWeight: '600',
    height: 40,
    letterSpacing: 0,
    marginBottom: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    width: '100%',
  },
  buttonWell: {
    alignItems: 'center',
    backgroundColor: '#8a6a45',
    borderColor: '#5f452b',
    borderRadius: 66,
    borderWidth: 4,
    elevation: 6,
    height: 132,
    justifyContent: 'center',
    shadowColor: '#352115',
    shadowOffset: { height: 7, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    width: 132,
  },
  buttonWellPressed: {
    elevation: 3,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
  },
  buttonWellDisabled: {
    opacity: 0.56,
  },
  pushButton: {
    backgroundColor: '#bfc0bb',
    borderColor: '#555854',
    borderRadius: 48,
    borderWidth: 4,
    height: 96,
    overflow: 'hidden',
    shadowColor: '#1d1d1b',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 5,
    width: 96,
  },
  pushButtonDisabled: {
    backgroundColor: '#8f918d',
    borderColor: '#686b67',
  },
  brushedBandTop: {
    backgroundColor: 'rgba(255, 255, 248, 0.32)',
    height: 2,
    left: 15,
    position: 'absolute',
    right: 15,
    top: 24,
  },
  brushedBandMiddle: {
    backgroundColor: 'rgba(73, 76, 74, 0.22)',
    height: 2,
    left: 12,
    position: 'absolute',
    right: 12,
    top: 46,
  },
  brushedBandBottom: {
    backgroundColor: 'rgba(255, 255, 248, 0.2)',
    bottom: 25,
    height: 2,
    left: 18,
    position: 'absolute',
    right: 18,
  },
  metalSheen: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 26,
    height: 36,
    left: 18,
    position: 'absolute',
    top: 10,
    width: 44,
  },
  noiseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(236, 215, 174, 0.08)',
  },
  staticLine: {
    backgroundColor: 'rgba(255, 239, 201, 0.75)',
    height: 2,
    position: 'absolute',
  },
});
