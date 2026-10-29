// Shared by the application bootstrap; assets stay in customer-app/video.
import React, { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

type Props = { theme: 'light' | 'dark'; onDone: () => void; soundEnabled?: boolean };
const light = require('../video/intro-light.mp4');
const dark = require('../video/intro-dark.mp4');

export function IntroScreen({ theme, onDone, soundEnabled = true }: Props) {
  // Keep the initial source for this one-shot intro; theme changes apply to the next launch.
  const source = useRef(theme === 'dark' ? dark : light).current;
  const initialTheme = useRef(theme).current;
  const done = useRef(false);
  const motionChecked = useRef(false);
  const callback = useRef(onDone);
  useEffect(() => { callback.current = onDone; }, [onDone]);
  const player = useVideoPlayer(source, p => {
    p.loop = false;
    p.volume = 0.45;
    p.muted = !soundEnabled;
    // Do not override the operating system's silent-mode policy.
  });
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    player.pause();
    callback.current();
  }, [player]);
  useEventListener(player, 'playToEnd', finish);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') finish();
    if (status === 'readyToPlay' && motionChecked.current && !done.current && AppState.currentState === 'active') player.play();
  });
  useEffect(() => {
    let active = true;
    // Fail open if media cannot play; do not trap the user at startup.
    const timer = setTimeout(finish, 4750);
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') finish();
    });
    if (AppState.currentState !== 'active') finish();
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      if (enabled) finish();
    });
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!active) return;
      motionChecked.current = true;
      if (enabled) finish();
      else if (player.status === 'readyToPlay' && !done.current && AppState.currentState === 'active') player.play();
    }).catch(() => {
      motionChecked.current = true;
      if (active && player.status === 'readyToPlay' && !done.current && AppState.currentState === 'active') player.play();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      app.remove();
      motion.remove();
      player.pause();
    };
  }, [finish, player]);
  return (
    <Pressable onPress={finish} style={[styles.root, { backgroundColor: initialTheme === 'dark' ? '#071827' : '#FFFFFF' }]}
      accessibilityRole="button" accessibilityLabel="تخطي الافتتاحية" accessibilityHint="اضغط للمتابعة إلى التطبيق">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <VideoView player={player} style={styles.video} contentFit="contain"
          nativeControls={false} allowsPictureInPicture={false} />
      </View>
      <View style={{ position: 'absolute', bottom: 54, alignSelf: 'center', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: initialTheme === 'dark' ? '#102C43' : '#F3F6F9' }} pointerEvents="none">
        <Text style={{ fontFamily: 'Tajawal-Medium', fontSize: 15, color: initialTheme === 'dark' ? '#F4F7FA' : '#102D46' }}>تخطي الافتتاحية</Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 }, video: { width: '100%', height: '100%' } });
