import { useEffect, useRef, useState } from 'react';
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

import { getServerStatus, sendChatMessage, type ServerStatusResponse } from '../services/seesamApi';

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
  { label: 'API', keys: ['api', 'serverStatus', 'server_status', 'status', 'health'] },
  { label: 'Ollama', keys: ['ollama'] },
  { label: 'Piper', keys: ['piper'] },
  { label: 'SSH', keys: ['ssh'] },
  { label: 'Fail2Ban', keys: ['fail2ban', 'fail_2_ban'] },
  { label: 'hostname', keys: ['hostname', 'host'] },
  { label: 'uptime', keys: ['uptime'] },
  { label: 'CPU', keys: ['cpu', 'processor'] },
  { label: 'RAM', keys: ['ram', 'memory', 'mem'] },
  { label: 'disk', keys: ['disk', 'storage'] },
  { label: 'GPU', keys: ['gpu'] },
  { label: 'IP address', keys: ['ip_address', 'ipAddress', 'ip', 'address'] },
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
};

const STATUS_TEXT: Record<IntercomState, string> = {
  idle: 'Valmiina',
  listening: 'Kuuntelen...',
  thinking: 'Mietin...',
};

const CRACKLE_DURATION = 280;
const LISTENING_DURATION = 1200;
const CHAT_MESSAGE = 'moro Seesam';
const ERROR_DETAIL_DISPLAY_DURATION = 6000;

const EMPTY_MAINTENANCE_STATUS: MaintenanceStatusState = {
  detailRows: [],
  error: null,
  loading: false,
  status: null,
  updatedAt: null,
};

export default function HomeScreen() {
  const [intercomState, setIntercomState] = useState<IntercomState>('idle');
  const [answerText, setAnswerText] = useState<string | null>(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceStatus, setMaintenanceStatus] =
    useState<MaintenanceStatusState>(EMPTY_MAINTENANCE_STATUS);
  const [errorDetailText, setErrorDetailText] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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

  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setInputFocused(false);
      setKeyboardHeight(0);
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      });
    });

    return () => {
      activeRequestId.current += 1;
      statusRequestId.current += 1;
      amberLoop.current?.stop();
      flowTimers.current.forEach(clearTimeout);
      keyboardDidShow.remove();
      keyboardDidHide.remove();
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

  const keyboardActive = keyboardVisible || inputFocused;
  const inputAreaTranslateY =
    Platform.OS === 'android' && keyboardVisible
      ? -Math.min(keyboardHeight * 0.55, 190)
      : 0;


  function clearFlowTimers() {
    flowTimers.current.forEach(clearTimeout);
    flowTimers.current = [];
  }

  function getChatMessage() {
    return questionText.trim() || CHAT_MESSAGE;
  }

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
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

  function getServiceLedStyle(value: string) {
    const normalizedValue = value.toLowerCase();

    if (
      value === '-' ||
      normalizedValue.includes('offline') ||
      normalizedValue.includes('down') ||
      normalizedValue.includes('error') ||
      normalizedValue.includes('fail') ||
      normalizedValue.includes('stopped')
    ) {
      return styles.serviceLedAmber;
    }

    return styles.serviceLedGreen;
  }

  function getServerStatusRows(status: ServerStatusResponse) {
    return SERVICE_STATUS_FIELDS.map((field) => {
      const value =
        field.label === 'API'
          ? findStatusValue(status.details, field.keys) ?? status.serverStatus
          : findStatusValue(status.details, field.keys);

      return {
        label: field.label,
        value: formatStatusValue(value),
      };
    }).filter((row) => row.label !== 'GPU' || row.value !== '-');
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

      if (statusRequestId.current !== requestId) {
        return;
      }

      setMaintenanceStatus({
        detailRows: getServerStatusRows(serverStatus),
        error: null,
        loading: false,
        status: serverStatus.serverStatus,
        updatedAt: new Date().toLocaleTimeString('fi-FI', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch (error) {
      if (statusRequestId.current !== requestId) {
        return;
      }

      setMaintenanceStatus({
        detailRows: [],
        error: getErrorMessage(error),
        loading: false,
        status: null,
        updatedAt: null,
      });
    }
  }

  function openMaintenanceMode() {
    setMaintenanceOpen(true);
    void refreshMaintenanceStatus();
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
      setMaintenanceOpen(false);
    });
  }

  function toggleMaintenanceMode() {
    if (maintenanceOpen) {
      closeMaintenanceMode();
      return;
    }

    openMaintenanceMode();
  }

  function finishWithAnswer(answer: string) {
    setAnswerText(answer);
    setErrorDetailText(null);
    returnToIdle();
  }

  function finishWithError(error: unknown) {
    setAnswerText('Yhteys Seesamiin epäonnistui.');
    setErrorDetailText(getErrorMessage(error));
    returnToIdle();

    flowTimers.current.push(
      setTimeout(() => {
        setErrorDetailText(null);
      }, ERROR_DETAIL_DISPLAY_DURATION),
    );
  }

  async function askSeesam(message: string, requestId: number) {
    try {
      const response = await sendChatMessage(message);

      if (activeRequestId.current !== requestId) {
        return;
      }

      finishWithAnswer(response.answer);
    } catch (error) {
      console.error('Seesam chat request failed:', error);

      if (activeRequestId.current !== requestId) {
        return;
      }

      finishWithError(error);
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

  function playStaticCrackle() {
    staticOpacity.stopAnimation();
    staticOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(staticOpacity, {
        toValue: 0.7,
        duration: 50,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(staticOpacity, {
        toValue: 0.2,
        duration: 80,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(staticOpacity, {
        toValue: 0.48,
        duration: 70,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(staticOpacity, {
        toValue: 0,
        duration: 80,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
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

  function startIntercomFlow() {
    clearFlowTimers();
    activeRequestId.current += 1;
    const requestId = activeRequestId.current;
    const chatMessage = getChatMessage();

    amberLoop.current?.stop();
    setAnswerText(null);
    setErrorDetailText(null);
    setIntercomState('idle');
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
    playStaticCrackle();

    flowTimers.current = [
      setTimeout(() => {
        setIntercomState('listening');
        startListeningGlow();
      }, CRACKLE_DURATION),
      setTimeout(() => {
        staticOpacity.stopAnimation();
        staticOpacity.setValue(0);
        setIntercomState('thinking');
        startThinkingGlow();
        void askSeesam(chatMessage, requestId);
      }, CRACKLE_DURATION + LISTENING_DURATION),
    ];
  }

  return (
    <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      <View style={styles.screen}>
        <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={[
          styles.screenScroll,
          Platform.OS === 'ios' && keyboardActive && styles.screenScrollKeyboard,
        ]}
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
          pointerEvents={maintenanceOpen ? "auto" : "none"}
          style={[
            styles.serviceConsole,
            { opacity: serviceConsoleOpacity },
          ]}
        >
          <Text style={styles.serviceTitle}>SERVICE CONSOLE</Text>
          <ScrollView
            contentContainerStyle={styles.serviceScrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.serviceScroll}
          >
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
                      getServiceLedStyle(row.value),
                    ]}
                  />
                  <View style={styles.serviceTextGroup}>
                    <Text style={styles.serviceLabel}>{row.label}</Text>
                    <Text style={styles.serviceValue}>{row.value}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
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
            <Pressable
              accessibilityLabel={maintenanceOpen ? "Close maintenance mode" : "Open maintenance mode"}
              delayLongPress={700}
              onLongPress={toggleMaintenanceMode}
              style={styles.speakerPressable}
            >
              <View style={styles.speakerHousing}>
                <View style={styles.fabric}>
                  <View style={styles.hatchGrille}>
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
                </View>
              </View>
            </Pressable>
          </View>

          <Text style={styles.status}>{STATUS_TEXT[intercomState]}</Text>
          <Text style={styles.answer}>{answerText ?? " "}</Text>
          {errorDetailText ? (
            <Text style={styles.errorDetail}>{errorDetailText}</Text>
          ) : null}

          <View
            style={[
              styles.inputArea,
              { transform: [{ translateY: inputAreaTranslateY }] },
            ]}
          >
            <TextInput
            accessibilityLabel="Seesam question"
            autoCapitalize="sentences"
            onBlur={() => setInputFocused(false)}
            onChangeText={setQuestionText}
            onFocus={() => setInputFocused(true)}
            placeholder="Kysy Seesamilta..."
            placeholderTextColor="#765233"
            returnKeyType="done"
            style={styles.questionInput}
            value={questionText}
          />
          </View>

          <Animated.View style={{ transform: [{ translateY: buttonTranslateY }] }}>
            <Pressable
              accessibilityLabel="Push to listen"
              onPress={startIntercomFlow}
              onPressIn={pressButton}
              onPressOut={releaseButton}
              style={({ pressed }) => [
                styles.buttonWell,
                pressed && styles.buttonWellPressed,
              ]}
            >
              <View style={styles.pushButton}>
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
  screenScrollKeyboard: {
    justifyContent: 'flex-start',
    paddingBottom: 48,
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
  serviceTitle: {
    color: '#8df58c',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 6,
    paddingRight: 22,
  },
  serviceScroll: {
    flex: 1,
  },
  serviceScrollContent: {
    paddingBottom: 12,
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
