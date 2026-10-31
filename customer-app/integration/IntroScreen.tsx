// Shared by the application bootstrap; assets stay in customer-app/video.
import React, { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createIntroLifecycle } from './intro-lifecycle';

type Props = { theme: 'light' | 'dark'; onDone: () => void; soundEnabled?: boolean };
const light = require('../video/intro-light.mp4');
const dark = require('../video/intro-dark.mp4');

export function IntroScreen({ theme, onDone, soundEnabled = true }: Props) {
  // Keep the initial source for this one-shot intro; theme changes apply to the next launch.
  const source = useRef(theme === 'dark' ? dark : light).current;
  const initialTheme = useRef(theme).current;
  const callback = useRef(onDone);
  useEffect(() => { callback.current = onDone; }, [onDone]);
  const player = useVideoPlayer(source, p => {
    p.loop = false;
    p.volume = 0.45;
    p.muted = !soundEnabled;
    // Do not override the operating system's silent-mode policy.
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifecycle = useMemo(() => createIntroLifecycle(player, () => callback.current(), () => {
    timer.current = setTimeout(() => lifecycle.finish(), 4750);
  }), [player]);
  const finish = lifecycle.finish;
  useEventListener(player, 'playToEnd', finish);
  useEventListener(player, 'statusChange', ({ status }) => lifecycle.statusChanged(status));
  useEffect(() => {
    let active = true;
    lifecycle.activate();
    const app = AppState.addEventListener('change', state => lifecycle.appStateChanged(state));
    lifecycle.appStateChanged(AppState.currentState);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => lifecycle.reduceMotionChanged(enabled));
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active) lifecycle.reduceMotionChanged(enabled);
    }).catch(() => { if (active) lifecycle.reduceMotionChanged(false); });
    return () => {
      active = false;
      lifecycle.deactivate();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      app.remove();
      motion.remove();
    };
  }, [lifecycle]);
  return (
    <Pressable onPress={finish} style={[styles.root, { backgroundColor: initialTheme === 'dark' ? '#071827' : '#FFFFFF' }]}
      accessibilityRole="button" accessibilityLabel="تخطي الافتتاحية" accessibilityHint="اضغط للمتابعة إلى التطبيق">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <VideoView player={player} style={styles.video} contentFit="contain"
          nativeControls={false} allowsPictureInPicture={false} />
      </View>
      <View style={{ position: 'absolute', bottom: 54, alignSelf: 'center', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: initialTheme === 'dark' ? '#102C43' : '#F3F6F9' }} pointerEvents="none">
        <Text style={{ fontFamily: 'Tajawal-Bold', fontSize: 16, color: initialTheme === 'dark' ? '#F4F7FA' : '#102D46' }}>تخطي الافتتاحية</Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 }, video: { width: '100%', height: '100%' } });
