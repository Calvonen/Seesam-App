import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { sendChatMessage } from '../services/seesamApi';

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

type IntercomState = 'idle' | 'listening' | 'thinking';

const STATUS_TEXT: Record<IntercomState, string> = {
  idle: 'Valmiina',
  listening: 'Kuuntelen...',
  thinking: 'Mietin...',
};

const CRACKLE_DURATION = 280;
const LISTENING_DURATION = 1200;
const CHAT_MESSAGE = 'moro Seesam';
const ERROR_DETAIL_DISPLAY_DURATION = 6000;

export default function HomeScreen() {
  const [intercomState, setIntercomState] = useState<IntercomState>('idle');
  const [answerText, setAnswerText] = useState<string | null>(null);
  const [errorDetailText, setErrorDetailText] = useState<string | null>(null);
  const staticOpacity = useRef(new Animated.Value(0)).current;
  const blueGlow = useRef(new Animated.Value(0)).current;
  const amberGlow = useRef(new Animated.Value(0)).current;
  const amberLoop = useRef<Animated.CompositeAnimation | null>(null);
  const flowTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeRequestId = useRef(0);
  const buttonPress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      activeRequestId.current += 1;
      amberLoop.current?.stop();
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


  function clearFlowTimers() {
    flowTimers.current.forEach(clearTimeout);
    flowTimers.current = [];
  }

  function getChatMessage() {
    return CHAT_MESSAGE;
  }

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
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
    <View style={styles.screen}>
      <View style={styles.device}>
        <Text style={styles.title}>SEESAM</Text>

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
          <View style={styles.speakerHousing}>
            <View style={styles.fabric}>
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

        <Text style={styles.status}>{STATUS_TEXT[intercomState]}</Text>
        <Text style={styles.answer}>{answerText ?? ' '}</Text>
        {errorDetailText ? (
          <Text style={styles.errorDetail}>{errorDetailText}</Text>
        ) : null}

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
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: '#17120f',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
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
